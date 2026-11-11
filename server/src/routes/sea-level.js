import { Router } from 'express';
import { memoize } from '../lib/cache.js';
import { ATTRIBUTION, fetchSeries, fetchStations, FIT_HOURS, SHOW_HOURS } from '../sources/ioc-sealevel.js';

// Status tiap alat (sampel terakhir) diperiksa ulang paling sering tiap 10 menit.
const STATIONS_TTL_MS = 10 * 60_000;
// Alat mengirim data tiap menit, tetapi IOC menerimanya per kiriman 5–15 menit.
const SERIES_TTL_MS = 2 * 60_000;
const MAX_SERIES_ENTRIES = 100;

// Muka laut dari alat pasang surut Indonesia (IOC–UNESCO). Daftar alat untuk peta
// berasal dari daftar statis, dilengkapi status terkininya; deret satu alat
// dimuat saat popupnya dibuka, karena tiap deret adalah satu permintaan ±150 KB
// ke IOC. Layanan dapat diganti saat test.
export function createSeaLevelRouter({ stations = fetchStations, series = fetchSeries, now = () => Date.now() } = {}) {
  const router = Router();
  const loadStations = memoize(async () => ({ fetched_at: new Date(now()).toISOString(), list: await stations({ now: now() }) }), STATIONS_TTL_MS);
  const loadSeries = memoize(
    async (code) => {
      const station = (await loadStations()).list.find((item) => item.code === code);
      return station ? { station, series: await series(station, { now: now() }) } : null;
    },
    SERIES_TTL_MS,
    { maxEntries: MAX_SERIES_ENTRIES },
  );
  const unreachable = (res, err) => res.status(502).json({ error: `Layanan muka laut IOC tidak dapat dihubungi: ${err.message}` });

  router.get('/sea-level', async (req, res) => {
    let loaded;
    try {
      loaded = await loadStations();
    } catch (err) {
      return unreachable(res, err);
    }
    res.set('Cache-Control', 'public, max-age=300').json({
      type: 'FeatureCollection',
      attribution: ATTRIBUTION,
      meta: { fetched_at: loaded.fetched_at, stations: loaded.list.length, active: loaded.list.filter((station) => station.active).length },
      features: loaded.list.map(({ lat, lon, ...properties }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties,
      })),
    });
  });

  // Hanya kode stasiun Indonesia dari daftar di atas yang dilayani.
  router.get('/sea-level/:code', async (req, res) => {
    let loaded;
    try {
      loaded = await loadSeries(req.params.code);
    } catch (err) {
      return unreachable(res, err);
    }
    if (!loaded) return res.status(404).json({ error: 'Stasiun muka laut tidak dikenal' });
    const { station, series: data } = loaded;
    res.set('Cache-Control', 'public, max-age=60').json({
      code: station.code,
      nama: station.nama,
      url: station.url,
      attribution: ATTRIBUTION,
      fit_hours: FIT_HOURS,
      show_hours: SHOW_HOURS,
      ...data,
    });
  });
  return router;
}
