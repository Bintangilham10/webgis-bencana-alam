import { sha256, stableStringify } from '../lib/hash.js';
import { fetchRainPoints, MODEL_META_URL, parseModelRun } from '../lib/open-meteo-hujan.js';
import { OUTLOOK_HAZARDS, rainPoint, regionDailyOutlook } from '../lib/outlook.js';
import { datePath } from '../lib/paths.js';
import rules from '../lib/rules.json' with { type: 'json' };
import { RULES_VERSION } from '../lib/warning-rules.js';

// Arsip prospektif indikasi SIGAP (hujan lebat, banjir, tanah longsor per kab/kota
// per hari). Dihitung di perekam untuk setiap siklus model ECMWF IFS baru (00Z
// dan 12Z, tersedia di Open-Meteo ±6,5 jam kemudian), dengan aturan dan titik
// pantau yang sama dengan server. Commit git di branch arsip-data menjadi cap
// waktu publik bahwa indikasi dibuat sebelum kejadian, dan hujan per titik ikut
// disimpan supaya setiap indikasi bisa dihitung ulang persis (atau dengan aturan
// versi baru) untuk verifikasi per lead time.
const STATUS_FILE = 'sigap-indikasi/status.json';
// Run dengan titik hujan yang gagal diulang di run berikutnya (±15 menit
// kemudian); setelah percobaan ketiga hasilnya disimpan apa adanya dengan jumlah
// titik gagal.
const MAX_ATTEMPTS = 3;
const COUNT_KEYS = ['normal', 'waspada', 'siaga', 'awas'];

// Level tertinggi dari ketiga bahaya pada satu hari; null bila semua tanpa data.
const highest = (levels) => (levels.every((l) => l === null) ? null : Math.max(...levels.filter((l) => l !== null)));

export async function recordSigapIndikasi({ archive, http, now, data = {}, pause = async () => {} }) {
  const points = data.titikPantau ?? [];
  if (!points.length) return { items: 0, new: 0, skipped: 'daftar titik pantau kosong' };

  const run = parseModelRun(await http.fetchJson(MODEL_META_URL, { timeoutMs: 20_000 }));
  const status = (await archive.readJson(STATUS_FILE)) ?? {};
  if (status.last_init && status.last_init >= run.init) {
    return { items: 0, new: 0, skipped: `siklus ${run.init} sudah direkam` };
  }

  // Titik dengan koordinat sama (3 desimal) cukup diminta sekali.
  const locations = new Map();
  const regions = new Map();
  for (const point of points) {
    const location = rainPoint(point.lat, point.lon);
    locations.set(location.key, location);
    if (!regions.has(point.kode)) regions.set(point.kode, []);
    regions.get(point.kode).push({ ...point, rainKey: location.key });
  }
  const { rain, failed, error } = await fetchRainPoints([...locations.values()], { getJson: http.fetchJson, sleep: pause });
  if (!rain.size) throw new Error(`hujan gagal dimuat untuk semua titik: ${error}`);

  const attempts = (status.attempts?.[run.init] ?? 0) + 1;
  if (failed && attempts < MAX_ATTEMPTS) {
    await archive.writeJson(STATUS_FILE, { ...status, attempts: { [run.init]: attempts } });
    return {
      items: 0,
      new: 0,
      errors: [`${failed} dari ${locations.size} titik hujan gagal (${error}); siklus ${run.init} diulang di run berikutnya (${attempts}/${MAX_ATTEMPTS})`],
    };
  }

  const sample = rain.values().next().value;
  const pastDates = sample.pastDays.map((d) => d.date);
  const dates = sample.days.map((d) => d.date);

  const wilayah = [];
  for (const [kode, regionPoints] of regions) {
    const daily = regionDailyOutlook(regionPoints, (point) => rain.get(point.rainKey), dates);
    const entry = { kode };
    for (const hazard of OUTLOOK_HAZARDS) {
      entry[hazard] = dates.map((date) => daily.find((d) => d.date === date && d.hazard === hazard).level);
    }
    wilayah.push(entry);
  }
  const counts = Object.fromEntries(
    dates.map((date, i) => {
      const tally = Object.fromEntries([...COUNT_KEYS, 'tanpa_data'].map((key) => [key, 0]));
      for (const entry of wilayah) {
        const level = highest(OUTLOOK_HAZARDS.map((hazard) => entry[hazard][i]));
        tally[level === null ? 'tanpa_data' : COUNT_KEYS[level]]++;
      }
      return [date, tally];
    }),
  );

  const base = `sigap-indikasi/${datePath(run.init)}/${run.init.slice(11, 13)}Z`;
  const keys = [...locations.keys()].sort();
  const rows = keys.map((key) => {
    const { lat, lon } = locations.get(key);
    const series = rain.get(key);
    const values = series ? [...series.pastDays, ...series.days].map((d) => d.precipitationMm) : [];
    return [lat, lon, ...values];
  });
  const record = {
    model: run.model,
    model_init: run.init,
    model_available: run.available,
    fetched_at: now,
    rules_version: RULES_VERSION,
    rules_sha256: sha256(stableStringify(rules)),
    titik_pantau: { count: points.length, sha256: sha256(stableStringify(points)) },
    locations: locations.size,
    locations_failed: failed,
    attempts,
    past_dates: pastDates,
    dates,
    hujan_file: `${base.split('/').at(-1)}-hujan.jsonl`,
    hujan_kolom: ['lat', 'lon', ...pastDates, ...dates],
    counts,
    wilayah,
  };
  // Hujan dulu, ringkasan sesudahnya: ringkasan selalu menunjuk ke hujan yang ada.
  await archive.writeOnce(`${base}-hujan.jsonl`, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const saved = await archive.writeOnce(`${base}.json`, `${JSON.stringify(record, null, 1)}\n`);
  await archive.writeJson(STATUS_FILE, { last_init: run.init, last_available: run.available, recorded_at: now, file: `${base}.json` });
  return {
    items: wilayah.length,
    new: saved ? 1 : 0,
    errors: failed ? [`${failed} dari ${locations.size} titik hujan gagal: ${error}`] : [],
  };
}
