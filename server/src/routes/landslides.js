import { Router } from 'express';
import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { featureCollection } from '../lib/geojson.js';
import { ATTRIBUTION as CEWS_ATTRIBUTION, LEVEL_LABELS } from '../sources/bmkg-cews.js';
import { fetchLatestImerg } from '../sources/gibs.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
// Sama dengan toleransi batas kab/kota di reference.js.
const KABKOTA_TOLERANCE = 0.005;

// Riwayat kejadian gerakan tanah hanya berubah saat seed ulang.
const loadHistory = memoize(async () => {
  const { rows } = await query(
    `SELECT id, occurred_at, (props->>'jam_diketahui')::boolean AS jam_diketahui,
            props->>'tanggal' AS tanggal, props->>'presisi_tanggal' AS presisi_tanggal,
            props->>'tipe' AS tipe, props->>'sumber' AS sumber,
            props->>'desa' AS desa, props->>'kecamatan' AS kecamatan, props->>'kab_nama' AS kab_nama,
            props->>'provinsi' AS provinsi, ST_AsGeoJSON(geom, 4)::json AS geometry
     FROM events WHERE hazard = 'longsor' ORDER BY occurred_at`,
  );
  return featureCollection(rows, undefined, {
    attribution: 'Kejadian gerakan tanah: PVMBG, Badan Geologi, Kementerian ESDM (Portal MBG dan MAGMA Indonesia)',
  });
}, ONE_HOUR_MS);

const warnedCodes = (warnings) => Object.entries(warnings.by_code).filter(([, level]) => level >= 1).map(([kode]) => kode);

// Peringatan CEWS digambar sebagai choropleth di atas batas kab/kota SIGAP;
// hanya kab/kota berlevel Waspada ke atas yang dikirim.
async function warningFeatures(warnings) {
  const codes = warnedCodes(warnings);
  if (!codes.length) return [];
  const { rows } = await query(
    `SELECT kode, nama, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $2), 4)::json AS geometry
     FROM wilayah WHERE kode = ANY($1) ORDER BY kode`,
    [codes, KABKOTA_TOLERANCE],
  );
  return featureCollection(rows, ({ kode, nama }) => ({
    kode,
    nama,
    level: warnings.by_code[kode],
    level_label: LEVEL_LABELS[warnings.by_code[kode]],
  })).features;
}

// Ringkasan tanpa geometri untuk daftar di Ikhtisar: nama, provinsi, level, dan
// batas [[selatan, barat], [utara, timur]] supaya peta bisa terbang ke sana.
async function warningRegions(warnings) {
  const codes = warnedCodes(warnings);
  if (!codes.length) return [];
  const { rows } = await query(
    `SELECT k.kode, k.nama, p.nama AS provinsi,
            ST_YMin(k.geom) AS s, ST_XMin(k.geom) AS w, ST_YMax(k.geom) AS n, ST_XMax(k.geom) AS e
     FROM wilayah k JOIN wilayah p ON p.kode = k.induk_kode
     WHERE k.kode = ANY($1)`,
    [codes],
  );
  const round = (x) => Math.round(x * 1000) / 1000;
  return rows
    .map((r) => ({
      kode: r.kode,
      nama: r.nama,
      provinsi: r.provinsi,
      level: warnings.by_code[r.kode],
      level_label: LEVEL_LABELS[warnings.by_code[r.kode]],
      bounds: [[round(r.s), round(r.w)], [round(r.n), round(r.e)]],
    }))
    .sort((a, b) => b.level - a.level || a.nama.localeCompare(b.nama, 'id'));
}

const header = (warnings) => ({
  dasarian: warnings.dasarian,
  published: warnings.published,
  counts: warnings.counts,
  fetched_at: warnings.fetched_at,
});

// rainNow dapat diganti saat test supaya tidak memanggil NASA GIBS.
export function createLandslideRouter({ rainWarnings, rainNow = fetchLatestImerg }) {
  const router = Router();
  // Data CEWS sendiri di-cache 3 jam; lapisan ini disusun ulang paling sering tiap 10 menit.
  const loadWarningLayer = memoize(async () => {
    const warnings = await rainWarnings();
    return { type: 'FeatureCollection', attribution: CEWS_ATTRIBUTION, ...header(warnings), features: await warningFeatures(warnings) };
  }, 10 * 60 * 1000);
  const loadWarningSummary = memoize(async () => {
    const warnings = await rainWarnings();
    return { attribution: CEWS_ATTRIBUTION, ...header(warnings), regions: await warningRegions(warnings) };
  }, 10 * 60 * 1000);
  // IMERG terbit tiap 30 menit dengan jeda ±5 jam.
  const loadRainNow = memoize(() => rainNow(), 15 * 60 * 1000);

  const sendOr502 = (load, source) => async (req, res) => {
    let body;
    try {
      body = await load();
    } catch (err) {
      return res.status(502).json({ error: `${source} tidak dapat dihubungi: ${err.message}` });
    }
    res.set('Cache-Control', 'public, max-age=600').json(body);
  };

  router.get('/landslides', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600').json(await loadHistory());
  });
  router.get('/rain-warnings', sendOr502(loadWarningLayer, 'CEWS BMKG'));
  router.get('/rain-warnings/summary', sendOr502(loadWarningSummary, 'CEWS BMKG'));
  router.get('/rain-now', sendOr502(loadRainNow, 'NASA GIBS'));

  return router;
}
