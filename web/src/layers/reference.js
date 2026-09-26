import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatNumber } from '../lib/format.js';
import { BOUNDARY_COLOR, FAULT_COLOR, PLATE_COLOR } from '../lib/symbology.js';

// Data rujukan baru diunduh saat layer pertama kali dinyalakan.
function lazyGeoJson(url, options, onError) {
  const layer = L.geoJSON(null, options);
  let loading = null;
  layer.on('add', () => {
    loading ??= getJson(url)
      .then((data) => layer.addData(data))
      .catch((err) => {
        loading = null;
        onError?.(err);
      });
  });
  return layer;
}

// Kode mekanisme PuSGeN: jenis + kemiringan + arah, mis. 'R45S', 'SS-LL90'.
export function faultMechanism(code) {
  if (!code) return 'Tidak diketahui';
  if (code.startsWith('SS')) {
    if (code.includes('LL')) return 'Geser mengiri (sinistral)';
    if (code.includes('RL')) return 'Geser menganan (dekstral)';
    return 'Geser (strike-slip)';
  }
  if (code.startsWith('R')) return 'Naik (reverse)';
  if (code.startsWith('N')) return 'Turun (normal)';
  return code;
}

const decimal = (value) => (value == null ? '–' : formatNumber(Math.round(value * 100) / 100));

// Nama PuSGeN berbahasa Inggris: "Lembang Fault" → "Sesar Lembang"; nama lain
// (mis. "Java Back-arc Thrust") dibiarkan apa adanya.
export function faultDisplayName(nama) {
  return /\s*fault$/i.test(nama) ? `Sesar ${nama.replace(/\s*fault$/i, '')}` : nama;
}

function faultPopup(f) {
  return `
    <div class="popup">
      <h3>${escapeHtml(faultDisplayName(f.nama))}</h3>
      <p class="muted">Segmen ${escapeHtml(f.segmen)} · ${escapeHtml(f.region)}</p>
      <table class="popup-table">
        <tr><th>Mekanisme</th><td>${faultMechanism(f.tipe)} <small>(${escapeHtml(f.tipe)})</small></td></tr>
        <tr><th>Magnitudo maksimum</th><td>M ${decimal(f.mmax)}</td></tr>
        <tr><th>Laju geser</th><td>${decimal(f.slip_rate_mm_per_year)} mm/tahun</td></tr>
        <tr><th>Panjang</th><td>${decimal(f.panjang_km)} km</td></tr>
      </table>
      <p class="source">Sumber: PuSGeN 2024 via InaRISK BNPB</p>
    </div>`;
}

export function createFaultLayer(onError) {
  return lazyGeoJson(
    '/api/faults',
    {
      style: { color: FAULT_COLOR, weight: 1.6, opacity: 0.9 },
      onEachFeature: (feature, layer) => {
        layer.bindPopup(faultPopup(feature.properties), { maxWidth: 300 });
        layer.on('mouseover', () => layer.setStyle({ weight: 3.5 }));
        layer.on('mouseout', () => layer.setStyle({ weight: 1.6 }));
      },
    },
    onError,
  );
}

export function createPlateLayer(onError) {
  return lazyGeoJson(
    '/data/plates.geojson',
    {
      interactive: true,
      style: (f) => ({
        color: PLATE_COLOR,
        weight: f.properties.subduksi ? 2.6 : 1.8,
        dashArray: f.properties.subduksi ? null : '6 5',
        opacity: 0.8,
      }),
      onEachFeature: (f, layer) =>
        layer.bindTooltip(`Batas lempeng ${escapeHtml(f.properties.nama)}${f.properties.subduksi ? ' (zona subduksi)' : ''}`, {
          sticky: true,
        }),
    },
    onError,
  );
}

// 514 poligon digambar di canvas (lebih ringan dari SVG) dan diletakkan di pane
// "boundaries" di bawah sesar dan gempa.
export function createBoundaryLayer(onError) {
  return lazyGeoJson(
    '/api/wilayah?tingkat=kabkota',
    {
      pane: 'boundaries',
      renderer: L.canvas({ pane: 'boundaries' }),
      style: { color: BOUNDARY_COLOR, weight: 0.7, opacity: 0.8, fill: true, fillOpacity: 0 },
      onEachFeature: (f, layer) => {
        layer.bindTooltip(escapeHtml(f.properties.nama), { sticky: true, className: 'boundary-tooltip' });
        layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.08, fillColor: BOUNDARY_COLOR }));
        layer.on('mouseout', () => layer.setStyle({ fillOpacity: 0 }));
      },
    },
    onError,
  );
}

export const faultLegend = () =>
  `<div class="legend-row"><span class="swatch-line" style="border-color:${FAULT_COLOR}"></span>Segmen sesar aktif</div>`;

export const plateLegend = () => `
  <div class="legend-row"><span class="swatch-line swatch-line-thick" style="border-color:${PLATE_COLOR}"></span>Zona subduksi</div>
  <div class="legend-row"><span class="swatch-line swatch-line-dashed" style="border-color:${PLATE_COLOR}"></span>Batas lempeng lain</div>`;

export const boundaryLegend = () =>
  `<div class="legend-row"><span class="swatch-line" style="border-color:${BOUNDARY_COLOR}"></span>Batas kabupaten/kota</div>`;
