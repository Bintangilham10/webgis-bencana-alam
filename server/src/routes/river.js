import { Router } from 'express';
import { memoize } from '../lib/cache.js';
import { buildRiverForecast, fetchRiverForecastJson, fetchRiverHistoryJson } from '../sources/glofas.js';
import { inRegion } from './risk.js';

// GloFAS diperbarui sekali sehari; ambang per sel tidak berubah.
const FORECAST_TTL_MS = 60 * 60_000;
const HISTORY_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_ENTRIES = 2000;

// Prakiraan debit sungai GloFAS di satu titik, dimuat terpisah dari /api/risk
// supaya debit historis (±6 detik saat sel pertama kali diminta) tidak
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
  // Kunci = koordinat sel dari jawaban prakiraan, jadi ambangnya pasti dari sel yang sama.
  const loadHistory = memoize(
    (key) => {
      const [lat, lon] = key.split(',').map(Number);
      return history(lat, lon);
    },
    HISTORY_TTL_MS,
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
    const past = await loadHistory(`${json.latitude},${json.longitude}`).catch(() => null);
    res.set('Cache-Control', 'public, max-age=600').json(buildRiverForecast({ lat, lon, forecast: json, history: past }));
  });
  return router;
}
