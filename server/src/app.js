import compression from 'compression';
import express from 'express';
import { rateLimit } from './lib/rate-limit.js';
import { capRouter } from './routes/cap.js';
import { earthquakesRouter } from './routes/earthquakes.js';
import { facilitiesRouter } from './routes/facilities.js';
import { createGdacsRouter } from './routes/gdacs.js';
import { createGeocodeRouter } from './routes/geocode.js';
import { healthRouter } from './routes/health.js';
import { createLandslideRouter } from './routes/landslides.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createOutlookRouter } from './routes/outlook.js';
import { referenceRouter } from './routes/reference.js';
import { createRiskRouter } from './routes/risk.js';
import { createRiverRouter } from './routes/river.js';
import { createRouteRouter } from './routes/route.js';
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
  // Aliran notifikasi (SSE) tidak dikompres: kompresi menahan event di buffer.
  app.use(compression({ filter: (req, res) => req.path !== '/api/stream' && compression.filter(req, res) }));

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
  // Debit sungai GloFAS dimuat sekali per cek risiko, jadi batasnya sama.
  app.use(
    '/api/river',
    rateLimit({
      limit: 120,
      windowMs: 10 * 60_000,
      message: 'Terlalu banyak permintaan debit sungai dari jaringan ini. Coba lagi beberapa menit lagi.',
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
  // Rute dihitung layanan publik FOSSGIS; satu permintaan rute aman memanggilnya 1–2 kali.
  app.use(
    '/api/route',
    rateLimit({
      limit: 30,
      windowMs: 10 * 60_000,
      message: 'Terlalu banyak permintaan rute dari jaringan ini. Coba lagi beberapa menit lagi.',
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
    createGdacsRouter(services.gdacs),
    createRiverRouter(services.river),
    capRouter,
    createNotificationsRouter(services.notifications),
    facilitiesRouter,
    createRouteRouter(services.route),
  );
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

  // Express 5 meneruskan error dari handler async ke sini.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan di server' });
  });
  return app;
}
