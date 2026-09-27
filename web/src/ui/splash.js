import { prefersReducedMotion } from '../lib/motion.js';

// Layar pembuka tampil minimal sebentar supaya animasi logonya selesai, lalu
// memudar setelah data pertama dimuat (atau paling lama MAX_WAIT_MS).
// Intro logo Kontur selesai ±1,4 detik setelah halaman dibuka dan sinyal
// pertamanya memancar pada 1,1 detik (lihat motion.css).
const MIN_VISIBLE_MS = 1_800;
const MAX_WAIT_MS = 4_500;
const FADE_MS = 700;

export function hideSplashWhen(splash, ready) {
  if (!splash) return;
  const timeout = new Promise((resolve) => setTimeout(resolve, MAX_WAIT_MS));
  Promise.race([ready, timeout]).then(() => {
    const reduced = prefersReducedMotion();
    // performance.now() = waktu sejak halaman mulai dimuat, saat splash pertama tampil.
    const wait = reduced ? 0 : Math.max(0, MIN_VISIBLE_MS - performance.now());
    setTimeout(() => {
      splash.classList.add('is-done');
      setTimeout(() => splash.remove(), reduced ? 0 : FADE_MS);
    }, wait);
  });
}
