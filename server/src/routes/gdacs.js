import { Router } from 'express';
import { memoize } from '../lib/cache.js';
import { ALERT_DAYS, ATTRIBUTION, fetchGdacsEvents, GREEN_DAYS } from '../sources/gdacs.js';

const CACHE_MS = 15 * 60_000;

// Peringatan GDACS untuk Indonesia sebagai pembanding peringatan nasional.
// fetchEvents dapat diganti saat test supaya tidak memanggil GDACS.
export function createGdacsRouter({ fetchEvents = fetchGdacsEvents } = {}) {
  const router = Router();
  const load = memoize(async () => {
    const events = await fetchEvents();
    return {
      type: 'FeatureCollection',
      attribution: ATTRIBUTION,
      meta: { fetched_at: new Date().toISOString(), alert_days: ALERT_DAYS, green_days: GREEN_DAYS },
      features: events.map(({ lon, lat, ...properties }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties,
      })),
    };
  }, CACHE_MS);

  router.get('/gdacs', async (req, res) => {
    let body;
    try {
      body = await load();
    } catch (err) {
      return res.status(502).json({ error: `GDACS tidak dapat dihubungi: ${err.message}` });
    }
    res.set('Cache-Control', 'public, max-age=600').json(body);
  });
  return router;
}
