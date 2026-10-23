import { Router } from 'express';
import { notificationBus, recentNotifications } from '../notifications.js';

// Daftar notifikasi terbaru dan aliran notifikasi langsung (Server-Sent Events).
// Browser tersambung ke /api/stream; bila koneksi putus, EventSource menyambung
// lagi sendiri dengan header Last-Event-ID, dan notifikasi yang terlewat dikirim
// ulang (paling lama 24 jam). Komentar ": ping" tiap 25 detik menjaga koneksi
// tetap hidup melewati proxy.
export function createNotificationsRouter({ bus = notificationBus, maxClients = 500, heartbeatMs = 25_000 } = {}) {
  const router = Router();
  const clients = new Set();

  router.get('/notifications', async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
    res.json({ notifications: await recentNotifications({ limit }), clients: clients.size });
  });

  router.get('/stream', async (req, res) => {
    if (clients.size >= maxClients) {
      return res.status(503).json({ error: 'Terlalu banyak koneksi notifikasi saat ini. Coba lagi nanti.' });
    }
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    clients.add(res);

    const send = (n) => res.write(`id: ${n.id}\nevent: notification\ndata: ${JSON.stringify(n)}\n\n`);
    // Jeda sambung ulang 10 detik; dikirim duluan supaya berlaku sejak awal.
    res.write('retry: 10000\n\n');
    bus.on('notification', send);
    const ping = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    req.on('close', () => {
      clearInterval(ping);
      bus.off('notification', send);
      clients.delete(res);
    });

    // Yang terlewat selama putus. Bisa beririsan dengan notifikasi langsung di atas;
    // browser membuang id yang sudah diterima.
    const lastId = Number.parseInt(req.get('Last-Event-ID') ?? '', 10);
    if (Number.isSafeInteger(lastId) && lastId > 0) {
      try {
        for (const n of await recentNotifications({ afterId: lastId, limit: 50 })) send(n);
      } catch (err) {
        console.error('Notifikasi terlewat gagal dimuat', err);
      }
    }
  });

  return router;
}
