import { containsPoint } from '../lib/geo.js';
import { HttpError } from '../lib/http.js';
import { nextMonth, pad2, wibDate } from '../lib/time.js';

// Prakiraan Wilayah Potensi Terjadi Gerakan Tanah bulanan PVMBG (Portal MBG).
// Layer WMS `pmbgi:prakiraan_{tahun}_{bulan}` = poligon zona kerentanan (ZKGT)
// dengan kolom `zona_perki` (potensi bulan itu). GetMap ditutup untuk umum, tapi
// GetFeatureInfo terbuka, jadi potensi direkam per titik.
export const WMS_URL = 'https://vsi.esdm.go.id/data/api/public/geohazard/map-layer/wms';
// Titik di zona kerentanan tinggi (Banjarnegara) untuk memeriksa apakah layer bulan itu sudah terbit.
export const REFERENCE_POINT = { lat: -7.275, lon: 109.67 };

const POINTS_PER_RUN = 100;
const PAUSE_MS = 1_000;
const HALF_BOX_DEG = 0.01;

// Versi pembaca GetFeatureInfo yang dicatat di arsip. Versi 1 selalu memakai
// poligon pertama; versi 2 (1 Okt 2026) memakai poligon yang memuat titik. Bulan
// yang direkam dengan versi lama direkam ulang. Baris lama tetap di arsip, jadi
// pemakai arsip mengambil baris terakhir per kode yang `pembaca`-nya 2.
export const PARSER_VERSION = 2;

export const layerName = ({ year, month }) => `pmbgi:prakiraan_${year}_${month}`;

export function featureInfoUrl(layer, { lat, lon }) {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetFeatureInfo',
    layers: layer,
    query_layers: layer,
    styles: '',
    srs: 'EPSG:4326',
    bbox: [lon - HALF_BOX_DEG, lat - HALF_BOX_DEG, lon + HALF_BOX_DEG, lat + HALF_BOX_DEG].join(','),
    width: '101',
    height: '101',
    x: '50',
    y: '50',
    info_format: 'application/json',
    feature_count: '5',
  });
  return `${WMS_URL}?${params}`;
}

// Atribut poligon di titik itu, tanpa geometri; null bila titik di luar zona.
// GetFeatureInfo memeriksa piksel tengah beserta toleransi beberapa piksel, jadi
// titik di dekat batas zona mengembalikan 2–3 poligon dalam urutan acak. Poligon
// pertama ternyata bukan yang memuat titik pada 9,2% dari 8.434 balasan di cache
// riset (kelas potensinya berbeda pada 6,9%). Karena itu yang dipakai adalah poligon
// yang geometrinya memuat titik; poligon pertama hanya dipakai bila tidak ada
// geometri atau tidak satu pun memuat titik (titik tepat di garis batas).
export function parseFeatureInfo(json, point) {
  if (!Array.isArray(json?.features)) throw new Error('format GetFeatureInfo tidak dikenal');
  const features = json.features;
  const feature = (point && features.find((f) => containsPoint(f.geometry, point))) ?? features[0];
  const p = feature?.properties;
  if (!p) return null;
  return {
    potensi: p.zona_perki ?? null,
    zkgt: p.unsur ?? null,
    zona: p.zona ?? null,
    tahun_zkgt: p.tahun ?? null,
    wilayah_zkgt: p.wilayah ?? null,
    n_poligon: features.length,
  };
}

// 404 "Layer not found" = prakiraan bulan itu belum terbit.
async function isPublished(http, layer) {
  try {
    await http.fetchJson(featureInfoUrl(layer, REFERENCE_POINT));
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return false;
    throw err;
  }
}

const monthKey = ({ year, month }) => `${year}-${pad2(month)}`;
const monthFile = ({ year, month }) => `pvmbg-prakiraan/${year}/${pad2(month)}.jsonl`;

// Kode yang sudah direkam dengan pembaca versi sekarang.
async function doneCodes(archive, month) {
  const text = await archive.readText(monthFile(month));
  const lines = (text ?? '').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return new Set(lines.filter((line) => (line.pembaca ?? 1) >= PARSER_VERSION).map((line) => line.kode));
}

const isCurrentParser = (monthStatus) => (monthStatus?.pembaca ?? 1) >= PARSER_VERSION;
const isComplete = (monthStatus) => Boolean(monthStatus?.completed_at) && isCurrentParser(monthStatus);
const parseMonthKey = (key) => {
  const [year, month] = key.split('-').map(Number);
  return { year, month };
};

export async function recordPvmbgPrakiraan({ archive, http, now, data = {}, pause = async () => {} }) {
  const points = data.wilayah ?? [];
  if (!points.length) return { items: 0, new: 0, skipped: 'daftar titik kosong' };

  const status = (await archive.readJson('pvmbg-prakiraan/status.json')) ?? { months: {} };
  const [year, month] = wibDate(now).split('-').map(Number);
  const current = { year, month };
  let budget = POINTS_PER_RUN;
  let items = 0;
  let saved = 0;
  const errors = [];

  // Bulan berjalan dan bulan depan (prakiraan terbit menjelang bulannya), lalu
  // bulan lama yang belum lengkap dengan pembaca versi sekarang. Bulan yang sedang
  // direkam ulang sudah bertanda pembaca baru sejak run pertamanya, jadi yang
  // menentukan adalah completed_at, bukan versi pembaca saja.
  const unfinished = Object.keys(status.months).filter((key) => !isComplete(status.months[key])).map(parseMonthKey);
  const targets = [...new Map([current, nextMonth(current), ...unfinished].map((m) => [monthKey(m), m])).values()];
  for (const target of targets) {
    const key = monthKey(target);
    if (isComplete(status.months[key]) || budget === 0) continue;
    const layer = layerName(target);
    try {
      if (!(await isPublished(http, layer))) continue;
    } catch (err) {
      errors.push(`${key}: ${err.message}`);
      continue;
    }

    const done = await doneCodes(archive, target);
    for (const point of points) {
      if (budget === 0) break;
      if (done.has(point.kode)) continue;
      budget--;
      try {
        const attrs = parseFeatureInfo(await http.fetchJson(featureInfoUrl(layer, point)), point);
        await archive.appendLine(monthFile(target), {
          kode: point.kode,
          lat: point.lat,
          lon: point.lon,
          ...(attrs ?? { potensi: null }),
          pembaca: PARSER_VERSION,
          checked_at: now,
        });
        done.add(point.kode);
        saved++;
      } catch (err) {
        errors.push(`${key} ${point.kode}: ${err.message}`);
        if (err instanceof HttpError && err.status === 429) break;
      }
      await pause(PAUSE_MS);
    }
    items += done.size;
    status.months[key] = {
      layer,
      total: points.length,
      done: done.size,
      pembaca: PARSER_VERSION,
      ...(done.size >= points.length ? { completed_at: now } : {}),
    };
  }

  await archive.writeJson('pvmbg-prakiraan/status.json', status);
  if (errors.length && saved === 0 && items === 0) throw new Error(errors.slice(0, 5).join('; '));
  return { items, new: saved, errors: errors.slice(0, 20) };
}
