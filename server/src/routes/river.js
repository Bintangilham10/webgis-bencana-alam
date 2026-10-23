import { Router } from 'express';
import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { buildRiverForecast, fetchRiverForecastJson, fetchRiverHistoryJson, returnPeriodThresholds } from '../sources/glofas.js';
import { inRegion } from './risk.js';

// GloFAS diperbarui sekali sehari; ambang per sel tidak berubah.
const FORECAST_TTL_MS = 60 * 60_000;
const THRESHOLDS_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_ENTRIES = 2000;

// Ambang tiap sel dihitung sekali dari debit historis lalu disimpan permanen,
// supaya permintaan riwayat yang mahal kuota (jatah Open-Meteo yang sama dengan
// indikasi SIGAP) tidak diulang setelah server dimulai ulang. Sel dengan riwayat
// kurang tetap dicatat (years NULL) supaya tidak diminta lagi.
const READ_THRESHOLDS = 'SELECT years, from_year, to_year, rp2, rp5, rp20 FROM glofas_thresholds WHERE lat = $1 AND lon = $2';
const SAVE_THRESHOLDS = `
  INSERT INTO glofas_thresholds (lat, lon, years, from_year, to_year, rp2, rp5, rp20)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (lat, lon) DO NOTHING`;

// Prakiraan debit sungai GloFAS di satu titik, dimuat terpisah dari /api/risk
// supaya debit historis (±2 detik saat sel pertama kali diminta) tidak
// memperlambat cek risiko. Layanan dapat diganti saat test.
export function createRiverRouter({ forecast = fetchRiverForecastJson, history = fetchRiverHistoryJson } = {}) {
  const router = Router();
  // ±1 km: titik berdekatan memakai sel GloFAS (±5 km) yang sama.
  const loadForecast = memoize(
    (key) => {
      const [lat, lon] = key.split(',').map(Number);
      return forecast(lat, lon);
    },
    FORECAST_TTL_MS,
    { maxEntries: MAX_ENTRIES },
  );
  // Kunci = koordinat sel dari jawaban prakiraan, jadi ambangnya pasti dari sel
  // yang sama. Yang disimpan hanya ambangnya, bukan riwayat harian (±0,9 MB per sel).
  const loadThresholds = memoize(
    async (key) => {
      const [lat, lon] = key.split(',').map(Number);
      const { rows } = await query(READ_THRESHOLDS, [lat, lon]);
      if (rows.length) return rows[0].years === null ? null : rows[0];
      const thresholds = returnPeriodThresholds((await history(lat, lon)).daily ?? {});
      const t = thresholds ?? {};
      await query(SAVE_THRESHOLDS, [lat, lon, t.years, t.from_year, t.to_year, t.rp2, t.rp5, t.rp20].map((v) => v ?? null));
      return thresholds;
    },
    THRESHOLDS_TTL_MS,
    { maxEntries: MAX_ENTRIES },
  );

  router.get('/river', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!inRegion(lat, lon)) {
      return res.status(400).json({ error: 'Koordinat harus berupa angka di kawasan Indonesia (lat -12..7, lon 94..142)' });
    }
    let json;
    try {
      json = await loadForecast(`${lat.toFixed(2)},${lon.toFixed(2)}`);
    } catch (err) {
      return res.status(502).json({ error: `GloFAS tidak dapat dihubungi: ${err.message}` });
    }
    // Ambang gagal dimuat: prakiraan tetap dikirim, tanpa level.
    const thresholds = await loadThresholds(`${json.latitude},${json.longitude}`).catch(() => null);
    res.set('Cache-Control', 'public, max-age=600').json(buildRiverForecast({ lat, lon, forecast: json, thresholds }));
  });
  return router;
}
