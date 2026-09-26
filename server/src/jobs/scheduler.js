import { recordSync } from '../sync-logs.js';
import { syncEarthquakes } from './sync-earthquakes.js';
import { syncVolcanoes } from './sync-volcanoes.js';

// BMKG membatasi 60 request/menit per IP; tiga feed tiap 60 detik jauh di bawahnya.
export const JOBS = [
  { source: 'bmkg-gempa', intervalMs: 60_000, run: syncEarthquakes },
  { source: 'magma', intervalMs: 30 * 60_000, run: syncVolcanoes },
];

// Setiap run dicatat di sync_logs, termasuk yang gagal: data ini dipakai
// halaman kesehatan sumber dan pengukuran ketersediaan (RQ2).
export async function runJob(job) {
  const startedAt = new Date();
  const started = performance.now();
  let result = { items: null, message: null };
  let ok = true;
  try {
    result = await job.run();
  } catch (err) {
    ok = false;
    result.message = err.message;
  }
  await recordSync({
    source: job.source,
    ok,
    items: result.items,
    message: result.message,
    startedAt,
    durationMs: Math.round(performance.now() - started),
  });
  return { ok, ...result };
}

export function startScheduler({ jobs = JOBS, log = console } = {}) {
  const timers = jobs.map((job) => {
    let running = false;
    const tick = async () => {
      // Lewati tick bila run sebelumnya belum selesai (mis. sumber sedang lambat).
      if (running) return;
      running = true;
      try {
        // Run yang sukses cukup tercatat di sync_logs; konsol hanya untuk masalah.
        const { ok, message } = await runJob(job);
        if (!ok || message) log.warn(`[${job.source}] ${ok ? 'sebagian gagal' : 'gagal'}: ${message}`);
      } catch (err) {
        log.error(`[${job.source}] tidak bisa mencatat sync_logs: ${err.message}`);
      } finally {
        running = false;
      }
    };
    tick();
    return setInterval(tick, job.intervalMs);
  });
  return () => timers.forEach(clearInterval);
}
