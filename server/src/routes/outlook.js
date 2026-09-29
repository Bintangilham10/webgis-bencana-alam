import { Router } from 'express';
import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { WARNING_LEVELS } from '../lib/warning-rules.js';
import { OUTLOOK_HAZARDS } from '../risk/outlook.js';

export const ATTRIBUTION =
  'Indikasi SIGAP (aturan awal, belum dikalibrasi): prakiraan hujan Open-Meteo (CC BY 4.0) × kelas bahaya InaRISK BNPB. Bukan peringatan resmi.';
const COUNT_KEYS = ['normal', 'waspada', 'siaga', 'awas'];

const round = (x, digits = 3) => (x == null ? null : Math.round(x * 10 ** digits) / 10 ** digits);
const maxLevel = (levels) => (levels.every((l) => l === null) ? null : Math.max(...levels.filter((l) => l !== null)));

function countLevels(levels) {
  const counts = Object.fromEntries([...COUNT_KEYS, 'tanpa_data'].map((key) => [key, 0]));
  for (const level of levels) counts[level === null ? 'tanpa_data' : COUNT_KEYS[level]]++;
  return counts;
}

// Satu run → daftar kab/kota dengan tiga indikasi dan level tertingginya, plus
// batas [[selatan, barat], [utara, timur]] supaya peta bisa terbang ke sana.
async function buildOutlook(runId) {
  const { rows: runs } = await query(
    `SELECT id, rules_version, started_at, finished_at, forecast_from::text, forecast_to::text, locations, locations_failed
     FROM indikasi_run WHERE id = $1`,
    [runId],
  );
  const { rows } = await query(
    `SELECT i.kode, k.nama, p.nama AS provinsi, i.hazard, i.level, i.peak_date::text AS peak_date, i.reason,
            ST_Y(i.titik) AS lat, ST_X(i.titik) AS lon,
            ST_YMin(k.geom) AS s, ST_XMin(k.geom) AS w, ST_YMax(k.geom) AS n, ST_XMax(k.geom) AS e
     FROM indikasi_wilayah i
     JOIN wilayah k ON k.kode = i.kode
     JOIN wilayah p ON p.kode = k.induk_kode
     WHERE i.run_id = $1
     ORDER BY i.kode`,
    [runId],
  );

  const regions = new Map();
  for (const r of rows) {
    if (!regions.has(r.kode)) {
      regions.set(r.kode, {
        kode: r.kode,
        nama: r.nama,
        provinsi: r.provinsi,
        bounds: [[round(r.s), round(r.w)], [round(r.n), round(r.e)]],
        hazards: {},
      });
    }
    regions.get(r.kode).hazards[r.hazard] = {
      level: r.level,
      label: r.level === null ? null : WARNING_LEVELS[r.level],
      reason: r.reason,
      peak_date: r.peak_date,
      lat: round(r.lat, 5),
      lon: round(r.lon, 5),
    };
  }
  const list = [...regions.values()].map((region) => {
    const level = maxLevel(OUTLOOK_HAZARDS.map((hazard) => region.hazards[hazard]?.level ?? null));
    return { ...region, level, label: level === null ? null : WARNING_LEVELS[level] };
  });

  return {
    attribution: ATTRIBUTION,
    run: runs[0],
    counts: {
      tertinggi: countLevels(list.map((r) => r.level)),
      ...Object.fromEntries(OUTLOOK_HAZARDS.map((hazard) => [hazard, countLevels(list.map((r) => r.hazards[hazard]?.level ?? null))])),
    },
    regions: list,
  };
}

export function createOutlookRouter() {
  const router = Router();
  // Hasil satu run tidak berubah, jadi di-cache per id run.
  const loadOutlook = memoize(buildOutlook, 24 * 60 * 60 * 1000, { maxEntries: 2 });

  router.get('/outlook', async (req, res) => {
    const { rows } = await query('SELECT max(id) AS id FROM indikasi_run');
    if (rows[0].id === null) {
      return res.status(404).json({ error: 'Indikasi SIGAP belum tersedia: run pertama belum selesai' });
    }
    res.set('Cache-Control', 'public, max-age=300').json(await loadOutlook(rows[0].id));
  });
  return router;
}
