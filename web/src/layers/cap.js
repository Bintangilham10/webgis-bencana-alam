import L from 'leaflet';
import { escapeHtml, timeAgo } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { flyToBounds } from '../lib/motion.js';
import { capSeverity, CAP_SEVERITY, pillStyle } from '../lib/symbology.js';

// Peringatan dini cuaca BMKG (CAP nowcast): poligon kecamatan yang sedang
// diperingatkan, berlaku ±2 jam. Diarsir supaya tidak tertukar dengan isian
// indikasi SIGAP per kab/kota yang warnanya sama.

const ZONES = { 420: 'WIB', 480: 'WITA', 540: 'WIT' };

// Jam pada zona waktu peringatannya sendiri (selisih menit dari UTC).
export function capClock(iso, offsetMinutes = 420) {
  const date = new Date(new Date(iso).getTime() + offsetMinutes * 60_000);
  return `${String(date.getUTCHours()).padStart(2, '0')}.${String(date.getUTCMinutes()).padStart(2, '0')}`;
}
export const capZone = (offsetMinutes = 420) => ZONES[offsetMinutes] ?? 'WIB';
export const capUntil = (p) => `s.d. ${capClock(p.expires, p.utc_offset ?? 420)} ${capZone(p.utc_offset ?? 420)}`;

// Pola arsiran per warna, dibuat sekali di dalam SVG lapisan ini.
const hatchId = (color) => `cap-hatch-${color.replace(/[^a-z0-9]/gi, '')}`;

function addHatchPatterns(svg) {
  if (!svg || svg.querySelector('defs[data-cap]')) return;
  const defs = L.SVG.create('defs');
  defs.dataset.cap = '';
  for (const color of new Set(Object.values(CAP_SEVERITY).map((s) => s.color))) {
    const pattern = L.SVG.create('pattern');
    for (const [key, value] of Object.entries({ id: hatchId(color), width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' })) {
      pattern.setAttribute(key, value);
    }
    pattern.innerHTML = `<rect width="7" height="7" fill="${color}" fill-opacity="0.16"/><line x1="0" y1="0" x2="0" y2="7" stroke="${color}" stroke-width="2.6" stroke-opacity="0.8"/>`;
    defs.append(pattern);
  }
  svg.prepend(defs);
}

export function capPopup(p) {
  const style = capSeverity(p.severity);
  const offset = p.utc_offset ?? 420;
  const from = p.effective ?? p.sent;
  const regions = p.wilayah.map((w) => w.nama).join(', ');
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="row-icon"><span class="cap-swatch" style="--c:${style.color}"></span></span>
        <div class="popup-heading">
          <h3>${escapeHtml(p.event)}</h3>
          <p class="popup-sub">Peringatan dini cuaca BMKG · ${escapeHtml(p.area_desc ?? '')}</p>
        </div>
      </div>
      <dl class="popup-facts">
        <dt>Berlaku</dt><dd>${capClock(from, offset)}–${capClock(p.expires, offset)} ${capZone(offset)}</dd>
        <dt>Tingkat</dt><dd><span class="level-pill" style="${pillStyle(style)}">${style.label}</span></dd>
        ${regions ? `<dt>Kab/kota</dt><dd>${escapeHtml(regions)}</dd>` : ''}
      </dl>
      ${p.description ? `<details class="popup-details"><summary>Isi peringatan BMKG</summary><p>${escapeHtml(p.description)}</p></details>` : ''}
      ${p.web ? `<a class="popup-link" href="${escapeHtml(p.web)}" target="_blank" rel="noopener">Infografis BMKG${icons.external}</a>` : ''}
      <p class="popup-source">Sumber: BMKG (CAP) · diterbitkan ${timeAgo(p.sent)}</p>
    </div>`;
}

// Data diisi dari luar (main.js memuat /api/cap untuk daftar Ikhtisar juga).
export function createCapLayer(map, { viewPadding = () => ({}) } = {}) {
  const renderer = L.svg({ pane: 'warnings' });
  const layer = L.geoJSON(null, {
    renderer,
    style(feature) {
      const { color } = capSeverity(feature.properties.severity);
      return { color, weight: 1.5, opacity: 0.95, fillColor: `url(#${hatchId(color)})`, fillOpacity: 1 };
    },
    onEachFeature(feature, path) {
      path.bindPopup(() => capPopup(feature.properties), { maxWidth: 320 });
      path.on('mouseover', () => path.setStyle({ weight: 2.5 }));
      path.on('mouseout', () => path.setStyle({ weight: 1.5 }));
    },
  });
  // <svg> renderer baru dibuat saat poligon pertama masuk peta: bisa saat lapisan
  // dinyalakan (data sudah ada) atau saat data pertama tiba (lapisan sudah menyala).
  const ensurePatterns = () => addHatchPatterns(renderer._container);
  layer.on('add', ensurePatterns);

  return {
    layer,
    setData(collection) {
      layer.clearLayers().addData(collection);
      if (map.hasLayer(layer)) ensurePatterns();
    },
    // Dari daftar Ikhtisar atau notifikasi: lapisan dinyalakan, peta menuju poligonnya.
    focus(identifier) {
      if (!map.hasLayer(layer)) map.addLayer(layer);
      const path = layer.getLayers().find((l) => l.feature.properties.identifier === identifier);
      if (!path) return false;
      map.once('moveend', () => path.openPopup());
      flyToBounds(map, path.getBounds(), { maxZoom: 10, ...viewPadding() });
      return true;
    },
  };
}

export const capLegend = () => `
  ${['Moderate', 'Severe', 'Extreme']
    .map((severity) => {
      const style = capSeverity(severity);
      return `<div class="legend-row"><span class="cap-swatch" style="--c:${style.color}"></span>${style.label}</div>`;
    })
    .join('')}
  <p class="legend-note">Arsiran: kecamatan yang sedang diperingatkan BMKG akan dilanda hujan lebat dan petir dalam ±2 jam. Diperbarui tiap 5 menit; peringatan yang lewat masa berlakunya hilang sendiri.</p>`;
