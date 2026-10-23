import L from 'leaflet';
import { postJson } from '../lib/api.js';
import { flyToBounds } from '../lib/motion.js';
import { ROUTE_HAZARD_COLOR } from '../lib/symbology.js';
import { cssVar } from '../lib/theme.js';

// Rute aman (M4): server memilih rute dengan ruas paling pendek di zona bahaya
// banjir/longsor kelas tinggi InaRISK. Peta menggambar rute yang disarankan
// (warna pilihan antarmuka), rute tercepat bila berbeda (abu-abu putus-putus),
// dan ruas yang melewati zona bahaya tinggi (merah).

const toLatLngs = (geometry) => {
  if (!geometry) return [];
  const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
  return lines.map((line) => line.map(([lon, lat]) => [lat, lon]));
};

// Jarak titik ke ruas garis dan posisi proyeksinya, dalam meter (bidang datar
// lokal; cukup teliti untuk rute beberapa kilometer).
function projectOnRoute(route, latlng) {
  const rad = Math.PI / 180;
  const kx = 111_320 * Math.cos(latlng.lat * rad);
  const ky = 110_574;
  let best = { distance: Infinity, along: 0 };
  let walked = 0;
  for (let i = 1; i < route.length; i++) {
    const [ay, ax] = route[i - 1];
    const [by, bx] = route[i];
    const dx = (bx - ax) * kx;
    const dy = (by - ay) * ky;
    const px = (latlng.lng - ax) * kx;
    const py = (latlng.lat - ay) * ky;
    const length = Math.hypot(dx, dy);
    const t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length ** 2)) : 0;
    const distance = Math.hypot(px - t * dx, py - t * dy);
    if (distance < best.distance) best = { distance, along: walked + t * length };
    walked += length;
  }
  return { ...best, total: walked };
}

export function createSafeRoute({ map, viewPadding = () => ({}) }) {
  const layer = L.featureGroup().addTo(map);
  let current = null;
  let controller = null;

  function draw(data) {
    layer.clearLayers();
    const safest = data.routes[data.safest];
    const fastest = data.routes[data.fastest];
    const container = map.getContainer();
    const pane = 'analysis';
    if (fastest !== safest) {
      L.polyline(toLatLngs(fastest.geometry)[0], { pane, color: cssVar('--ink-3', container) || '#888', weight: 4, opacity: 0.9, dashArray: '2 9', lineCap: 'round', interactive: false }).addTo(layer);
    }
    const line = toLatLngs(safest.geometry)[0];
    // Garis tepi putih supaya rute terbaca di atas peta dasar dan lapisan lain.
    L.polyline(line, { pane, color: '#fff', weight: 9, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(line, { pane, color: cssVar('--primary-fill', container) || '#2a64dc', weight: 5, opacity: 1, interactive: false }).addTo(layer);
    for (const hazard of ['banjir', 'longsor']) {
      for (const part of toLatLngs(safest.exposure.tinggi_geometry[hazard])) {
        L.polyline(part, { pane, color: ROUTE_HAZARD_COLOR, weight: 5, opacity: 1, interactive: false }).addTo(layer);
      }
    }
    flyToBounds(map, layer.getBounds(), { maxZoom: 16, ...viewPadding({ detail: true }) });
  }

  return {
    // to = { lat, lon }; hasil server dikembalikan untuk ditampilkan di panel.
    async request({ from, to, mode }) {
      // Rute lama dihapus dulu: bila permintaan ini gagal, peta tidak menampilkan
      // rute yang tidak lagi sesuai dengan kartu.
      controller?.abort();
      controller = new AbortController();
      current = null;
      layer.clearLayers();
      const data = await postJson('/api/route', { from, to, mode }, { signal: controller.signal });
      current = { data, line: toLatLngs(data.routes[data.safest].geometry)[0], to };
      draw(data);
      return data;
    },
    // Kemajuan di rute untuk pantau posisi: sisa jarak, jarak dari rute, dan apakah
    // posisi sedang berada di ruas zona bahaya tinggi.
    progress(latlng) {
      if (!current) return null;
      const { distance, along, total } = projectOnRoute(current.line, latlng);
      const exposure = current.data.routes[current.data.safest].exposure.tinggi_geometry;
      const inHazard = ['banjir', 'longsor'].some((hazard) =>
        toLatLngs(exposure[hazard]).some((part) => part.length > 1 && projectOnRoute(part, latlng).distance < 40),
      );
      return { offRouteM: distance, remainingM: Math.max(0, total - along), inHazard };
    },
    get active() {
      return current !== null;
    },
    get destination() {
      return current?.to ?? null;
    },
    clear() {
      controller?.abort();
      current = null;
      layer.clearLayers();
    },
  };
}
