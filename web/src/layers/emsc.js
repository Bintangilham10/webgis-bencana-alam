import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, formatDecimal, timeAgo, titleCase } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { makeFocusable } from '../lib/marker-focus.js';
import { DEPTH_CLASSES, depthClass, pillStyle } from '../lib/symbology.js';
import { cssVar } from '../lib/theme.js';
import { bmkgMissingReason } from './usgs.js';

// Gempa dari katalog EMSC (Eropa). Di Indonesia sebagian besar berasal dari
// katalog lengkap BMKG, termasuk gempa kecil mulai ±M1 yang tidak dimuat feed
// publik BMKG (hanya M ≥ 5 dan gempa dirasakan). Ratusan gempa per minggu, jadi
// digambar sebagai titik kecil SVG, bukan penanda DOM.

const FOCUS_ZOOM = 10;
const REFRESH_MS = 2 * 60_000;

// Lembaga penentu lokasi dan magnitudo (field auth EMSC).
const AUTHORITIES = {
  BMKG: 'BMKG (katalog lengkap, via EMSC)',
  EMSC: 'EMSC',
  NEIC: 'USGS (NEIC)',
  MMD: 'MetMalaysia (MMD)',
  PIVS: 'PHIVOLCS Filipina',
  GFZ: 'GFZ Jerman',
};

export const emscRadius = (magnitude) => Math.max(2.5, 1.4 * magnitude);

export function emscPopup(p) {
  const depth = depthClass(p.depth_class);
  const magnitude = formatDecimal(p.magnitude);
  const bmkg = p.bmkg ? `Ada, M ${formatDecimal(p.bmkg.magnitude)}` : `Tidak ada ${bmkgMissingReason(p.magnitude)}`;
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="mag-badge mag-badge--lg" style="${pillStyle(depth)}">${magnitude}</span>
        <div class="popup-heading">
          <h3>Gempa M ${magnitude}${p.mag_type ? ` <span class="muted">${escapeHtml(p.mag_type)}</span>` : ''}</h3>
          <p class="popup-sub">${timeAgo(p.occurred_at)} · katalog EMSC</p>
        </div>
      </div>
      <p class="popup-place">${escapeHtml(titleCase(p.wilayah))}</p>
      <dl class="popup-facts">
        <dt>Waktu</dt><dd>${formatDateTime(p.occurred_at)}</dd>
        <dt>Kedalaman</dt><dd>${formatDecimal(p.depth_km)} km (${escapeHtml(p.depth_class)})</dd>
        <dt>Penentu</dt><dd>${escapeHtml(AUTHORITIES[p.auth] ?? p.auth ?? 'Tidak diketahui')}</dd>
        <dt>Feed BMKG</dt><dd>${bmkg}</dd>
      </dl>
      ${p.url ? `<a class="popup-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Halaman gempa di EMSC${icons.external}</a>` : ''}
      <p class="popup-source">Sumber: EMSC (Eropa) · pembanding, bukan peringatan resmi</p>
    </div>`;
}

// Data dimuat saat lapisan dinyalakan dan diperbarui tiap 2 menit selama menyala.
export function createEmscLayer(map, { viewPadding, onLoad, onError } = {}) {
  const renderer = L.svg({ pane: 'smallQuakes' });
  const group = L.featureGroup();
  let signature = '';
  let timer = null;

  function render(collection) {
    group.clearLayers();
    const outline = cssVar('--glyph-outline', map.getContainer()) || '#111c2a';
    // Gempa besar digambar lebih dulu supaya titik kecil di atasnya tetap bisa diklik.
    const byMagnitude = [...collection.features].sort((a, b) => b.properties.magnitude - a.properties.magnitude);
    for (const { geometry, properties: p } of byMagnitude) {
      const [lon, lat] = geometry.coordinates;
      const dot = L.circleMarker([lat, lon], {
        renderer,
        radius: emscRadius(p.magnitude),
        color: outline,
        weight: 1,
        opacity: 0.9,
        fillColor: depthClass(p.depth_class).color,
        fillOpacity: 0.8,
      }).bindTooltip(`EMSC M ${formatDecimal(p.magnitude)} · ${timeAgo(p.occurred_at)}`, { direction: 'top' });
      makeFocusable(map, dot, { zoom: FOCUS_ZOOM, popup: () => emscPopup(p), viewPadding });
      group.addLayer(dot);
    }
  }

  async function load() {
    try {
      const collection = await getJson('/api/earthquakes?days=7&source=emsc');
      const next = JSON.stringify(collection.features.map(({ properties: p }) => [p.id, p.magnitude, p.depth_km, p.bmkg?.id]));
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

export function emscLegend() {
  const sizes = [2, 3, 4, 5]
    .map((m) => {
      const d = Math.round(2 * emscRadius(m));
      return `<span class="legend-size"><span class="emsc-swatch" style="width:${d}px;height:${d}px"></span>M${m}</span>`;
    })
    .join('');
  const depths = DEPTH_CLASSES.map(
    (c) => `<div class="legend-row"><span class="emsc-swatch" style="--c:${c.color}"></span>${c.label}</div>`,
  ).join('');
  return `<div class="legend-sizes">${sizes}</div>${depths}
    <p class="legend-note">Titik kecil: katalog EMSC (Eropa). Sebagian besar dari katalog lengkap BMKG, termasuk gempa kecil yang tidak dimuat feed publik BMKG. Tidak ikut dihitung di Ikhtisar dan cek risiko.</p>`;
}
