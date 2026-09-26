import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, formatNumber } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { flyTo } from '../lib/motion.js';
import { pillStyle, VOLCANO_LEVELS, volcanoSymbol } from '../lib/symbology.js';

const MAGMA_STATUS_URL = 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas';
// Ukuran simbol per level (px): makin tinggi level, makin besar.
const MARKER_SIZES = { 1: 18, 2: 18, 3: 24, 4: 28 };

const volcanoName = (nama) => (/^gunung\s/i.test(nama) ? nama : `Gunung ${nama}`);

function volcanoPopup(v) {
  const level = VOLCANO_LEVELS[v.level];
  const location = [v.kabupaten, v.provinsi].filter(Boolean).map(escapeHtml).join(' — ');
  const changed = v.level_changed_at ? formatDateTime(v.level_changed_at) : 'Belum ada sejak sistem mulai memantau';
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="row-icon">${volcanoSymbol(v.level)}</span>
        <div class="popup-heading">
          <h3>${escapeHtml(volcanoName(v.nama))}</h3>
          <span class="level-pill" style="${pillStyle(level)}">${level.label}</span>
        </div>
      </div>
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

export function createVolcanoLayer(map) {
  const group = L.layerGroup();
  const markers = new Map();

  function render(collection) {
    group.clearLayers();
    markers.clear();
    collection.features.forEach(({ geometry, properties: v }, index) => {
      const [lon, lat] = geometry.coordinates;
      const level = VOLCANO_LEVELS[v.level];
      const alert = v.level >= 3;
      const size = MARKER_SIZES[v.level] ?? MARKER_SIZES[1];
      // Siaga/Awas lebih besar dan diberi cincin berdenyut. --i = urutan
      // muncul; animasi ada di elemen dalam (bukan elemen ikon yang posisinya
      // diatur Leaflet lewat transform).
      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: `volcano-icon${alert ? ' volcano-icon--alert' : ''}`,
          html:
            `<span class="volcano-marker" style="--level-color:${level.color};--i:${index}">` +
            `${alert ? '<i class="volcano-halo"></i>' : ''}${volcanoSymbol(v.level)}</span>`,
          iconSize: [size, size],
        }),
        title: `${volcanoName(v.nama)} (${level.label})`,
        // Status lebih tinggi selalu tampil di atas bila berdekatan.
        zIndexOffset: v.level * 100,
      }).bindPopup(volcanoPopup(v), { maxWidth: 320 });
      markers.set(v.kode, marker.addTo(group));
    });
  }

  return {
    layer: group,
    async load() {
      const collection = await getJson('/api/volcanoes');
      render(collection);
      return collection;
    },
    focus(kode) {
      const marker = markers.get(kode);
      if (!marker) return;
      if (!map.hasLayer(group)) group.addTo(map);
      map.once('moveend', () => marker.openPopup());
      flyTo(map, marker.getLatLng(), Math.max(map.getZoom(), 9));
    },
  };
}

export function volcanoLegend() {
  const rows = Object.entries(VOLCANO_LEVELS)
    .map(([id, l]) => `<div class="legend-row">${volcanoSymbol(Number(id))}${l.roman} · ${l.short}</div>`)
    .join('');
  return `<div class="legend-grid">${rows}</div>`;
}
