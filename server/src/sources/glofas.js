import { fetchJson } from '../lib/http.js';

// Prakiraan debit sungai GloFAS (Global Flood Awareness System, Copernicus
// Emergency Management Service) lewat Flood API Open-Meteo: ensemble 50 anggota,
// sel ±5 km, diperbarui harian. Sungai kecil bisa tidak terwakili, dan sel
// terdekat belum tentu berada di sungai yang dimaksud. CC BY 4.0.
const FLOOD_URL = 'https://flood-api.open-meteo.com/v1/flood';
export const FORECAST_DAYS = 7;
// Debit historis (reanalisis GloFAS) untuk ambang banjir per sel.
const HISTORY_FROM = '1984-01-01';
const HISTORY_TO = '2024-12-31';
const MIN_DAYS_PER_YEAR = 300;
const MIN_YEARS = 10;

// Ambang seperti GloFAS: debit dengan periode ulang 2, 5, dan 20 tahun, di sini
// diperkirakan dari debit maksimum tahunan (peluang tidak terlampaui 1 − 1/T).
export const RETURN_PERIODS = [2, 5, 20];

const round = (x, digits = 1) => (Number.isFinite(x) ? Number(x.toFixed(digits)) : null);

function quantile(sorted, p) {
  const k = (sorted.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

export function returnPeriodThresholds({ time = [], river_discharge: discharge = [] }) {
  const byYear = new Map();
  time.forEach((date, i) => {
    const value = discharge[i];
    if (!Number.isFinite(value)) return;
    const year = date.slice(0, 4);
    const entry = byYear.get(year) ?? { count: 0, max: -Infinity };
    entry.count++;
    entry.max = Math.max(entry.max, value);
    byYear.set(year, entry);
  });
  const maxima = [...byYear.values()].filter((y) => y.count >= MIN_DAYS_PER_YEAR).map((y) => y.max).sort((a, b) => a - b);
  if (maxima.length < MIN_YEARS) return null;
  return {
    years: maxima.length,
    ...Object.fromEntries(RETURN_PERIODS.map((t) => [`rp${t}`, round(quantile(maxima, 1 - 1 / t))])),
  };
}

// Level 0–3 = di bawah ambang 2 tahunan, ≥ 2, ≥ 5, ≥ 20 tahunan.
export function returnPeriodLevel(value, thresholds) {
  if (!thresholds || !Number.isFinite(value)) return null;
  return RETURN_PERIODS.filter((t) => value >= thresholds[`rp${t}`]).length;
}

const distanceKm = (lat1, lon1, lat2, lon2) => {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

export function buildRiverForecast({ lat, lon, forecast, history }) {
  const daily = forecast?.daily;
  if (!Array.isArray(daily?.time)) throw new Error('format prakiraan GloFAS tidak dikenal');
  const thresholds = history ? returnPeriodThresholds(history.daily ?? {}) : null;
  const value = (key, i) => round(daily[key]?.[i]);
  const days = daily.time.map((date, i) => {
    const median = value('river_discharge_median', i);
    const max = value('river_discharge_max', i);
    return {
      date,
      median_m3s: median,
      p25_m3s: value('river_discharge_p25', i),
      p75_m3s: value('river_discharge_p75', i),
      max_m3s: max,
      // Level dari median ensemble; level_max = kemungkinan terburuk (anggota tertinggi).
      level: returnPeriodLevel(median, thresholds),
      level_max: returnPeriodLevel(max, thresholds),
    };
  });
  const known = days.filter((d) => d.median_m3s !== null);
  const peak = known.length ? known.reduce((a, b) => (b.median_m3s > a.median_m3s ? b : a)) : null;
  return {
    source: 'GloFAS (Copernicus Emergency Management Service) via Open-Meteo',
    cell: {
      lat: round(forecast.latitude, 4),
      lon: round(forecast.longitude, 4),
      distance_km: round(distanceKm(lat, lon, forecast.latitude, forecast.longitude)),
    },
    thresholds,
    days,
    peak: peak && { date: peak.date, median_m3s: peak.median_m3s, level: peak.level },
    level: known.length && thresholds ? Math.max(...known.map((d) => d.level)) : null,
    level_max: known.length && thresholds ? Math.max(...days.map((d) => d.level_max ?? 0)) : null,
  };
}

export const forecastUrl = (lat, lon) =>
  `${FLOOD_URL}?${new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'river_discharge_median,river_discharge_p25,river_discharge_p75,river_discharge_max',
    forecast_days: String(FORECAST_DAYS),
  })}`;

export const historyUrl = (lat, lon) =>
  `${FLOOD_URL}?${new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'river_discharge',
    start_date: HISTORY_FROM,
    end_date: HISTORY_TO,
  })}`;

export const fetchRiverForecastJson = (lat, lon, { getJson = fetchJson } = {}) => getJson(forecastUrl(lat, lon), { timeoutMs: 20_000 });
// ±300 KB dan ±6 detik per sel; hasilnya disimpan lama di cache (routes/river.js).
export const fetchRiverHistoryJson = (lat, lon, { getJson = fetchJson } = {}) =>
  getJson(historyUrl(lat, lon), { timeoutMs: 45_000, retries: 0 });
