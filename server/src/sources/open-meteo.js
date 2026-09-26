import { fetchJson } from '../lib/http.js';

// Satu request memberi prakiraan hujan harian sekaligus elevasi titik
// (DEM Copernicus 90 m). Gratis untuk non-komersial, atribusi CC BY 4.0.
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const FORECAST_DAYS = 3;

export function parseForecast(json) {
  const daily = json?.daily;
  if (!Array.isArray(daily?.time)) throw new Error('Format Open-Meteo tidak dikenal');
  return {
    elevationM: Number.isFinite(json.elevation) ? json.elevation : null,
    days: daily.time.map((date, i) => ({
      date,
      precipitationMm: daily.precipitation_sum?.[i] ?? null,
      probabilityPct: daily.precipitation_probability_max?.[i] ?? null,
    })),
  };
}

export async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'precipitation_sum,precipitation_probability_max',
    timezone: 'Asia/Jakarta',
    forecast_days: String(FORECAST_DAYS),
  });
  return parseForecast(await fetchJson(`${FORECAST_URL}?${params}`, { timeoutMs: 15_000 }));
}
