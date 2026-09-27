import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, formatNumber } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { makeFocusable } from '../lib/marker-focus.js';
import { pillStyle, VOLCANO_LEVELS } from '../lib/symbology.js';

const MAGMA_STATUS_URL = 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas';
// Zoom tujuan saat gunung api diklik: lereng dan desa di sekitarnya terlihat.
const FOCUS_ZOOM = 12;

// Jeda animasi dibagi merata dalam satu siklus (detik, sama dengan map.css).
const RING_SECONDS = 2.6;
const ASH_SECONDS = 2.2;
const EMBER_SECONDS = 1.4;
// Kolom abu erupsi: empat kepulan beda ukuran dan arah, plus tiga percikan lava.
const ASH_PUFFS = [
  { size: 8, dx: 2 },
  { size: 10, dx: 5 },
  { size: 7, dx: -2 },
  { size: 9, dx: 4 },
];
const EMBER_DRIFTS = [-5, 4, 7];

// Kerucut berfaset: lereng melengkung ke dalam, kawah di puncak, dan dua bidang
// warna polos (terang di kiri, gelap di kanan) yang memberi kesan 3D.
// Terinspirasi ikon peta MAGMA, tetapi digambar sendiri.
const CONE =
  '<svg class="volcano-cone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path class="volcano-cone__light" d="M2 21Q8.2 16 9.6 6.4L10.9 7.5 12 7.5 13.4 21Z"/>' +
  '<path class="volcano-cone__shade" d="M12 7.5 13.1 7.5 14.4 6.4Q15.8 16 22 21L13.4 21Z"/>' +
  '<path class="volcano-cone__edge" d="M2 21Q8.2 16 9.6 6.4L10.9 7.5 13.1 7.5 14.4 6.4Q15.8 16 22 21Z"/></svg>';

const volcanoName = (nama) => (/^gunung\s/i.test(nama) ? nama : `Gunung ${nama}`);
const delay = (k, count, seconds) => `animation-delay:${((k * seconds) / count).toFixed(2)}s`;

function eruptionHtml() {
  const ash = ASH_PUFFS.map(
    ({ size, dx }, k) => `<i class="volcano-ash" style="--size:${size}px;--dx:${dx}px;${delay(k, ASH_PUFFS.length, ASH_SECONDS)}"></i>`,
  );
  const embers = EMBER_DRIFTS.map((dx, k) => `<i class="volcano-ember" style="--dx:${dx}px;${delay(k, EMBER_DRIFTS.length, EMBER_SECONDS)}"></i>`);
  return [...ash, ...embers].join('');
}

// Siaga/Awas bercincin; gunung api yang sedang erupsi (data MAGMA) mengepulkan
// abu dari kawah. Abu ditulis sebelum kerucut supaya tampak keluar dari balik kawah.
function volcanoMarkerHtml(v, index) {
  const level = VOLCANO_LEVELS[v.level];
  const rings = v.level >= 3 ? [0, 1].map((k) => `<i class="volcano-ring" style="${delay(k, 2, RING_SECONDS)}"></i>`).join('') : '';
  return `<span class="volcano-marker" style="--level-color:${level.color};--i:${index}">${rings}${v.erupsi ? eruptionHtml() : ''}${CONE}</span>`;
}

// Contoh kerucut kecil untuk legenda dan daftar lapisan.
export const volcanoSwatch = (levelId, { erupting = false } = {}) =>
  `<span class="volcano-swatch${erupting ? ' volcano-swatch--erupting' : ''}" style="--level-color:${VOLCANO_LEVELS[levelId].color}">${CONE}</span>`;

function volcanoPopup(v) {
  const level = VOLCANO_LEVELS[v.level];
  const location = [v.kabupaten, v.provinsi].filter(Boolean).map(escapeHtml).join(' — ');
  const changed = v.level_changed_at ? formatDateTime(v.level_changed_at) : 'Belum ada sejak sistem mulai memantau';
  const vona = v.vona ? ' VONA (peringatan abu vulkanik untuk penerbangan) sedang berlaku.' : '';
  const eruption = v.erupsi ? `<p class="popup-alert">${icons.alert}<span>Sedang erupsi.${vona} Ikuti rekomendasi PVMBG.</span></p>` : '';
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="row-icon"><span class="volcano-glyph" style="--level-color:${level.color}"></span></span>
        <div class="popup-heading">
          <h3>${escapeHtml(volcanoName(v.nama))}</h3>
          <span class="level-pill" style="${pillStyle(level)}">${level.label}</span>
        </div>
      </div>
      ${eruption}
      <dl class="popup-facts">
        ${location ? `<dt>Lokasi</dt><dd>${location}</dd>` : ''}
        ${v.elevasi_m ? `<dt>Elevasi</dt><dd>${formatNumber(v.elevasi_m)} m dpl</dd>` : ''}
        <dt>Diperiksa</dt><dd>${formatDateTime(v.checked_at)}</dd>
        <dt>Perubahan level</dt><dd>${changed}</dd>
      </dl>
      <a class="popup-link" href="${MAGMA_STATUS_URL}" target="_blank" rel="noopener">Rekomendasi resmi PVMBG${icons.external}</a>
      <p class="popup-source">Sumber: PVMBG — MAGMA Indonesia</p>
    </div>`;
}

// viewPadding() = ruang peta yang tertutup panel, supaya gunung api yang dituju
// mendarat di area yang terlihat.
export function createVolcanoLayer(map, { viewPadding } = {}) {
  const group = L.layerGroup();
  const openers = new Map();
  let signature = '';

  function render(collection) {
    group.clearLayers();
    openers.clear();
    collection.features.forEach(({ geometry, properties: v }, index) => {
      const [lon, lat] = geometry.coordinates;
      const level = VOLCANO_LEVELS[v.level];
      const alert = v.level >= 3;
      // Siaga/Awas lebih besar dan bercincin. --i = urutan muncul; animasi ada
      // di elemen dalam (bukan elemen ikon yang posisinya diatur Leaflet lewat
      // transform).
      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: `volcano-icon${alert ? ' volcano-icon--alert' : ''}`,
          html: volcanoMarkerHtml(v, index),
          iconSize: alert ? [28, 28] : [22, 22],
        }),
        title: `${volcanoName(v.nama)} (${level.label}${v.erupsi ? ', sedang erupsi' : ''})`,
        // Status lebih tinggi dan yang sedang erupsi tampil di atas bila berdekatan.
        zIndexOffset: v.level * 100 + (v.erupsi ? 50 : 0),
      }).addTo(group);
      openers.set(
        v.kode,
        makeFocusable(map, marker, { zoom: FOCUS_ZOOM, popup: () => volcanoPopup(v), viewPadding }),
      );
    });
  }

  return {
    layer: group,
    async load() {
      const collection = await getJson('/api/volcanoes');
      // Digambar ulang hanya bila level atau status erupsi berubah, supaya
      // animasi muncul tidak terulang dan popup yang terbuka tidak tertutup.
      const next = collection.features
        .map(({ properties: v }) => `${v.kode}:${v.level}:${v.erupsi ? 1 : 0}${v.vona ? 1 : 0}`)
        .join('|');
      if (next !== signature) {
        signature = next;
        render(collection);
      }
      return collection;
    },
    focus(kode) {
      if (!openers.has(kode)) return;
      if (!map.hasLayer(group)) group.addTo(map);
      openers.get(kode)();
    },
  };
}

export function volcanoLegend() {
  const rows = Object.entries(VOLCANO_LEVELS)
    .map(([id, l]) => `<div class="legend-row">${volcanoSwatch(id)}${l.roman} · ${l.short}</div>`)
    .join('');
  return `<div class="legend-grid">${rows}</div>
    <div class="legend-row">${volcanoSwatch(2, { erupting: true })}Sedang erupsi (kepulan abu, data MAGMA)</div>
    <p class="legend-note">Siaga dan Awas lebih besar dan bercincin.</p>`;
}
