import { Router } from 'express';
import { memoize } from '../lib/cache.js';
import { buildRiskProfile, COAST_TOLERANCE_KM } from '../risk/profile.js';
import { nearbyLandslides, nearestFault, nearestVolcanoes, placeAt, recentQuakes } from '../risk/nearby.js';
import { levelFor } from '../sources/bmkg-cews.js';
import { identifyHazards } from '../sources/inarisk.js';
import { fetchEnsemble, fetchForecast, fetchSlope } from '../sources/open-meteo.js';
import { fetchLandslidePotential } from '../sources/pvmbg.js';

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

const failed = (err) => ({ error: err.message });

// Layanan luar bisa diganti saat test supaya tidak memanggil layanan asli.
// rainWarnings dipakai bersama dengan layer peta (lihat app.js).
export function createRiskRouter({
  identify = identifyHazards,
  forecast = fetchForecast,
  potential = fetchLandslidePotential,
  slope = fetchSlope,
  ensemble = fetchEnsemble,
  rainWarnings,
} = {}) {
  const router = Router();

  // Kunci cache = koordinat dibulatkan 3 desimal (±100 m, seukuran piksel InaRISK),
  // jadi klik berulang di sekitar titik yang sama tidak membebani server BNPB.
  const loadProfile = memoize(
    async (key) => {
      const [lat, lon] = key.split(',').map(Number);
      const [hazardIndices, weather, place, fault, volcanoes, quakes, pvmbg, cews, members, terrain, history] = await Promise.all([
        identify(lat, lon),
        forecast(lat, lon).catch((err) => ({ error: err.message, days: [] })),
        placeAt(lat, lon),
        nearestFault(lat, lon),
        nearestVolcanoes(lat, lon),
        recentQuakes(lat, lon),
        potential(lat, lon).catch(failed),
        rainWarnings().catch(failed),
        ensemble(lat, lon).catch(failed),
        slope(lat, lon).catch(failed),
        nearbyLandslides(lat, lon),
      ]);
      // Peringatan CEWS berlaku per kab/kota: hanya untuk titik di dalam atau di pesisirnya.
      const regionCode = place && place.distance_km <= COAST_TOLERANCE_KM ? place.kode : null;
      const rainWarning = cews.error ? cews : { ...cews, level: levelFor(cews, regionCode) };
      const landslide = { potential: pvmbg, rainWarning, ensemble: members, slope: terrain, history };
      return buildRiskProfile({ lat, lon, place, hazardIndices, forecast: weather, fault, volcanoes, quakes, landslide });
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
