import { fetchJson } from '../lib/http.js';
import { ENSEMBLE_MODEL, ENSEMBLE_URL, summarizeLocation } from '../lib/recorder.js';

// Satu request memberi prakiraan hujan harian sekaligus elevasi titik
// (DEM Copernicus 90 m). Gratis untuk non-komersial, atribusi CC BY 4.0.
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
export const FORECAST_DAYS = 3;
// Hujan beberapa hari terakhir ikut menentukan kejenuhan tanah (hujan anteseden).
export const PAST_DAYS = 3;

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

export async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'precipitation_sum,precipitation_probability_max',
    timezone: 'Asia/Jakarta',
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
  });
  return parseForecast(await fetchJson(`${FORECAST_URL}?${params}`, { timeoutMs: 15_000 }), PAST_DAYS);
}

// ---------- Kemiringan lereng ----------

// Selisih elevasi titik 90 m (satu piksel DEM) di utara, selatan, timur, dan
// barat titik. Hasilnya lereng rata-rata sepanjang ±180 m: tebing pendek yang
// lebih curam tidak terlihat, jadi nilainya batas bawah kecuraman setempat.
export const SLOPE_STEP_M = 90;
const METERS_PER_DEGREE = 111_320;

export function slopeStencil(lat, lon, stepM = SLOPE_STEP_M) {
  const dLat = stepM / METERS_PER_DEGREE;
  const dLon = stepM / (METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return [
    { lat: lat + dLat, lon },
    { lat: lat - dLat, lon },
    { lat, lon: lon + dLon },
    { lat, lon: lon - dLon },
  ];
}

// Elevasi [utara, selatan, timur, barat] → kemiringan (derajat, beda hingga pusat).
export function slopeDegrees([north, south, east, west], stepM = SLOPE_STEP_M) {
  if (![north, south, east, west].every(Number.isFinite)) throw new Error('Elevasi sekitar titik tidak lengkap');
  const dzdy = (north - south) / (2 * stepM);
  const dzdx = (east - west) / (2 * stepM);
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
}

export async function fetchSlope(lat, lon) {
  const points = slopeStencil(lat, lon);
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(6)).join(','),
    longitude: points.map((p) => p.lon.toFixed(6)).join(','),
  });
  const json = await fetchJson(`${ELEVATION_URL}?${params}`, { timeoutMs: 15_000, retries: 0 });
  if (!Array.isArray(json?.elevation) || json.elevation.length !== points.length) throw new Error('Format elevasi Open-Meteo tidak dikenal');
  return { degrees: Math.round(slopeDegrees(json.elevation) * 10) / 10, stepM: SLOPE_STEP_M };
}

// ---------- Ensemble ----------

// Ensemble ECMWF 51 anggota; ringkasannya sama dengan yang direkam perekam arsip.
export async function fetchEnsemble(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'precipitation_sum',
    models: ENSEMBLE_MODEL,
    forecast_days: String(FORECAST_DAYS),
    timezone: 'Asia/Jakarta',
  });
  return { model: ENSEMBLE_MODEL, days: summarizeLocation(await fetchJson(`${ENSEMBLE_URL}?${params}`, { timeoutMs: 20_000, retries: 0 })) };
}
