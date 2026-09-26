import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, timeAgo } from '../lib/format.js';
import { DEPTH_CLASSES, depthColor, magnitudeRadius } from '../lib/symbology.js';

export function earthquakePopup(p) {
  const potensi = p.tsunami
    ? '<p class="alert-tsunami">⚠ Berpotensi tsunami — ikuti arahan BMKG dan BPBD</p>'
    : p.potensi ? `<p class="muted">${escapeHtml(p.potensi)}</p>` : '';
  return `
    <div class="popup">
      <h3>M ${p.magnitude.toFixed(1)} · kedalaman ${p.depth_km} km (${p.depth_class})</h3>
      <p class="muted">${formatDateTime(p.occurred_at)}, ${timeAgo(p.occurred_at)}</p>
      <p>${escapeHtml(p.wilayah)}</p>
      ${potensi}
      ${p.dirasakan ? `<p><strong>Dirasakan (skala MMI):</strong> ${escapeHtml(p.dirasakan)}</p>` : ''}
      ${p.shakemap ? `<p><a href="${escapeHtml(p.shakemap)}" target="_blank" rel="noopener">Peta guncangan (shakemap) BMKG</a></p>` : ''}
      <p class="source">Sumber: ${escapeHtml(p.source)}</p>
    </div>`;
}

export function createEarthquakeLayer(map) {
  const group = L.featureGroup();
  const markers = new Map();
  let signature = '';

  function render(collection) {
    // Popup yang sedang dibaca dibuka lagi setelah data diperbarui.
    const openId = [...markers].find(([, marker]) => marker.isPopupOpen())?.[0];
    group.clearLayers();
    markers.clear();

    // Gempa besar digambar lebih dulu supaya gempa kecil di atasnya tetap bisa diklik.
    const byMagnitude = [...collection.features].sort((a, b) => b.properties.magnitude - a.properties.magnitude);
    for (const { geometry, properties: p } of byMagnitude) {
      const [lon, lat] = geometry.coordinates;
      const marker = L.circleMarker([lat, lon], {
        pane: 'quakes',
        radius: magnitudeRadius(p.magnitude),
        color: '#5c1a0b',
        weight: 1,
        fillColor: depthColor(p.depth_class),
        fillOpacity: 0.8,
      })
        .bindPopup(earthquakePopup(p), { maxWidth: 300 })
        .bindTooltip(`M ${p.magnitude.toFixed(1)} · ${timeAgo(p.occurred_at)}`, { direction: 'top' });
      markers.set(p.id, marker.addTo(group));
    }

    const latest = collection.features[0];
    if (latest) {
      const [lon, lat] = latest.geometry.coordinates;
      // Animasi ada di <span> dalam ikon: transform milik elemen ikon dipakai
      // Leaflet untuk posisi, jadi tidak boleh ditimpa animasi scale.
      L.marker([lat, lon], {
        icon: L.divIcon({ className: 'quake-pulse', html: '<span></span>', iconSize: [28, 28] }),
        interactive: false,
        keyboard: false,
      }).addTo(group);
    }
    markers.get(openId)?.openPopup();
  }

  return {
    layer: group,
    async load() {
      const collection = await getJson('/api/earthquakes?days=7');
      const next = JSON.stringify(collection.features.map((f) => [f.properties.id, f.properties.magnitude, f.properties.depth_km]));
      if (next !== signature) {
        signature = next;
        render(collection);
      }
      return collection;
    },
    focus(id) {
      const marker = markers.get(id);
      if (!marker) return;
      if (!map.hasLayer(group)) group.addTo(map);
      map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 7), { duration: 0.8 });
      map.once('moveend', () => marker.openPopup());
    },
  };
}

export function earthquakeLegend() {
  const sizes = [4, 5, 6, 7]
    .map((m) => {
      const d = 2 * magnitudeRadius(m);
      return `<span class="legend-size"><span class="legend-circle" style="width:${d}px;height:${d}px"></span>M${m}</span>`;
    })
    .join('');
  const depths = DEPTH_CLASSES.map(
    (c) => `<div class="legend-row"><span class="swatch swatch-circle" style="background:${c.color}"></span>${c.label}</div>`,
  ).join('');
  return `<div class="legend-sizes">${sizes}</div>${depths}
    <div class="legend-row"><span class="swatch swatch-pulse"></span>Gempa paling baru</div>`;
}
