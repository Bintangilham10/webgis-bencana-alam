import L from 'leaflet';
import { escapeHtml, formatDistance, formatNumber } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { flyToPoint } from '../lib/motion.js';
import { inRegion } from '../lib/region.js';

// Pantau posisi (pelacakan kontinu dengan navigator.geolocation.watchPosition).
// Posisi hanya dipakai di browser: digambar di peta, untuk kemajuan rute aman, dan
// untuk "sekitar lokasi saya" pada notifikasi. Tidak dikirim ke server kecuali
// pengguna meminta cek risiko atau rute.

// Di luar rute lebih dari ini dianggap menyimpang (akurasi GPS di kota ±10–30 m).
const OFF_ROUTE_M = 60;
const FOLLOW_ZOOM = 16;

const MESSAGES = {
  unsupported: 'Browser ini tidak mendukung penentuan lokasi.',
  insecure: 'Pantau posisi butuh koneksi aman (HTTPS).',
  denied: 'Izin lokasi ditolak. Izinkan akses lokasi di browser untuk memantau posisi.',
  unavailable: 'Posisi belum dapat ditentukan. Coba di tempat terbuka.',
  timeout: 'Posisi terlalu lama ditentukan. Masih dicoba…',
};

export function createTracking({ map, chip, onPosition, onStop, progress, viewPadding = () => ({}) }) {
  const layer = L.featureGroup();
  let watchId = null;
  let marker = null;
  let circle = null;
  let follow = true;
  let last = null;

  function render({ status, detail = '', tone = 'info' }) {
    chip.hidden = false;
    chip.dataset.tone = tone;
    chip.innerHTML = `
      <span class="track-chip__icon">${icons.navigate}</span>
      <span class="track-chip__text"><strong>${escapeHtml(status)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</span>
      ${follow || !last ? '' : '<button type="button" class="btn btn-secondary" data-action="follow">Ikuti</button>'}
      <button type="button" class="icon-btn" data-action="stop" aria-label="Berhenti memantau posisi">${icons.close}</button>`;
  }

  function update(position) {
    const { latitude, longitude, accuracy, heading } = position.coords;
    const latlng = L.latLng(latitude, longitude);
    const first = !last;
    last = { latlng, accuracy };
    if (!marker) {
      circle = L.circle(latlng, { pane: 'analysis', radius: accuracy, className: 'accuracy-circle', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(layer);
      marker = L.marker(latlng, {
        pane: 'analysis',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'track-marker', html: '<span class="track-marker__heading"></span><span class="track-marker__dot"></span>', iconSize: [22, 22] }),
      }).addTo(layer);
    } else {
      marker.setLatLng(latlng);
      circle.setLatLng(latlng).setRadius(accuracy);
    }
    // Arah gerak (hanya ada saat bergerak dan perangkat mendukung).
    const element = marker.getElement();
    element?.classList.toggle('has-heading', Number.isFinite(heading));
    if (Number.isFinite(heading)) element?.style.setProperty('--heading', `${heading}deg`);

    // Peta hanya digeser bila posisi keluar dari bagian peta yang tidak tertutup panel.
    if (first) flyToPoint(map, latlng, Math.max(map.getZoom(), FOLLOW_ZOOM), viewPadding());
    else if (follow) map.panInside(latlng, viewPadding());

    if (!inRegion(latlng)) {
      render({ status: 'Posisi di luar wilayah Indonesia', detail: 'SIGAP hanya menilai risiko dan rute di Indonesia.', tone: 'warn' });
    } else {
      const route = progress(latlng);
      const accuracyText = `akurasi ±${formatNumber(Math.round(accuracy))} m`;
      if (!route) render({ status: 'Posisi dipantau', detail: accuracyText });
      else if (route.offRouteM > OFF_ROUTE_M + accuracy / 2) {
        render({ status: `Di luar rute aman (${formatDistance(route.offRouteM)})`, detail: 'Kembali ke garis biru, atau minta rute baru dari posisi ini.', tone: 'warn' });
      } else if (route.inHazard) {
        render({ status: `Sisa ${formatDistance(route.remainingM)} · zona bahaya tinggi`, detail: 'Ruas merah: lewati dengan hati-hati, jangan berhenti.', tone: 'danger' });
      } else {
        render({ status: `Sisa ${formatDistance(route.remainingM)} ke tujuan`, detail: accuracyText, tone: 'ok' });
      }
    }
    onPosition({ latlng, accuracy, first });
  }

  function fail(error) {
    if (error.code === error.PERMISSION_DENIED) {
      render({ status: 'Pantau posisi berhenti', detail: MESSAGES.denied, tone: 'warn' });
      stop({ keepChip: true });
      return;
    }
    render({ status: last ? 'Sinyal lokasi hilang' : 'Mencari posisi…', detail: error.code === error.TIMEOUT ? MESSAGES.timeout : MESSAGES.unavailable, tone: 'warn' });
  }

  function start() {
    if (!('geolocation' in navigator)) return render({ status: 'Pantau posisi tidak tersedia', detail: MESSAGES.unsupported, tone: 'warn' });
    if (!window.isSecureContext) return render({ status: 'Pantau posisi tidak tersedia', detail: MESSAGES.insecure, tone: 'warn' });
    follow = true;
    layer.addTo(map);
    render({ status: 'Mencari posisi…', detail: 'Izinkan akses lokasi bila browser bertanya.' });
    watchId = navigator.geolocation.watchPosition(update, fail, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 });
  }

  function stop({ keepChip = false } = {}) {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    last = null;
    marker = null;
    circle = null;
    layer.clearLayers();
    map.removeLayer(layer);
    if (!keepChip) chip.hidden = true;
    onStop();
  }

  // Menggeser peta sendiri menghentikan "ikuti posisi" sampai tombol Ikuti ditekan.
  map.on('dragstart', () => {
    if (watchId !== null && follow) {
      follow = false;
      if (last) update({ coords: { latitude: last.latlng.lat, longitude: last.latlng.lng, accuracy: last.accuracy, heading: null } });
    }
  });
  chip.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'stop') {
      if (watchId === null) chip.hidden = true;
      else stop();
    } else if (action === 'follow' && last) {
      follow = true;
      flyToPoint(map, last.latlng, Math.max(map.getZoom(), FOLLOW_ZOOM), viewPadding());
      render({ status: 'Posisi dipantau', detail: `akurasi ±${formatNumber(Math.round(last.accuracy))} m` });
    }
  });

  return {
    get active() {
      return watchId !== null;
    },
    get position() {
      return last?.latlng ?? null;
    },
    toggle() {
      if (watchId === null) start();
      else stop();
      return watchId !== null;
    },
    start,
    stop,
    // Perbarui teks kemajuan setelah rute berubah.
    refresh() {
      if (last) update({ coords: { latitude: last.latlng.lat, longitude: last.latlng.lng, accuracy: last.accuracy, heading: null } });
    },
  };
}
