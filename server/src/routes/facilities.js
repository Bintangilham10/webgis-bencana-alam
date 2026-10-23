import { Router } from 'express';
import { query } from '../db.js';
import { highZonesAt } from '../risk/route-exposure.js';
import { ATTRIBUTION } from '../sources/overpass.js';
import { lastSuccessfulSync } from '../sync-logs.js';
import { inRegion } from './risk.js';

export const facilitiesRouter = Router();

// Jumlah terdekat per kategori dan jarak maksimumnya. Titik evakuasi OSM masih
// jarang (±1.600 se-Indonesia), jadi radiusnya lebih jauh dari fasilitas lain.
const NEAREST = [
  { category: 'evakuasi', n: 5, maxKm: 30 },
  { category: 'titik_kumpul', n: 5, maxKm: 30 },
  { category: 'rumah_sakit', n: 2, maxKm: 25 },
  { category: 'klinik', n: 2, maxKm: 15 },
  { category: 'polisi', n: 2, maxKm: 15 },
  { category: 'pemadam', n: 1, maxKm: 25 },
];
const LIMIT = Object.fromEntries(NEAREST.map((c) => [c.category, c.n]));
const EVACUATION = new Set(['evakuasi', 'titik_kumpul']);
const MAX_EVACUATION_SITES = 6;
// Satu tempat kadang dipetakan dua kali di OSM (titik dan gedung, mis. "RS Hermina
// Jatinegara" dan "RS HERMINA JATINEGARA"): nama sama dalam radius ini cukup sekali.
const DUPLICATE_WITHIN_M = 300;

const metersBetween = (a, b) => Math.hypot((a.lat - b.lat) * 110_574, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

// Kandidat diambil dua kali lipat supaya kategori tetap terisi n setelah kembarannya dibuang.
function nearestWithoutDuplicates(rows) {
  const kept = [];
  for (const row of rows) {
    const name = row.name?.trim().toLowerCase();
    const twin = name && kept.find((k) => k.name?.trim().toLowerCase() === name && metersBetween(k, row) <= DUPLICATE_WITHIN_M);
    const full = kept.filter((k) => k.category === row.category).length >= LIMIT[row.category];
    if (!twin && !full) kept.push(row);
  }
  return kept;
}

// KNN (<->) memilih kandidat per kategori lewat indeks GiST; jaraknya dihitung
// ulang dalam meter dengan geography.
const NEAREST_FACILITIES = `
  WITH p AS (SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326) AS g)
  SELECT f.id, c.category, f.name, f.tags, f.lat, f.lon, round(f.distance_m)::int AS distance_m
  FROM unnest($3::text[], $4::int[], $5::float8[]) AS c(category, n, max_m)
  CROSS JOIN LATERAL (
    SELECT id, name, tags, ST_Y(geom) AS lat, ST_X(geom) AS lon, ST_Distance(geom::geography, p.g::geography) AS distance_m
    FROM facilities, p
    WHERE category = c.category
    ORDER BY geom <-> p.g
    LIMIT c.n
  ) f
  WHERE f.distance_m <= c.max_m
  ORDER BY f.distance_m`;

// Titik evakuasi dan fasilitas penting terdekat dari satu titik (cek risiko, rute aman).
facilitiesRouter.get('/evacuation', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!inRegion(lat, lon)) {
    return res.status(400).json({ error: 'Koordinat harus berupa angka di kawasan Indonesia (lat -12..7, lon 94..142)' });
  }
  const { rows: nearest } = await query(NEAREST_FACILITIES, [
    lat, lon, NEAREST.map((c) => c.category), NEAREST.map((c) => c.n * 2), NEAREST.map((c) => c.maxKm * 1000),
  ]);
  // Tempat evakuasi OSM tidak dinilai keamanannya; yang berada di zona banjir atau
  // longsor tinggi ditandai supaya pengguna bisa memilih tempat lain.
  const kept = nearestWithoutDuplicates(nearest);
  const zones = await highZonesAt(kept);
  const rows = kept.map((row, i) => ({ ...row, zona_tinggi: zones[i] }));
  res.set('Cache-Control', 'public, max-age=600').json({
    attribution: ATTRIBUTION,
    evacuation: rows.filter((r) => EVACUATION.has(r.category)).slice(0, MAX_EVACUATION_SITES),
    facilities: rows.filter((r) => !EVACUATION.has(r.category)),
    radius_km: Object.fromEntries(NEAREST.map((c) => [c.category, c.maxKm])),
    synced_at: await lastSuccessfulSync('osm-fasilitas'),
  });
});

// Semua titik evakuasi dan titik kumpul (±1.600) untuk lapisan peta nasional.
facilitiesRouter.get('/evacuation-sites', async (req, res) => {
  const { rows } = await query(
    `SELECT id, category, name, ST_AsGeoJSON(geom, 5)::json AS geometry
     FROM facilities WHERE category IN ('evakuasi', 'titik_kumpul') ORDER BY id`,
  );
  res.set('Cache-Control', 'public, max-age=3600').json({
    type: 'FeatureCollection',
    attribution: ATTRIBUTION,
    meta: { count: rows.length, synced_at: await lastSuccessfulSync('osm-fasilitas') },
    features: rows.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties })),
  });
});
