import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, formatNumber } from '../lib/format.js';
import { VOLCANO_LEVELS } from '../lib/symbology.js';

const MAGMA_STATUS_URL = 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas';

function volcanoPopup(v) {
  const { label, color } = VOLCANO_LEVELS[v.level];
  const location = [v.kabupaten, v.provinsi].filter(Boolean).map(escapeHtml).join(' — ');
  const changed = v.level_changed_at
    ? `Level berubah pada ${formatDateTime(v.level_changed_at)}.`
    : 'Belum ada perubahan level sejak sistem mulai memantau.';
  return `
    <div class="popup">
      <h3>${escapeHtml(v.nama)} <small>gunung api</small></h3>
      <p><span class="level-badge" style="background:${color}">${label}</span></p>
      <p>${location}</p>
      ${v.elevasi_m ? `<p>Elevasi ${formatNumber(v.elevasi_m)} m dpl</p>` : ''}
      <p class="muted">Diperiksa ${formatDateTime(v.checked_at)}. ${changed}</p>
      <p><a href="${MAGMA_STATUS_URL}" target="_blank" rel="noopener">Rekomendasi resmi PVMBG di MAGMA</a></p>
      <p class="source">Sumber: PVMBG — MAGMA Indonesia</p>
    </div>`;
}

export function createVolcanoLayer() {
  const group = L.layerGroup();

  function render(collection) {
    group.clearLayers();
    for (const { geometry, properties: v } of collection.features) {
      const [lon, lat] = geometry.coordinates;
      const size = v.level >= 3 ? 24 : 18;
      L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'volcano-icon',
          html: `<span style="--level-color:${VOLCANO_LEVELS[v.level].color}"></span>`,
          iconSize: [size, size],
        }),
        title: `${v.nama} (${VOLCANO_LEVELS[v.level].label})`,
        // Status lebih tinggi selalu tampil di atas bila berdekatan.
        zIndexOffset: v.level * 100,
      })
        .bindPopup(volcanoPopup(v), { maxWidth: 300 })
        .addTo(group);
    }
  }

  return {
    layer: group,
    async load() {
      const collection = await getJson('/api/volcanoes');
      render(collection);
      return collection;
    },
  };
}

export function volcanoLegend() {
  return Object.values(VOLCANO_LEVELS)
    .map((l) => `<div class="legend-row"><span class="swatch swatch-triangle" style="--level-color:${l.color}"></span>${l.label}</div>`)
    .join('');
}
