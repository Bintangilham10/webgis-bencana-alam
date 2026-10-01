import { query, withTransaction } from '../db.js';
import { RULES_VERSION } from '../lib/warning-rules.js';
import { OUTLOOK_WINDOW_DAYS, rainPoint, regionDailyOutlook, summarizeDays } from '../risk/outlook.js';
import { fetchRainPoints } from '../sources/open-meteo.js';

// Indikasi SIGAP (hujan lebat, banjir, tanah longsor) untuk seluruh kab/kota:
// hujan Open-Meteo di titik pantau × kelas bahaya InaRISK. Setiap run disimpan
// utuh, termasuk kab/kota yang Normal, untuk uji prospektif: level per hari di
// indikasi_hari, dan ringkasan 3 hari pertama di indikasi_wilayah.
const SAVE_SUMMARY = `
  INSERT INTO indikasi_wilayah (run_id, kode, hazard, level, peak_date, reason, titik)
  SELECT $1, kode, hazard, level, peak_date, reason,
         CASE WHEN lon IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(lon, lat), 4326) END
  FROM unnest($2::text[], $3::text[], $4::smallint[], $5::date[], $6::text[], $7::float8[], $8::float8[])
    AS t(kode, hazard, level, peak_date, reason, lon, lat)`;

const SAVE_DAYS = `
  INSERT INTO indikasi_hari (run_id, kode, hazard, tanggal, level, hujan_mm, reason, titik)
  SELECT $1, kode, hazard, tanggal, level, hujan_mm, reason,
         CASE WHEN lon IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(lon, lat), 4326) END
  FROM unnest($2::text[], $3::text[], $4::date[], $5::smallint[], $6::real[], $7::text[], $8::float8[], $9::float8[])
    AS t(kode, hazard, tanggal, level, hujan_mm, reason, lon, lat)`;

async function loadPoints() {
  const { rows } = await query(
    `SELECT kode, hazard, kelas, ST_Y(geom) AS lat, ST_X(geom) AS lon
     FROM titik_pantau ORDER BY kode, hazard, urutan`,
  );
  return rows;
}

const column = (rows, key) => rows.map((row) => row[key] ?? null);

export async function runIndikasi({ fetchRain = fetchRainPoints, onProgress } = {}) {
  const startedAt = new Date();
  const points = await loadPoints();
  if (!points.length) throw new Error('Titik pantau belum ada; jalankan npm run seed -- bahaya');

  // Titik dengan koordinat (3 desimal) yang sama cukup diminta sekali.
  const locations = new Map();
  const regions = new Map();
  for (const point of points) {
    const location = rainPoint(point.lat, point.lon);
    locations.set(location.key, location);
    point.rainKey = location.key;
    if (!regions.has(point.kode)) regions.set(point.kode, []);
    regions.get(point.kode).push(point);
  }
  const { rain, failed, error } = await fetchRain([...locations.values()], { onProgress });
  if (!rain.size) throw new Error(`Hujan gagal dimuat untuk semua titik: ${error}`);

  // Semua lokasi memakai zona waktu WIB, jadi tanggal prakiraannya sama.
  const dates = rain.values().next().value.days.map((d) => d.date);
  const daily = [];
  const summary = [];
  for (const [kode, regionPoints] of regions) {
    const days = regionDailyOutlook(regionPoints, (point) => rain.get(point.rainKey), dates);
    for (const day of days) daily.push({ kode, ...day });
    for (const item of summarizeDays(days, dates.slice(0, OUTLOOK_WINDOW_DAYS))) summary.push({ kode, ...item });
  }

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO indikasi_run (started_at, finished_at, rules_version, forecast_from, forecast_to, locations, locations_failed)
       VALUES ($1, now(), $2, $3, $4, $5, $6) RETURNING id`,
      [startedAt, RULES_VERSION, dates[0], dates.at(-1), locations.size, failed],
    );
    const runId = rows[0].id;
    await client.query(SAVE_SUMMARY, [runId, ...['kode', 'hazard', 'level', 'peakDate', 'reason', 'lon', 'lat'].map((key) => column(summary, key))]);
    await client.query(SAVE_DAYS, [runId, ...['kode', 'hazard', 'date', 'level', 'rainMm', 'reason', 'lon', 'lat'].map((key) => column(daily, key))]);
  });

  return {
    items: regions.size,
    message: failed ? `${failed} dari ${locations.size} titik hujan gagal dimuat: ${error}` : null,
  };
}
