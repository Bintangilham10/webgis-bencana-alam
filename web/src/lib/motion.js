import L from 'leaflet';

// Animasi berbasis JavaScript. Semuanya langsung ke keadaan akhir bila pengguna
// mengaktifkan "kurangi gerakan" di sistem operasinya.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Posisi tegak penanda setelah terbang: 62% tinggi area peta yang terlihat,
// sedikit di bawah tengah supaya popup di atasnya muat.
const FOCUS_ANCHOR_Y = 0.62;

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

// Terbang ke satu titik dan menaruhnya di area peta yang tidak tertutup panel
// melayang (padding sama seperti fitBounds). Lama terbang menyesuaikan jarak
// dan selisih zoom: dekat terasa sigap, jauh tetap halus.
export function flyToPoint(map, latlng, zoom, { paddingTopLeft = [0, 0], paddingBottomRight = [0, 0] } = {}) {
  const size = map.getSize();
  const topLeft = L.point(paddingTopLeft);
  const bottomRight = size.subtract(paddingBottomRight);
  const anchor = L.point((topLeft.x + bottomRight.x) / 2, topLeft.y + (bottomRight.y - topLeft.y) * FOCUS_ANCHOR_Y);
  const center = map.unproject(map.project(latlng, zoom).subtract(anchor.subtract(size.divideBy(2))), zoom);
  if (prefersReducedMotion()) {
    map.setView(center, zoom, { animate: false });
    return;
  }
  const travel = map.latLngToContainerPoint(latlng).distanceTo(anchor);
  const duration = Math.min(2, 0.7 + travel / 1400 + Math.abs(zoom - map.getZoom()) * 0.1);
  map.flyTo(center, zoom, { duration, easeLinearity: 0.2 });
}
