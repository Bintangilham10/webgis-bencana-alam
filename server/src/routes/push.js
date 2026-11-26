import express, { Router } from 'express';
import { config } from '../config.js';
import { ackDelivery, createPushDispatcher, findSubscription, removeSubscription, saveSubscription, validateSubscription } from '../push.js';

// Web Push: browser mendaftarkan langganannya di sini supaya notifikasi tetap sampai
// walau tab SIGAP ditutup. Hanya untuk aplikasi web SIGAP sendiri (tidak dibuka di
// /api/v1). Tanpa kunci VAPID di server, semuanya menjawab 503 dan aplikasi web
// menyembunyikan pilihannya.
const OFF = 'Notifikasi push belum diaktifkan di server ini.';

export function createPushRouter({ vapid = config.vapid, store = { saveSubscription, removeSubscription, findSubscription, ackDelivery }, dispatcher } = {}) {
  const router = Router();
  const json = express.json({ limit: '4kb' });
  const push = vapid ? (dispatcher ?? createPushDispatcher({ vapid })) : null;
  const requireOn = (req, res, next) => (vapid ? next() : res.status(503).json({ error: OFF }));

  // Kunci publik server, dibutuhkan browser untuk berlangganan.
  router.get('/push/key', requireOn, (req, res) => res.json({ publicKey: vapid.publicKey }));

  // Mendaftar, atau memperbarui pilihan (hanya sekitar lokasi saya, wilayah).
  router.post('/push/subscriptions', requireOn, json, async (req, res) => {
    const { value, error } = validateSubscription(req.body);
    if (error) return res.status(400).json({ error });
    const token = await store.saveSubscription(value);
    if (token === null) return res.status(503).json({ error: 'Pendaftaran notifikasi push sedang penuh. Coba lagi nanti.' });
    res.status(201).json({ token, area: value.lat === null ? null : { lat: value.lat, lon: value.lon, kode: value.kode }, nearOnly: value.nearOnly });
  });

  router.delete('/push/subscriptions', requireOn, json, async (req, res) => {
    if (typeof req.body?.endpoint !== 'string') return res.status(400).json({ error: 'endpoint harus diisi.' });
    await store.removeSubscription(req.body.endpoint);
    res.status(204).end();
  });

  // Pesan uji ke perangkat yang memintanya.
  router.post('/push/test', requireOn, json, async (req, res) => {
    const sub = typeof req.body?.endpoint === 'string' ? await store.findSubscription(req.body.endpoint) : null;
    if (!sub) return res.status(404).json({ error: 'Langganan push perangkat ini tidak ditemukan. Matikan lalu nyalakan lagi.' });
    const status = await push.test(sub);
    if (status >= 200 && status < 300) return res.json({ status });
    const gone = status === 404 || status === 410;
    res.status(502).json({ error: gone ? 'Langganan push perangkat ini sudah tidak berlaku. Matikan lalu nyalakan lagi.' : 'Layanan push browser tidak menerima pesan uji. Coba lagi nanti.', status });
  });

  // Laporan terima dari service worker. Selalu 204: pengirimnya tidak perlu tahu
  // apakah laporannya cocok dengan sebuah pengiriman.
  router.post('/push/ack', json, async (req, res) => {
    const { d, s } = req.body ?? {};
    if (vapid && Number.isSafeInteger(d) && d > 0 && typeof s === 'string' && s.length <= 64) await store.ackDelivery(d, s);
    res.status(204).end();
  });

  return router;
}
