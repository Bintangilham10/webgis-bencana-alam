import { Router } from 'express';
import { query } from '../db.js';
import { sourceStatuses } from '../sync-logs.js';

export const healthRouter = Router();

healthRouter.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
  } catch {
    return res.status(503).json({ ok: false, database: false, sources: [] });
  }
  res.json({ ok: true, database: true, sources: await sourceStatuses() });
});

// Jam server, untuk menghitung selisih jam klien saat mengukur latensi notifikasi
// (e2e/scripts/latensi-notifikasi.mjs). Tidak menyentuh basis data, supaya waktu di
// jawabannya sedekat mungkin dengan saat jawaban dikirim. API dan basis data berjalan
// di mesin yang sama, jadi jam ini sama dengan created_at notifikasi.
healthRouter.get('/time', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ time: new Date().toISOString() });
});
