import { Router } from 'express';
import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { weatherLabel } from '../lib/recorder.js';
import { rainCategory } from '../lib/warning-rules.js';
import { ATTRIBUTION as METAR_ATTRIBUTION, fetchMetar } from '../sources/metar.js';
import { accumulatedRain, ATTRIBUTION, dailyTotals, latestMainHour, STATIONS } from '../sources/synop.js';
import { lastSuccessfulSync } from '../sync-logs.js';

// Riwayat total harian 7 hari butuh laporan 00 UTC sampai 8 hari ke belakang.
const HISTORY_DAYS = 8;
const DAILY_BARS = 7;
// Laporan bandara lebih tua dari ini tidak lagi disebut "cuaca saat ini".
const METAR_MAX_AGE_MS = 2 * 3_600_000;
const CACHE_MS = 60_000;
const METAR_CACHE_MS = 10 * 60_000;

const MAIN_HOUR = `extract(hour FROM observed_at AT TIME ZONE 'UTC')::int % 6 = 0 AND extract(minute FROM observed_at) = 0`;
const MAIN_ROWS = `
  SELECT wmo, observed_at, rain_mm, rain_hours, rain_trace
  FROM synop_reports
  WHERE observed_at >= $1::timestamptz - make_interval(days => $2) AND ${MAIN_HOUR}
  ORDER BY wmo, observed_at`;
// Jumlah stasiun yang melaporkan hujan pada tiap jam utama dua hari terakhir.
const MAIN_COUNTS = `
  SELECT observed_at, count(*)::int AS stations
  FROM synop_reports
  WHERE observed_at >= $1::timestamptz - interval '2 days' AND rain_mm IS NOT NULL AND ${MAIN_HOUR}
  GROUP BY observed_at`;
const LATEST_ROWS = `
  SELECT DISTINCT ON (wmo) wmo, observed_at, weather, temp_c, first_seen_at
  FROM synop_reports
  WHERE observed_at >= $1::timestamptz - make_interval(days => $2)
  ORDER BY wmo, observed_at DESC`;

function groupByStation(rows) {
  const byStation = new Map();
  for (const row of rows) {
    if (!byStation.has(row.wmo)) byStation.set(row.wmo, []);
    byStation.get(row.wmo).push(row);
  }
  return byStation;
}

const withCategory = (rain) => {
  const category = rainCategory(rain.mm);
  return { ...rain, category: category?.id ?? null, category_label: category?.label ?? null };
};

// Hujan terukur di stasiun cuaca BMKG (laporan SYNOP lewat jaringan WMO) dan
// cuaca saat ini di bandaranya (METAR). `metar`, `now`, dan `cacheMs` dapat
// diganti saat test.
export function createWeatherRouter({ metar = fetchMetar, now = () => new Date(), cacheMs = CACHE_MS } = {}) {
  const router = Router();
  const loadMetar = memoize(() => metar(), METAR_CACHE_MS);

  const load = memoize(async () => {
    const reference = now();
    const [main, counts, latest, syncedAt] = await Promise.all([
      query(MAIN_ROWS, [reference, HISTORY_DAYS]),
      query(MAIN_COUNTS, [reference]),
      query(LATEST_ROWS, [reference, HISTORY_DAYS]),
      lastSuccessfulSync('synop'),
    ]);
    // Cuaca bandara hanya pelengkap: bila NOAA AWC tidak terjangkau, hujan terukur tetap tampil.
    const metarByIcao = await loadMetar().catch(() => new Map());
    const until = latestMainHour(counts.rows);
    const mainByStation = groupByStation(main.rows);

    const features = [];
    for (const row of latest.rows) {
      const station = STATIONS.get(row.wmo);
      if (!station) continue;
      const rows = mainByStation.get(row.wmo) ?? [];
      const rain = until ? accumulatedRain(rows, until) : null;
      const airport = station.icao ? metarByIcao.get(station.icao) : null;
      const fresh = airport && reference - new Date(airport.observed_at) <= METAR_MAX_AGE_MS;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
        properties: {
          wmo: station.wmo,
          nama: station.nama,
          wilayah: station.wilayah,
          provinsi: station.provinsi,
          icao: station.icao,
          elevasi_m: station.elevasi_m,
          observed_at: row.observed_at,
          first_seen_at: row.first_seen_at,
          temp_c: row.temp_c,
          weather: row.weather === null ? null : { code: row.weather, label: weatherLabel(row.weather) },
          // Akumulasi sampai jam utama `meta.until`; hours < 24 = laporan sebelumnya tidak lengkap.
          rain: rain && withCategory(rain),
          days: dailyTotals(rows).slice(-DAILY_BARS),
          metar: fresh ? airport : null,
        },
      });
    }

    return {
      type: 'FeatureCollection',
      attribution: `${ATTRIBUTION}. ${METAR_ATTRIBUTION}`,
      meta: {
        synced_at: syncedAt,
        until: until?.toISOString() ?? null,
        reporting: features.length,
        registered: STATIONS.size,
      },
      features,
    };
  }, cacheMs);

  router.get('/weather-stations', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60').json(await load());
  });
  return router;
}
