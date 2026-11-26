import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { startScheduler } from './jobs/scheduler.js';
import { notificationBus } from './notifications.js';
import { createPushDispatcher } from './push.js';

const server = createApp().listen(config.port, () => {
  console.log(`SIGAP API berjalan di http://localhost:${config.port}/api`);
});
const stopScheduler = config.schedulerEnabled ? startScheduler() : () => {};

// Web Push: tiap notifikasi baru juga dikirim ke perangkat yang berlangganan,
// supaya sampai walau tab SIGAP ditutup. Hanya aktif bila kunci VAPID diisi.
if (config.vapid) {
  const push = createPushDispatcher({ vapid: config.vapid });
  notificationBus.on('notification', (n) => {
    push.dispatch(n).catch((err) => console.error('Pengiriman push gagal', err));
  });
  console.log('Notifikasi push aktif.');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopScheduler();
    server.close(() => pool.end().finally(() => process.exit(0)));
  });
}
