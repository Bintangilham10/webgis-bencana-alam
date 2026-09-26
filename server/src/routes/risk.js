import { Router } from 'express';
import { memoize } from '../lib/cache.js';
import { buildRiskProfile } from '../risk/profile.js';
import { nearestFault, nearestVolcanoes, placeAt, recentQuakes } from '../risk/nearby.js';
import { identifyHazards } from '../sources/inarisk.js';
import { fetchForecast } from '../sources/open-meteo.js';

// Kawasan Indonesia (sedikit lebih lebar dari daratan) untuk menolak koordinat
// yang jelas keliru sebelum memanggil layanan luar.
const REGION = { south: -12, north: 7, west: 94, east: 142 };
const CACHE_TTL_MS = 10 * 60_000;

export function inRegion(lat, lon) {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= REGION.south && lat <= REGION.north && lon >= REGION.west && lon <= REGION.east
  );
}

// identify dan forecast bisa diganti saat test supaya tidak memanggil layanan asli.
export function createRiskRouter({ identify = identifyHazards, forecast = fetchForecast } = {}) {
  const router = Router();

  // Kunci cache = koordinat dibulatkan 3 desimal (±100 m, seukuran piksel InaRISK),
  // jadi klik berulang di sekitar titik yang sama tidak membebani server BNPB.
  const loadProfile = memoize(
    async (key) => {
      const [lat, lon] = key.split(',').map(Number);
      const [hazardIndices, weather, place, fault, volcanoes, quakes] = await Promise.all([
        identify(lat, lon),
        forecast(lat, lon).catch((err) => ({ error: err.message, days: [] })),
        placeAt(lat, lon),
        nearestFault(lat, lon),
        nearestVolcanoes(lat, lon),
        recentQuakes(lat, lon),
      ]);
      return buildRiskProfile({ lat, lon, place, hazardIndices, forecast: weather, fault, volcanoes, quakes });
    },
    CACHE_TTL_MS,
    { maxEntries: 1000 },
  );

  router.get('/risk', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!inRegion(lat, lon)) {
      return res.status(400).json({ error: 'Koordinat harus berupa angka di kawasan Indonesia (lat -12..7, lon 94..142)' });
    }
    res.json(await loadProfile(`${lat.toFixed(3)},${lon.toFixed(3)}`));
  });

  return router;
}
