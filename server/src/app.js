import compression from 'compression';
import express from 'express';
import { rateLimit } from './lib/rate-limit.js';
import { earthquakesRouter } from './routes/earthquakes.js';
import { createGeocodeRouter } from './routes/geocode.js';
import { healthRouter } from './routes/health.js';
import { createLandslideRouter } from './routes/landslides.js';
import { createOutlookRouter } from './routes/outlook.js';
import { referenceRouter } from './routes/reference.js';
import { createRiskRouter } from './routes/risk.js';
import { volcanoesRouter } from './routes/volcanoes.js';
import { createRainWarnings } from './sources/bmkg-cews.js';

// `services` memungkinkan test mengganti layanan luar (InaRISK, Open-Meteo,
// Nominatim, PVMBG, BMKG CEWS, NASA GIBS) dengan versi palsu.
export function createApp({ services = {} } = {}) {
  const app = express();
  // Satu cache peringatan CEWS untuk cek risiko dan layer peta.
  const rainWarnings = services.rainWarnings ?? createRainWarnings();
  app.disable('x-powered-by');
  // Di server produksi API berada di belakang Caddy (deploy/), jadi IP pengguna
  // dibaca dari X-Forwarded-For yang dikirim proxy di jaringan lokal/Docker.
  app.set('trust proxy', 'loopback, uniquelocal');
  // GeoJSON batas wilayah dan sesar berukuran besar; gzip memangkasnya ±80%.
  app.use(compression());

  // Satu cek risiko memanggil ±8 layanan luar; jawaban yang sama di-cache 10 menit.
  app.use(
    '/api/risk',
    rateLimit({
      limit: 120,
      windowMs: 10 * 60_000,
      message: 'Terlalu banyak cek risiko dari jaringan ini. Coba lagi beberapa menit lagi.',
      ...services.rateLimit,
    }),
  );
  app.use(
    '/api/geocode',
    rateLimit({
      limit: 60,
      windowMs: 60_000,
      message: 'Terlalu banyak pencarian dari jaringan ini. Coba lagi sebentar lagi.',
      ...services.rateLimit,
    }),
  );

  app.use(
    '/api',
    healthRouter,
    earthquakesRouter,
    volcanoesRouter,
    referenceRouter,
    createRiskRouter({ rainWarnings, ...services.risk }),
    createLandslideRouter({ rainWarnings, rainNow: services.rainNow, cloudsNow: services.cloudsNow }),
    createOutlookRouter(services.outlook),
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
