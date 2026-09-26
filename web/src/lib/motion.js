// Animasi berbasis JavaScript. Semuanya langsung ke keadaan akhir bila pengguna
// mengaktifkan "kurangi gerakan" di sistem operasinya.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export const prefersReducedMotion = () => reducedMotion.matches;
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

// Jalankan fn(t) dengan t dari 0 ke 1 selama `duration` ms. Kembalikan fungsi
// untuk menghentikannya.
export function tween(duration, fn, { onDone } = {}) {
  if (prefersReducedMotion()) {
    fn(1);
    onDone?.();
    return () => {};
  }
  const start = performance.now();
  let frame = requestAnimationFrame(function step(now) {
    const t = Math.min(1, (now - start) / duration);
    fn(easeOutCubic(t));
    if (t < 1) frame = requestAnimationFrame(step);
    else onDone?.();
  });
  return () => cancelAnimationFrame(frame);
}

// Angka menghitung naik/turun dari nilai sebelumnya ke nilai baru.
const runningCounters = new WeakMap();
export function animateNumber(element, to, { duration = 900 } = {}) {
  const from = Number.parseFloat(element.dataset.value ?? '0') || 0;
  element.dataset.value = String(to);
  runningCounters.get(element)?.();
  if (from === to) {
    element.textContent = String(to);
    return;
  }
  runningCounters.set(
    element,
    tween(duration, (t) => {
      element.textContent = String(Math.round(from + (to - from) * t));
    }),
  );
}

// Peta "terbang" halus ke tujuan; langsung pindah bila gerakan dikurangi.
export function flyToBounds(map, bounds, options = {}) {
  if (prefersReducedMotion()) map.fitBounds(bounds, options);
  else map.flyToBounds(bounds, { duration: 1.1, ...options });
}

export function flyTo(map, latlng, zoom) {
  if (prefersReducedMotion()) map.setView(latlng, zoom);
  else map.flyTo(latlng, zoom, { duration: 0.9 });
}
