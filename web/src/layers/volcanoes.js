import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, formatNumber } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { pillStyle, VOLCANO_LEVELS } from '../lib/symbology.js';

const MAGMA_STATUS_URL = 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas';

const volcanoName = (nama) => (/^gunung\s/i.test(nama) ? nama : `Gunung ${nama}`);

function volcanoPopup(v) {
  const level = VOLCANO_LEVELS[v.level];
  const location = [v.kabupaten, v.provinsi].filter(Boolean).map(escapeHtml).join(' — ');
  const changed = v.level_changed_at ? formatDateTime(v.level_changed_at) : 'Belum ada sejak sistem mulai memantau';
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="row-icon"><span class="volcano-glyph" style="--level-color:${level.color}"></span></span>
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
    for (const { geometry, properties: v } of collection.features) {
      const [lon, lat] = geometry.coordinates;
      const level = VOLCANO_LEVELS[v.level];
      const size = v.level >= 3 ? 24 : 18;
      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'volcano-icon',
          html: `<span style="--level-color:${level.color}"></span>`,
          iconSize: [size, size],
        }),
        title: `${volcanoName(v.nama)} (${level.label})`,
        // Status lebih tinggi selalu tampil di atas bila berdekatan.
        zIndexOffset: v.level * 100,
      }).bindPopup(volcanoPopup(v), { maxWidth: 320 });
      markers.set(v.kode, marker.addTo(group));
    }
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
      map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 9), { duration: 0.8 });
      map.once('moveend', () => marker.openPopup());
    },
  };
}

export function volcanoLegend() {
  const rows = Object.values(VOLCANO_LEVELS)
    .map((l) => `<div class="legend-row"><span class="swatch swatch-triangle" style="--level-color:${l.color}"></span>${l.roman} · ${l.short}</div>`)
    .join('');
  return `<div class="legend-grid">${rows}</div>`;
}
