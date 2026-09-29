import { lastSuccessfulSync, recordSync } from '../sync-logs.js';
import { runIndikasi } from './indikasi.js';
import { syncEarthquakes } from './sync-earthquakes.js';
import { syncVolcanoes } from './sync-volcanoes.js';

// BMKG membatasi 60 request/menit per IP; tiga feed tiap 60 detik jauh di bawahnya.
// Indikasi SIGAP memakai ±3.200 panggilan kuota Open-Meteo per run (satu per titik
// pantau), jadi dijalankan tiap 12 jam (±6.400/hari dari kuota gratis 10.000) dan
// memakai skipIfFresh: penjadwal memeriksa tiap checkMs dan hanya menjalankannya
// bila run sukses terakhir di sync_logs lebih tua dari intervalMs. Server yang
// dimulai ulang tidak langsung memicu run baru, dan run yang gagal dicoba lagi di
// pemeriksaan berikutnya.
export const JOBS = [
  { source: 'bmkg-gempa', intervalMs: 60_000, run: syncEarthquakes },
  { source: 'magma', intervalMs: 30 * 60_000, run: syncVolcanoes },
  { source: 'indikasi-sigap', intervalMs: 12 * 60 * 60_000, checkMs: 15 * 60_000, skipIfFresh: true, run: runIndikasi },
];

export async function isFresh(job) {
  if (!job.skipIfFresh) return false;
  const last = await lastSuccessfulSync(job.source);
  return last !== null && Date.now() - new Date(last).getTime() < job.intervalMs;
}

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
        if (await isFresh(job)) return;
        // Run yang sukses cukup tercatat di sync_logs; konsol hanya untuk masalah.
        const { ok, message } = await runJob(job);
        if (!ok || message) log.warn(`[${job.source}] ${ok ? 'sebagian gagal' : 'gagal'}: ${message}`);
      } catch (err) {
        log.error(`[${job.source}] sync_logs tidak dapat diakses: ${err.message}`);
      } finally {
        running = false;
      }
    };
    tick();
    return setInterval(tick, job.checkMs ?? job.intervalMs);
  });
  return () => timers.forEach(clearInterval);
}
