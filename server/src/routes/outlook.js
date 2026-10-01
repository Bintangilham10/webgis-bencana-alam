import { Router } from 'express';
import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { wibDate } from '../lib/recorder.js';
import { WARNING_LEVELS } from '../lib/warning-rules.js';
import { OUTLOOK_HAZARDS, OUTLOOK_WINDOW_DAYS, summarizeDays } from '../risk/outlook.js';

export const ATTRIBUTION =
  'Indikasi SIGAP (aturan awal, belum dikalibrasi): prakiraan hujan Open-Meteo (CC BY 4.0) × kelas bahaya InaRISK BNPB. Bukan peringatan resmi.';
const COUNT_KEYS = ['normal', 'waspada', 'siaga', 'awas'];
const EXPIRED_REASON = 'Prakiraan run terakhir sudah lewat; indikasi baru dihitung pada run berikutnya';

const round = (x, digits = 3) => (x == null ? null : Math.round(x * 10 ** digits) / 10 ** digits);
const maxLevel = (levels) => (levels.every((l) => l === null) ? null : Math.max(...levels.filter((l) => l !== null)));
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function datesBetween(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function countLevels(levels) {
  const counts = Object.fromEntries([...COUNT_KEYS, 'tanpa_data'].map((key) => [key, 0]));
  for (const level of levels) counts[level === null ? 'tanpa_data' : COUNT_KEYS[level]]++;
  return counts;
}

const toHazard = ({ level, reason, peakDate, lat, lon }) => ({
  level,
  label: level === null ? null : WARNING_LEVELS[level],
  reason,
  peak_date: peakDate,
  lat: round(lat, 5),
  lon: round(lon, 5),
});

// Hari yang ditampilkan: hari ini (WIB) sampai dua hari berikutnya, dibatasi
// hari-hari yang diprakirakan run itu. Run sebelum aturan v0.2 tidak punya level
// per hari, jadi ringkasan run-nya dipakai apa adanya.
async function hazardsByRegion(run, today) {
  const { rows: hasDays } = await query('SELECT EXISTS (SELECT 1 FROM indikasi_hari WHERE run_id = $1) AS ada', [run.id]);
  if (!hasDays[0].ada) {
    const { rows } = await query(
      `SELECT kode, hazard, level, peak_date::text AS "peakDate", reason, ST_Y(titik) AS lat, ST_X(titik) AS lon
       FROM indikasi_wilayah WHERE run_id = $1`,
      [run.id],
    );
    const byRegion = new Map();
    for (const r of rows) {
      if (!byRegion.has(r.kode)) byRegion.set(r.kode, {});
      byRegion.get(r.kode)[r.hazard] = toHazard(r);
    }
    return { window: { from: run.forecast_from, to: run.forecast_to, expired: false }, byRegion };
  }

  const from = today > run.forecast_from ? today : run.forecast_from;
  const lastShown = addDays(today, OUTLOOK_WINDOW_DAYS - 1);
  const to = lastShown < run.forecast_to ? lastShown : run.forecast_to;
  const { rows } = await query(
    `SELECT kode, hazard, tanggal::text AS date, level, hujan_mm AS "rainMm", reason, ST_Y(titik) AS lat, ST_X(titik) AS lon
     FROM indikasi_hari WHERE run_id = $1 AND tanggal BETWEEN $2 AND $3`,
    [run.id, from, to],
  );
  const expired = from > to;
  const dates = expired ? [] : datesBetween(from, to);
  const days = new Map();
  for (const r of rows) {
    if (!days.has(r.kode)) days.set(r.kode, []);
    days.get(r.kode).push(r);
  }
  const { rows: codes } = await query('SELECT DISTINCT kode FROM indikasi_wilayah WHERE run_id = $1', [run.id]);
  const byRegion = new Map();
  for (const { kode } of codes) {
    const summary = expired
      ? OUTLOOK_HAZARDS.map((hazard) => ({ hazard, level: null, reason: EXPIRED_REASON, peakDate: null, lat: null, lon: null }))
      : summarizeDays(days.get(kode) ?? [], dates);
    byRegion.set(kode, Object.fromEntries(summary.map((s) => [s.hazard, toHazard(s)])));
  }
  return { window: { from: expired ? null : from, to: expired ? null : to, expired }, byRegion };
}

// Satu run → daftar kab/kota dengan tiga indikasi dan level tertingginya, plus
// batas [[selatan, barat], [utara, timur]] supaya peta bisa terbang ke sana.
async function buildOutlook(runId, today) {
  const { rows: runs } = await query(
    `SELECT id, rules_version, started_at, finished_at, forecast_from::text, forecast_to::text, locations, locations_failed
     FROM indikasi_run WHERE id = $1`,
    [runId],
  );
  const run = runs[0];
  const { window, byRegion } = await hazardsByRegion(run, today);
  const { rows } = await query(
    `SELECT k.kode, k.nama, p.nama AS provinsi,
            ST_YMin(k.geom) AS s, ST_XMin(k.geom) AS w, ST_YMax(k.geom) AS n, ST_XMax(k.geom) AS e
     FROM wilayah k JOIN wilayah p ON p.kode = k.induk_kode
     WHERE k.kode = ANY($1)
     ORDER BY k.kode`,
    [[...byRegion.keys()]],
  );

  const list = rows.map((r) => {
    const hazards = byRegion.get(r.kode);
    const level = maxLevel(OUTLOOK_HAZARDS.map((hazard) => hazards[hazard]?.level ?? null));
    return {
      kode: r.kode,
      nama: r.nama,
      provinsi: r.provinsi,
      bounds: [[round(r.s), round(r.w)], [round(r.n), round(r.e)]],
      hazards,
      level,
      label: level === null ? null : WARNING_LEVELS[level],
    };
  });

  return {
    attribution: ATTRIBUTION,
    run,
    window,
    counts: {
      tertinggi: countLevels(list.map((r) => r.level)),
      ...Object.fromEntries(OUTLOOK_HAZARDS.map((hazard) => [hazard, countLevels(list.map((r) => r.hazards[hazard]?.level ?? null))])),
    },
    regions: list,
  };
}

// today() dapat diganti saat test supaya jendela hari tidak bergantung jam.
export function createOutlookRouter({ today = () => wibDate(new Date()) } = {}) {
  const router = Router();
  // Satu run tidak berubah, tetapi jendelanya bergeser tiap tengah malam WIB.
  const loadOutlook = memoize((key) => {
    const [runId, day] = key.split('|');
    return buildOutlook(Number(runId), day);
  }, 24 * 60 * 60 * 1000, { maxEntries: 4 });

  router.get('/outlook', async (req, res) => {
    const { rows } = await query('SELECT max(id) AS id FROM indikasi_run');
    if (rows[0].id === null) {
      return res.status(404).json({ error: 'Indikasi SIGAP belum tersedia: run pertama belum selesai' });
    }
    res.set('Cache-Control', 'public, max-age=300').json(await loadOutlook(`${rows[0].id}|${today()}`));
  });
  return router;
}
