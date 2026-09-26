import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { startScheduler } from './jobs/scheduler.js';

const server = createApp().listen(config.port, () => {
  console.log(`SIGAP API berjalan di http://localhost:${config.port}/api`);
});
const stopScheduler = config.schedulerEnabled ? startScheduler() : () => {};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopScheduler();
    server.close(() => pool.end().finally(() => process.exit(0)));
  });
}
