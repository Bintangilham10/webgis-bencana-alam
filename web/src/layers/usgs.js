import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, formatDecimal, timeAgo, usgsPlace } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { makeFocusable } from '../lib/marker-focus.js';
import { DEPTH_CLASSES, depthClass, magnitudeRadius, pillStyle } from '../lib/symbology.js';

// Gempa dari katalog USGS (Amerika Serikat) sebagai pembanding gempa BMKG. Feed
// publik BMKG hanya memuat M ≥ 5 dan gempa dirasakan, sedangkan USGS juga mencatat
// gempa ±M4–5 yang tidak dirasakan; sebaliknya gempa kecil yang dirasakan hanya
// ada di BMKG. Gempa yang sama di kedua katalog dicocokkan oleh server.

const FOCUS_ZOOM = 10;
const REFRESH_MS = 60_000;
// Cincin sedikit lebih besar dari cakram BMKG bermagnitudo sama, supaya tetap
// terlihat mengelilingi cakram itu bila gempanya tercatat di kedua katalog.
const RING_MARGIN = 8;
// Selalu di bawah cakram BMKG: klik di tengah cincin tetap membuka gempa BMKG.
const BELOW_BMKG = -30_000;

const ringDiameter = (magnitude) => Math.round(2 * magnitudeRadius(magnitude)) + RING_MARGIN;

function usgsIcon(p, index) {
  const d = ringDiameter(p.magnitude);
  return L.divIcon({
    className: 'usgs-icon',
    html: `<span class="usgs-symbol" style="--c:${depthClass(p.depth_class).color};--i:${index}" role="img" aria-label="Gempa USGS M ${formatDecimal(p.magnitude)}"></span>`,
    iconSize: [d, d],
    tooltipAnchor: [0, -d / 2],
    popupAnchor: [0, -d / 2],
  });
}

function bmkgComparison(match) {
  if (!match) {
    return 'Tidak ada di feed publik BMKG <span class="muted">(feed itu hanya memuat M ≥ 5 dan gempa dirasakan)</span>';
  }
  const seconds = formatDecimal(Math.abs(match.time_diff_s), 0);
  return `M ${formatDecimal(match.magnitude)} <span class="muted">· selisih ${seconds} detik, ${formatDecimal(match.distance_km, 0)} km</span>`;
}

export function usgsPopup(p) {
  const depth = depthClass(p.depth_class);
  const magnitude = formatDecimal(p.magnitude);
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="mag-badge mag-badge--lg" style="${pillStyle(depth)}">${magnitude}</span>
        <div class="popup-heading">
          <h3>Gempa M ${magnitude}${p.mag_type ? ` <span class="muted">${escapeHtml(p.mag_type)}</span>` : ''}</h3>
          <p class="popup-sub">${timeAgo(p.occurred_at)} · katalog USGS</p>
        </div>
      </div>
      <p class="popup-place">${escapeHtml(usgsPlace(p.wilayah))}</p>
      <dl class="popup-facts">
        <dt>Waktu</dt><dd>${formatDateTime(p.occurred_at)}</dd>
        <dt>Kedalaman</dt><dd>${formatDecimal(p.depth_km)} km (${escapeHtml(p.depth_class)})</dd>
        <dt>BMKG</dt><dd>${bmkgComparison(p.bmkg)}</dd>
        <dt>Status</dt><dd>${p.status === 'reviewed' ? 'Sudah ditinjau seismolog USGS' : 'Otomatis, masih bisa berubah'}</dd>
      </dl>
      ${p.url ? `<a class="popup-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Halaman gempa di USGS${icons.external}</a>` : ''}
      <p class="popup-source">Sumber: USGS (Amerika Serikat) · pembanding, bukan peringatan resmi</p>
    </div>`;
}

// Data dimuat saat lapisan dinyalakan dan diperbarui tiap menit selama menyala.
export function createUsgsLayer(map, { viewPadding, onLoad, onError } = {}) {
  const group = L.featureGroup();
  const markers = new Map();
  const openers = new Map();
  let signature = '';
  let timer = null;

  function render(collection) {
    // Popup yang sedang dibaca dibuka lagi setelah data diperbarui.
    const openId = [...markers].find(([, marker]) => marker.isPopupOpen())?.[0];
    markers.clear();
    openers.clear();
    group.clearLayers();
    // Gempa besar lebih dulu dan di bawah, supaya cincin kecil di atasnya tetap bisa diklik.
    const byMagnitude = [...collection.features].sort((a, b) => b.properties.magnitude - a.properties.magnitude);
    byMagnitude.forEach(({ geometry, properties: p }, index) => {
      const [lon, lat] = geometry.coordinates;
      const marker = L.marker([lat, lon], {
        pane: 'quakes',
        icon: usgsIcon(p, index),
        zIndexOffset: Math.round((10 - p.magnitude) * 1000) + BELOW_BMKG,
      }).bindTooltip(`USGS M ${formatDecimal(p.magnitude)} · ${timeAgo(p.occurred_at)}`, { direction: 'top' });
      openers.set(p.id, makeFocusable(map, marker, { zoom: FOCUS_ZOOM, popup: () => usgsPopup(p), viewPadding }));
      markers.set(p.id, marker);
      group.addLayer(marker);
    });
    openers.get(openId)?.({ fly: false });
  }

  async function load() {
    try {
      const collection = await getJson('/api/earthquakes?days=7&source=usgs');
      const next = JSON.stringify(
        collection.features.map(({ properties: p }) => [p.id, p.magnitude, p.depth_km, p.status, p.bmkg?.id]),
      );
      if (next !== signature) {
        signature = next;
        render(collection);
      }
      onLoad?.(collection);
    } catch (err) {
      onError?.(err);
    }
  }

  group.on('add', () => {
    load();
    timer ??= setInterval(load, REFRESH_MS);
  });
  group.on('remove', () => {
    clearInterval(timer);
    timer = null;
  });
  return { layer: group };
}

export function usgsLegend() {
  const sizes = [4, 5, 6, 7]
    .map((m) => {
      const d = ringDiameter(m);
      return `<span class="legend-size"><span class="usgs-swatch" style="width:${d}px;height:${d}px"></span>M${m}</span>`;
    })
    .join('');
  const depths = DEPTH_CLASSES.map(
    (c) => `<div class="legend-row"><span class="usgs-swatch" style="--c:${c.color}"></span>${c.label}</div>`,
  ).join('');
  return `<div class="legend-sizes">${sizes}</div>${depths}
    <p class="legend-note">Cincin kosong: katalog USGS (Amerika Serikat), pembanding gempa BMKG. Gempa yang tercatat di keduanya tampak sebagai cincin di sekeliling cakram BMKG; magnitudonya bisa berbeda ±0,2.</p>`;
}
