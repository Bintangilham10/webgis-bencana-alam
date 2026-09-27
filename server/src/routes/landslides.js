import { Router } from 'express';
import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { featureCollection } from '../lib/geojson.js';
import { ATTRIBUTION as CEWS_ATTRIBUTION, LEVEL_LABELS } from '../sources/bmkg-cews.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
// Sama dengan toleransi batas kab/kota di reference.js.
const KABKOTA_TOLERANCE = 0.005;

// Riwayat kejadian gerakan tanah hanya berubah saat seed ulang.
const loadHistory = memoize(async () => {
  const { rows } = await query(
    `SELECT id, props->>'tanggal' AS tanggal, props->>'tipe' AS tipe, props->>'sumber' AS sumber,
            props->>'desa' AS desa, props->>'kecamatan' AS kecamatan, props->>'kab_nama' AS kab_nama,
            props->>'provinsi' AS provinsi, ST_AsGeoJSON(geom, 4)::json AS geometry
     FROM events WHERE hazard = 'longsor' ORDER BY occurred_at`,
  );
  return featureCollection(rows, undefined, {
    attribution: 'Kejadian gerakan tanah: PVMBG, Badan Geologi, Kementerian ESDM (Portal MBG dan MAGMA Indonesia)',
  });
}, ONE_HOUR_MS);

// Peringatan CEWS digambar sebagai choropleth di atas batas kab/kota SIGAP;
// hanya kab/kota berlevel Waspada ke atas yang dikirim.
async function warningFeatures(warnings) {
  const codes = Object.entries(warnings.by_code).filter(([, level]) => level >= 1);
  if (!codes.length) return [];
  const { rows } = await query(
    `SELECT kode, nama, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $2), 4)::json AS geometry
     FROM wilayah WHERE kode = ANY($1) ORDER BY kode`,
    [codes.map(([kode]) => kode), KABKOTA_TOLERANCE],
  );
  return featureCollection(rows, ({ kode, nama }) => ({
    kode,
    nama,
    level: warnings.by_code[kode],
    level_label: LEVEL_LABELS[warnings.by_code[kode]],
  })).features;
}

export function createLandslideRouter({ rainWarnings }) {
  const router = Router();
  // Data CEWS sendiri di-cache 3 jam; lapisan ini disusun ulang paling sering tiap 10 menit.
  const loadWarningLayer = memoize(async () => {
    const warnings = await rainWarnings();
    return {
      type: 'FeatureCollection',
      attribution: CEWS_ATTRIBUTION,
      dasarian: warnings.dasarian,
      published: warnings.published,
      counts: warnings.counts,
      fetched_at: warnings.fetched_at,
      features: await warningFeatures(warnings),
    };
  }, 10 * 60 * 1000);

  router.get('/landslides', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600').json(await loadHistory());
  });

  router.get('/rain-warnings', async (req, res) => {
    let layer;
    try {
      layer = await loadWarningLayer();
    } catch (err) {
      return res.status(502).json({ error: `CEWS BMKG tidak dapat dihubungi: ${err.message}` });
    }
    res.set('Cache-Control', 'public, max-age=600').json(layer);
  });

  return router;
}
