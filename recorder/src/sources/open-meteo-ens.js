import { HttpError } from '../lib/http.js';
import { wibDate, wibHour } from '../lib/time.js';

// Ensemble ECMWF (51 anggota) dari Open-Meteo. API hanya menyimpan ±3 hari ke
// belakang, jadi peluang hujan harian direkam sendiri untuk uji prospektif.
export const ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';
export const MODEL = 'ecmwf_ifs025';
export const FORECAST_DAYS = 3;
export const THRESHOLDS_MM = [20, 50, 100];

// Run 00 UTC ECMWF biasanya sudah tersedia di Open-Meteo sekitar 08 UTC (15 WIB).
const START_HOUR_WIB = 15;
// Satu lokasi ensemble dihitung ±4 panggilan dan batas gratis 600 panggilan per
// menit (uji 27 Sep 2026: 429 setelah 150 lokasi). Request 50 lokasi (±200
// panggilan) diberi jeda 25 detik, jadi ±480 panggilan per menit. Semua titik
// diambil dalam satu run (±4 menit) karena jadwal GitHub Actions sering hanya
// berjalan beberapa kali sehari.
const POINTS_PER_REQUEST = 50;
const PAUSE_MS = 25_000;

export function ensembleUrl(points) {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(','),
    longitude: points.map((p) => p.lon).join(','),
    daily: 'precipitation_sum',
    models: MODEL,
    forecast_days: String(FORECAST_DAYS),
    timezone: 'Asia/Jakarta',
  });
  return `${ENSEMBLE_URL}?${params}`;
}

const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Satu lokasi → ringkasan per hari: median, p90, maksimum, dan peluang
// melewati tiap ambang (fraksi anggota ensemble).
export function summarizeLocation(location) {
  const daily = location?.daily;
  if (!Array.isArray(daily?.time)) throw new Error('format ensemble tidak dikenal');
  const columns = Object.keys(daily).filter((k) => k.startsWith('precipitation_sum'));
  return daily.time.map((date, i) => {
    const values = columns.map((c) => daily[c][i]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) return { date, n: 0 };
    const day = { date, n: values.length, median: round1(quantile(values, 0.5)), p90: round1(quantile(values, 0.9)), max: round1(values.at(-1)) };
    for (const t of THRESHOLDS_MM) day[`p${t}`] = round2(values.filter((v) => v >= t).length / values.length);
    return day;
  });
}

export async function recordOpenMeteoEns({ archive, http, now, data = {}, pause = async () => {} }) {
  const points = data.wilayah ?? [];
  if (!points.length) return { items: 0, new: 0, skipped: 'daftar titik kosong' };

  const date = wibDate(now);
  const status = (await archive.readJson('open-meteo-ens/status.json')) ?? {};
  if (status.date === date && status.completed_at) return { items: status.done, new: 0, skipped: 'sudah direkam hari ini' };
  if (wibHour(now) < START_HOUR_WIB) return { items: 0, new: 0, skipped: `menunggu pukul ${START_HOUR_WIB}.00 WIB` };

  const file = `open-meteo-ens/${date.replace(/-/g, '/')}.jsonl`;
  const done = new Set(((await archive.readText(file)) ?? '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).kode));
  const todo = points.filter((p) => !done.has(p.kode));
  let saved = 0;
  const errors = [];

  const batches = [];
  for (let i = 0; i < todo.length; i += POINTS_PER_REQUEST) batches.push(todo.slice(i, i + POINTS_PER_REQUEST));
  for (const [index, batch] of batches.entries()) {
    if (index > 0) await pause(PAUSE_MS);
    try {
      const json = await http.fetchJson(ensembleUrl(batch), { timeoutMs: 60_000 });
      const locations = Array.isArray(json) ? json : [json];
      if (locations.length !== batch.length) throw new Error(`jumlah lokasi ${locations.length}, diminta ${batch.length}`);
      for (const [j, point] of batch.entries()) {
        await archive.appendLine(file, { kode: point.kode, lat: point.lat, lon: point.lon, model: MODEL, fetched_at: now, days: summarizeLocation(locations[j]) });
        done.add(point.kode);
        saved++;
      }
    } catch (err) {
      errors.push(err.message);
      // Kuota habis: lanjutkan di run berikutnya.
      if (err instanceof HttpError && err.status === 429) break;
    }
  }

  const complete = done.size >= points.length;
  await archive.writeJson('open-meteo-ens/status.json', { date, total: points.length, done: done.size, ...(complete ? { completed_at: now } : {}) });
  if (errors.length && saved === 0) throw new Error(errors.slice(0, 3).join('; '));
  return { items: done.size, new: saved, errors };
}
