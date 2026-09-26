import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatNumber } from '../lib/format.js';
import { cssVar, onThemeChange } from '../lib/theme.js';

// Warna garis diambil dari variabel tema (--fault-color, --plate-color,
// --boundary-color). Garis SVG diwarnai lewat kelas CSS; batas wilayah digambar
// di canvas, jadi warnanya dipasang ulang saat tema berganti.

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

// Nama wilayah PuSGeN berbahasa Inggris.
const REGION_NAMES = {
  Java: 'Jawa',
  Sumatra: 'Sumatra',
  Sulawesi: 'Sulawesi',
  Kalimantan: 'Kalimantan',
  'NT-Banda': 'Nusa Tenggara–Banda',
  'NMaluku-Papua': 'Maluku Utara–Papua',
};

function faultPopup(f) {
  return `
    <div class="popup">
      <h3>${escapeHtml(faultDisplayName(f.nama))}</h3>
      <p class="popup-sub">Segmen ${escapeHtml(f.segmen)} · ${escapeHtml(REGION_NAMES[f.region] ?? f.region)}</p>
      <dl class="popup-facts">
        <dt>Mekanisme</dt><dd>${faultMechanism(f.tipe)} <span class="muted">(${escapeHtml(f.tipe)})</span></dd>
        <dt>Magnitudo maks.</dt><dd>M ${decimal(f.mmax)}</dd>
        <dt>Laju geser</dt><dd>${decimal(f.slip_rate_mm_per_year)} mm/tahun</dd>
        <dt>Panjang</dt><dd>${decimal(f.panjang_km)} km</dd>
      </dl>
      <p class="popup-source">Sumber: PuSGeN 2024 via InaRISK BNPB</p>
    </div>`;
}

export function createFaultLayer(onError) {
  return lazyGeoJson(
    '/api/faults',
    {
      className: 'fault-line',
      style: { weight: 1.6, opacity: 0.9 },
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
      className: 'plate-line',
      style: (f) => ({
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
  const style = () => ({ color: cssVar('--boundary-color'), weight: 0.7, opacity: 0.8, fill: true, fillOpacity: 0 });
  const layer = lazyGeoJson(
    '/api/wilayah?tingkat=kabkota',
    {
      pane: 'boundaries',
      renderer: L.canvas({ pane: 'boundaries' }),
      style,
      onEachFeature: (f, feature) => {
        feature.bindTooltip(escapeHtml(f.properties.nama), { sticky: true, className: 'boundary-tooltip' });
        feature.on('mouseover', () => feature.setStyle({ fillOpacity: 0.12, fillColor: cssVar('--boundary-color') }));
        feature.on('mouseout', () => feature.setStyle({ fillOpacity: 0 }));
      },
    },
    onError,
  );
  onThemeChange(() => layer.setStyle(style));
  return layer;
}

export const faultLegend = () =>
  '<div class="legend-row"><span class="swatch-line" style="border-color:var(--fault-color)"></span>Segmen sesar aktif</div>';

export const plateLegend = () => `
  <div class="legend-row"><span class="swatch-line swatch-line-thick" style="border-color:var(--plate-color)"></span>Zona subduksi</div>
  <div class="legend-row"><span class="swatch-line swatch-line-dashed" style="border-color:var(--plate-color)"></span>Batas lempeng lain</div>`;

export const boundaryLegend = () =>
  '<div class="legend-row"><span class="swatch-line" style="border-color:var(--boundary-color)"></span>Batas kabupaten/kota</div>';
