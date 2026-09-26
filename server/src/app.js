import compression from 'compression';
import express from 'express';
import { earthquakesRouter } from './routes/earthquakes.js';
import { createGeocodeRouter } from './routes/geocode.js';
import { healthRouter } from './routes/health.js';
import { referenceRouter } from './routes/reference.js';
import { createRiskRouter } from './routes/risk.js';
import { volcanoesRouter } from './routes/volcanoes.js';

// `services` memungkinkan test mengganti layanan luar (InaRISK, Open-Meteo,
// Nominatim) dengan versi palsu.
export function createApp({ services = {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // GeoJSON batas wilayah dan sesar berukuran besar; gzip memangkasnya ±80%.
  app.use(compression());

  app.use(
    '/api',
    healthRouter,
    earthquakesRouter,
    volcanoesRouter,
    referenceRouter,
    createRiskRouter(services.risk),
    createGeocodeRouter(services.geocode),
  );
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

  // Express 5 meneruskan error dari handler async ke sini.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan di server' });
  });
  return app;
}
