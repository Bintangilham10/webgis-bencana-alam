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
// Hujan siklus yang belum lengkap, dicicil antar-run.
const PENDING_FILE = 'sigap-indikasi/pending.json';
// Dari runner GitHub satu permintaan 100 titik ke Open-Meteo butuh ±20 detik dan
// kadang gagal tersambung (uji 1 Okt 2026: 1 siklus = 18 menit, 500 titik gagal).
// Karena itu tiap run hanya mengambil hujan selama jatah ini; titik yang belum
// terambil atau gagal diambil di run berikutnya (±15 menit kemudian).
export const BUDGET_MS = 8 * 60_000;
// Siklus yang belum lengkap setelah sekian run disimpan apa adanya; titik yang
// tidak terambil bernilai null dan dihitung di locations_missing.
export const MAX_RUNS = 6;
const COUNT_KEYS = ['normal', 'waspada', 'siaga', 'awas'];

// Level tertinggi dari ketiga bahaya pada satu hari; null bila semua tanpa data.
const highest = (levels) => (levels.every((l) => l === null) ? null : Math.max(...levels.filter((l) => l !== null)));
const sameDates = (a, b) => a.length === b.length && a.every((d, i) => d === b[i]);

// Lokasi hujan unik (koordinat 3 desimal) dan titik pantau per kab/kota.
function layout(points) {
  const locations = new Map();
  const regions = new Map();
  for (const point of points) {
    const location = rainPoint(point.lat, point.lon);
    locations.set(location.key, location);
    if (!regions.has(point.kode)) regions.set(point.kode, []);
    regions.get(point.kode).push({ ...point, rainKey: location.key });
  }
  return { locations, regions };
}

// Siklus (hujan lengkap atau sebagian) → file arsip permanen dan status.
async function finalize(archive, cycle, points, now) {
  const { locations, regions } = layout(points);
  const nPast = cycle.past_dates.length;
  const seriesOf = (key) => {
    const values = cycle.hujan[key];
    if (!values) return null;
    return {
      pastDays: cycle.past_dates.map((date, i) => ({ date, precipitationMm: values[i] ?? null })),
      days: cycle.dates.map((date, i) => ({ date, precipitationMm: values[nPast + i] ?? null })),
    };
  };
  const wilayah = [];
  for (const [kode, regionPoints] of regions) {
    const daily = regionDailyOutlook(regionPoints, (point) => seriesOf(point.rainKey), cycle.dates);
    const entry = { kode };
    for (const hazard of OUTLOOK_HAZARDS) {
      entry[hazard] = cycle.dates.map((date) => daily.find((d) => d.date === date && d.hazard === hazard).level);
    }
    wilayah.push(entry);
  }
  const counts = Object.fromEntries(
    cycle.dates.map((date, i) => {
      const tally = Object.fromEntries([...COUNT_KEYS, 'tanpa_data'].map((key) => [key, 0]));
      for (const entry of wilayah) {
        const level = highest(OUTLOOK_HAZARDS.map((hazard) => entry[hazard][i]));
        tally[level === null ? 'tanpa_data' : COUNT_KEYS[level]]++;
      }
      return [date, tally];
    }),
  );

  const base = `sigap-indikasi/${datePath(cycle.init)}/${cycle.init.slice(11, 13)}Z`;
  const width = nPast + cycle.dates.length;
  const rows = [...locations.keys()].sort().map((key) => {
    const { lat, lon } = locations.get(key);
    return [lat, lon, ...(cycle.hujan[key] ?? Array(width).fill(null))];
  });
  const missing = rows.filter((row) => row.slice(2).every((v) => v === null)).length;
  const record = {
    model: cycle.model,
    model_init: cycle.init,
    model_available: cycle.available,
    first_fetched_at: cycle.first_fetched_at,
    completed_at: now,
    runs: cycle.runs,
    rules_version: RULES_VERSION,
    rules_sha256: sha256(stableStringify(rules)),
    titik_pantau: { count: points.length, sha256: sha256(stableStringify(points)) },
    locations: locations.size,
    locations_missing: missing,
    past_dates: cycle.past_dates,
    dates: cycle.dates,
    hujan_file: `${base.split('/').at(-1)}-hujan.jsonl`,
    hujan_kolom: ['lat', 'lon', ...cycle.past_dates, ...cycle.dates],
    counts,
    wilayah,
  };
  // Hujan dulu, ringkasan sesudahnya: ringkasan selalu menunjuk ke hujan yang ada.
  await archive.writeOnce(`${base}-hujan.jsonl`, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const saved = await archive.writeOnce(`${base}.json`, `${JSON.stringify(record, null, 1)}\n`);
  await archive.writeJson(STATUS_FILE, { last_init: cycle.init, last_available: cycle.available, recorded_at: now, file: `${base}.json` });
  await archive.remove(PENDING_FILE);
  return { saved, missing, regions: wilayah.length };
}

export async function recordSigapIndikasi({ archive, http, now, data = {}, pause = async () => {}, clock = Date.now }) {
  const points = data.titikPantau ?? [];
  if (!points.length) return { items: 0, new: 0, skipped: 'daftar titik pantau kosong' };

  const readModel = async () => parseModelRun(await http.fetchJson(MODEL_META_URL, { timeoutMs: 20_000 }));
  const run = await readModel();
  const status = (await archive.readJson(STATUS_FILE)) ?? {};
  let pending = await archive.readJson(PENDING_FILE);
  const notes = [];
  let saved = 0;

  // Siklus baru terbit sebelum siklus lama lengkap: siklus lama disimpan apa adanya,
  // tidak dilanjutkan dengan hujan dari siklus baru.
  if (pending && pending.init !== run.init) {
    const old = await finalize(archive, pending, points, now);
    saved += old.saved ? 1 : 0;
    notes.push(`siklus ${pending.init} disimpan dengan ${old.missing} titik tanpa hujan karena siklus baru terbit`);
    pending = null;
  }
  if (status.last_init && status.last_init >= run.init && !pending) {
    return saved ? { items: 0, new: saved, errors: notes } : { items: 0, new: 0, skipped: `siklus ${run.init} sudah direkam` };
  }

  const { locations } = layout(points);
  const stored = { ...(pending?.hujan ?? {}) };
  const todo = [...locations.values()].filter((location) => !stored[location.key]);
  const started = clock();
  const { rain, failed, error, notStarted } = await fetchRainPoints(todo, {
    getJson: http.fetchJson,
    sleep: pause,
    clock,
    deadline: started + BUDGET_MS,
  });

  // Model berganti di tengah run: hujan run ini bisa campuran dua siklus, jadi dibuang.
  const after = await readModel();
  if (after.init !== run.init) {
    if (pending) {
      const old = await finalize(archive, pending, points, now);
      saved += old.saved ? 1 : 0;
    }
    notes.push(`siklus model berganti dari ${run.init} ke ${after.init} saat hujan diambil; hujan run ini dibuang`);
    return { items: 0, new: saved, errors: notes };
  }

  const sample = rain.values().next().value;
  const cycle = {
    model: run.model,
    init: run.init,
    available: run.available,
    first_fetched_at: pending?.first_fetched_at ?? now,
    runs: (pending?.runs ?? 0) + 1,
    past_dates: pending?.past_dates ?? sample?.pastDays.map((d) => d.date) ?? [],
    dates: pending?.dates ?? sample?.days.map((d) => d.date) ?? [],
    hujan: stored,
  };
  for (const [key, series] of rain) {
    // Pergantian hari WIB di antara run menggeser deret tanggal; titik seperti itu
    // tidak digabung (dianggap belum terambil).
    if (!sameDates(series.pastDays.map((d) => d.date), cycle.past_dates) || !sameDates(series.days.map((d) => d.date), cycle.dates)) continue;
    stored[key] = [...series.pastDays, ...series.days].map((d) => d.precipitationMm);
  }

  const have = Object.keys(stored).length;
  if (!have) throw new Error(`hujan gagal dimuat untuk semua titik: ${error ?? 'tidak ada titik yang sempat diminta'}`);
  const progress = `${have}/${locations.size} titik hujan`;
  if (failed) notes.push(`${failed} titik gagal diambil (${error})`);
  if (have < locations.size && cycle.runs < MAX_RUNS) {
    await archive.writeJson(PENDING_FILE, cycle);
    notes.push(`siklus ${run.init}: ${progress}${notStarted ? `, ${notStarted} menunggu jatah waktu run berikutnya` : ''}; dilanjutkan di run berikutnya (${cycle.runs}/${MAX_RUNS})`);
    return { items: have, new: saved, errors: notes };
  }

  const result = await finalize(archive, cycle, points, now);
  saved += result.saved ? 1 : 0;
  if (result.missing) notes.push(`siklus ${run.init} disimpan dengan ${result.missing} titik tanpa hujan setelah ${cycle.runs} run`);
  return { items: result.regions, new: saved, errors: notes };
}
