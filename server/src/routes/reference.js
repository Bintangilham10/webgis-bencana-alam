import { Router } from 'express';
import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { featureCollection } from '../lib/geojson.js';

// Data rujukan yang hanya berubah saat seed ulang: sesar aktif dan batas wilayah.
export const referenceRouter = Router();

const ONE_HOUR_MS = 60 * 60 * 1000;

const loadFaults = memoize(async () => {
  const { rows } = await query(
    `SELECT id, nama, segmen, region, tipe, mmax, slip_rate_mm_per_year, panjang_km,
            ST_AsGeoJSON(geom, 4)::json AS geometry
     FROM faults ORDER BY id`,
  );
  return featureCollection(rows, undefined, {
    attribution: 'Sesar aktif: PuSGeN 2024, melalui layanan InaRISK BNPB',
  });
}, ONE_HOUR_MS);

// Toleransi penyederhanaan dalam derajat (0,01° ≈ 1,1 km) cukup untuk tampilan
// nasional; analisis spasial tetap memakai geometri penuh di database.
const WILAYAH_LEVELS = {
  provinsi: { tingkat: ['provinsi'], tolerance: 0.01 },
  kabkota: { tingkat: ['kabupaten', 'kota'], tolerance: 0.005 },
};

const loadWilayah = memoize(async (level) => {
  const { tingkat, tolerance } = WILAYAH_LEVELS[level];
  const { rows } = await query(
    `SELECT kode, nama, tingkat, induk_kode,
            ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $2), 4)::json AS geometry
     FROM wilayah WHERE tingkat = ANY($1) ORDER BY kode`,
    [tingkat, tolerance],
  );
  return featureCollection(rows, undefined, {
    attribution: 'Batas wilayah: Kepmendagri No 300.2.2-2430 Tahun 2025, data cahyadsn/wilayah_boundaries (MIT)',
  });
}, ONE_HOUR_MS);

referenceRouter.get('/faults', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').json(await loadFaults());
});

referenceRouter.get('/wilayah', async (req, res) => {
  const level = req.query.tingkat ?? 'provinsi';
  if (!(level in WILAYAH_LEVELS)) {
    return res.status(400).json({ error: `tingkat harus salah satu dari: ${Object.keys(WILAYAH_LEVELS).join(', ')}` });
  }
  res.set('Cache-Control', 'public, max-age=3600').json(await loadWilayah(level));
});
