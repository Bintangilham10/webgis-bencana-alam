import { query, withTransaction } from '../db.js';
import { RULES_VERSION } from '../lib/warning-rules.js';
import { rainPoint, regionOutlook } from '../risk/outlook.js';
import { fetchRainPoints } from '../sources/open-meteo.js';

// Indikasi SIGAP 3 hari (hujan lebat, banjir, tanah longsor) untuk seluruh
// kab/kota: hujan Open-Meteo di titik pantau × kelas bahaya InaRISK. Setiap run
// disimpan utuh, termasuk kab/kota yang Normal, untuk uji prospektif.
const SAVE_RESULTS = `
  INSERT INTO indikasi_wilayah (run_id, kode, hazard, level, peak_date, reason, titik)
  SELECT $1, kode, hazard, level, peak_date, reason,
         CASE WHEN lon IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(lon, lat), 4326) END
  FROM unnest($2::text[], $3::text[], $4::smallint[], $5::date[], $6::text[], $7::float8[], $8::float8[])
    AS t(kode, hazard, level, peak_date, reason, lon, lat)`;

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

  const results = [];
  for (const [kode, regionPoints] of regions) {
    for (const indication of regionOutlook(regionPoints, (point) => rain.get(point.rainKey))) results.push({ kode, ...indication });
  }
  // Semua lokasi memakai zona waktu WIB, jadi tanggal prakiraannya sama.
  const { days } = rain.values().next().value;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO indikasi_run (started_at, finished_at, rules_version, forecast_from, forecast_to, locations, locations_failed)
       VALUES ($1, now(), $2, $3, $4, $5, $6) RETURNING id`,
      [startedAt, RULES_VERSION, days[0].date, days.at(-1).date, locations.size, failed],
    );
    await client.query(SAVE_RESULTS, [
      rows[0].id,
      ...['kode', 'hazard', 'level', 'peakDate', 'reason', 'lon', 'lat'].map((key) => column(results, key)),
    ]);
  });

  return {
    items: regions.size,
    message: failed ? `${failed} dari ${locations.size} titik hujan gagal dimuat: ${error}` : null,
  };
}
