// Hujan harian Open-Meteo untuk banyak titik pantau: dipakai indikasi SIGAP di
// server dan arsip indikasi di perekam (impor satu arah: server → recorder).
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
// Model diminta eksplisit supaya arsip menyebut sumbernya. best_match Open-Meteo
// di Indonesia = ECMWF IFS 9 km (diuji 29 Sep dan 1 Okt 2026: nilainya identik).
export const RAIN_MODEL = 'ecmwf_ifs';
// Waktu inisialisasi dan ketersediaan run model terakhir di Open-Meteo.
export const MODEL_META_URL = `https://api.open-meteo.com/data/${RAIN_MODEL}/static/meta.json`;
// Hujan beberapa hari terakhir ikut menentukan kejenuhan tanah (hujan anteseden).
export const PAST_DAYS = 3;
// Hari keempat membuat run malam hari tetap menutup tiga hari penuh pada
// keesokan paginya (jendela peta = hari ini sampai H+2).
export const OUTLOOK_FORECAST_DAYS = 4;

// Satu lokasi dihitung satu panggilan kuota Open-Meteo (gratis ±10.000/hari,
// 5.000/jam, dan 600/menit), jadi permintaan 100 lokasi dimulai paling cepat tiap
// 12 detik (±500/menit). Jeda dihitung dari awal permintaan sebelumnya: bila
// balasannya sudah lambat (mis. ±20 detik dari runner GitHub), tidak ada jeda tambahan.
const RAIN_BATCH = 100;
const RAIN_PAUSE_MS = 12_000;
const QUOTA_WAIT_MS = 65_000;
// Tiga permintaan berturut-turut gagal berarti Open-Meteo sedang bermasalah atau
// kuota harian habis: sisa titik tidak diminta supaya run cepat selesai.
const MAX_FAILED_BATCHES = 3;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dayOf = (daily, i) => ({
  date: daily.time[i],
  precipitationMm: daily.precipitation_sum?.[i] ?? null,
  probabilityPct: daily.precipitation_probability_max?.[i] ?? null,
});

// pastDays = jumlah hari lalu di awal deret (parameter past_days Open-Meteo).
export function parseForecast(json, pastDays = 0) {
  const daily = json?.daily;
  if (!Array.isArray(daily?.time)) throw new Error('Format Open-Meteo tidak dikenal');
  const all = daily.time.map((_, i) => dayOf(daily, i));
  return {
    elevationM: Number.isFinite(json.elevation) ? json.elevation : null,
    pastDays: all.slice(0, pastDays).map(({ date, precipitationMm }) => ({ date, precipitationMm })),
    days: all.slice(pastDays),
  };
}

export function rainBatchUrl(locations) {
  const params = new URLSearchParams({
    latitude: locations.map((l) => l.lat).join(','),
    longitude: locations.map((l) => l.lon).join(','),
    daily: 'precipitation_sum',
    models: RAIN_MODEL,
    timezone: 'Asia/Jakarta',
    past_days: String(PAST_DAYS),
    forecast_days: String(OUTLOOK_FORECAST_DAYS),
  });
  return `${FORECAST_URL}?${params}`;
}

// meta.json Open-Meteo → waktu ISO inisialisasi dan ketersediaan run terakhir.
export function parseModelRun(meta) {
  const init = meta?.last_run_initialisation_time;
  const available = meta?.last_run_availability_time;
  if (!Number.isFinite(init)) throw new Error('meta.json Open-Meteo tidak memuat last_run_initialisation_time');
  return {
    model: RAIN_MODEL,
    init: new Date(init * 1000).toISOString(),
    available: Number.isFinite(available) ? new Date(available * 1000).toISOString() : null,
  };
}

// Kuota per menit habis (HTTP 429): tunggu satu menit, lalu coba sekali lagi.
async function fetchBatch(batch, { getJson, sleep }) {
  const get = async () => {
    const json = await getJson(rainBatchUrl(batch), { timeoutMs: 60_000, retries: 1 });
    const locations = Array.isArray(json) ? json : [json];
    if (locations.length !== batch.length) throw new Error(`Open-Meteo mengirim ${locations.length} lokasi, diminta ${batch.length}`);
    return locations.map((location) => parseForecast(location, PAST_DAYS));
  };
  try {
    return await get();
  } catch (err) {
    if (err.status !== 429) throw err;
    await sleep(QUOTA_WAIT_MS);
    return get();
  }
}

// locations: [{ key, lat, lon }] → { rain: Map(key → { pastDays, days }), failed, error, notStarted }.
// Batch yang gagal tidak menghentikan run; lokasinya dihitung di `failed`.
// getJson(url, options) wajib diberikan: server dan perekam punya klien HTTP sendiri.
// deadline (ms epoch, opsional): batch baru tidak dimulai lagi setelah waktu ini;
// lokasi yang belum diminta dihitung di `notStarted` (bukan gagal) supaya bisa dicicil.
export async function fetchRainPoints(
  locations,
  { getJson, batchSize = RAIN_BATCH, pauseMs = RAIN_PAUSE_MS, sleep = pause, onProgress, deadline = Infinity, clock = Date.now } = {},
) {
  if (!getJson) throw new Error('fetchRainPoints butuh getJson');
  const rain = new Map();
  let failed = 0;
  let notStarted = 0;
  let failedInRow = 0;
  let error = null;
  let lastStart = null;
  for (let start = 0; start < locations.length; start += batchSize) {
    const batch = locations.slice(start, start + batchSize);
    if (clock() >= deadline) {
      notStarted += batch.length;
      continue;
    }
    if (failedInRow >= MAX_FAILED_BATCHES) {
      failed += batch.length;
      continue;
    }
    if (lastStart !== null) {
      const wait = pauseMs - (clock() - lastStart);
      if (wait > 0) await sleep(wait);
    }
    lastStart = clock();
    try {
      const series = await fetchBatch(batch, { getJson, sleep });
      batch.forEach((location, k) => rain.set(location.key, series[k]));
      failedInRow = 0;
    } catch (err) {
      failed += batch.length;
      failedInRow++;
      error = err.message;
    }
    onProgress?.({ done: start + batch.length, total: locations.length, failed });
  }
  return { rain, failed, error, notStarted };
}
