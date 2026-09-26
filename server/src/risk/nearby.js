import { query } from '../db.js';
import { VOLCANO_LEVELS } from '../lib/classify.js';

// Query kedekatan untuk cek risiko. Kandidat diambil dengan KNN (`<->`, cepat
// karena memakai indeks GiST, tapi dalam derajat), lalu diurutkan ulang dengan
// jarak geodesik (geography) supaya jarak yang dilaporkan akurat dalam meter.
const POINT = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)';
const KNN_CANDIDATES = 8;
const round1 = (meters) => Math.round(meters / 100) / 10;

export async function placeAt(lat, lon) {
  const { rows } = await query(
    `SELECT k.kode, k.nama, p.nama AS provinsi
     FROM wilayah k JOIN wilayah p ON p.kode = k.induk_kode
     WHERE k.tingkat <> 'provinsi' AND ST_Intersects(k.geom, ${POINT})
     LIMIT 1`,
    [lon, lat],
  );
  return rows[0] ?? null;
}

export async function nearestFault(lat, lon) {
  const { rows } = await query(
    `WITH candidates AS (
       SELECT * FROM faults ORDER BY geom <-> ${POINT} LIMIT ${KNN_CANDIDATES}
     )
     SELECT id, nama, segmen, tipe, mmax,
            ST_Distance(geom::geography, ${POINT}::geography) AS distance_m,
            ST_AsGeoJSON(ST_ClosestPoint(geom, ${POINT}), 5)::json AS closest
     FROM candidates ORDER BY distance_m LIMIT 1`,
    [lon, lat],
  );
  const f = rows[0];
  return f && {
    id: f.id,
    nama: f.nama,
    segmen: f.segmen,
    tipe: f.tipe,
    mmax: f.mmax,
    distance_km: round1(f.distance_m),
    closest_point: f.closest.coordinates,
  };
}

export async function nearestVolcanoes(lat, lon, limit = 3) {
  const { rows } = await query(
    `WITH candidates AS (
       SELECT * FROM volcanoes ORDER BY geom <-> ${POINT} LIMIT ${KNN_CANDIDATES}
     )
     SELECT kode, nama, level, ST_X(geom) AS lon, ST_Y(geom) AS lat,
            ST_Distance(geom::geography, ${POINT}::geography) AS distance_m
     FROM candidates ORDER BY distance_m LIMIT $3`,
    [lon, lat, limit],
  );
  return rows.map((v) => ({
    kode: v.kode,
    nama: v.nama,
    level: v.level,
    level_label: VOLCANO_LEVELS[v.level],
    distance_km: round1(v.distance_m),
    coordinates: [v.lon, v.lat],
  }));
}

export async function recentQuakes(lat, lon, { radiusKm = 100, days = 7 } = {}) {
  const { rows } = await query(
    `SELECT magnitude, depth_km, occurred_at, props->>'wilayah' AS wilayah,
            ST_Distance(geom::geography, ${POINT}::geography) AS distance_m
     FROM events
     WHERE hazard = 'gempa'
       AND occurred_at >= now() - make_interval(days => $4)
       AND ST_DWithin(geom::geography, ${POINT}::geography, $3)
     ORDER BY magnitude DESC`,
    [lon, lat, radiusKm * 1000, days],
  );
  return {
    radius_km: radiusKm,
    days,
    count: rows.length,
    strongest: rows[0]
      ? { ...rows[0], distance_km: round1(rows[0].distance_m), distance_m: undefined }
      : null,
  };
}
