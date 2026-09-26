import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, formatDecimal, shortQuakeRegion, timeAgo } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { DEPTH_CLASSES, depthClass, magnitudeRadius, pillStyle } from '../lib/symbology.js';

export function earthquakePopup(p) {
  const depth = depthClass(p.depth_class);
  const magnitude = formatDecimal(p.magnitude);
  const tsunami = p.tsunami
    ? `<p class="popup-alert">${icons.alert}<span>Berpotensi tsunami — segera ikuti arahan BMKG dan BPBD.</span></p>`
    : '';
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="mag-badge mag-badge--lg" style="${pillStyle(depth)}">${magnitude}</span>
        <div class="popup-heading">
          <h3>Gempa M ${magnitude}</h3>
          <p class="popup-sub">${timeAgo(p.occurred_at)}</p>
        </div>
      </div>
      <p class="popup-place">${escapeHtml(shortQuakeRegion(p.wilayah))}</p>
      ${tsunami}
      <dl class="popup-facts">
        <dt>Waktu</dt><dd>${formatDateTime(p.occurred_at)}</dd>
        <dt>Kedalaman</dt><dd>${p.depth_km} km (${escapeHtml(p.depth_class)})</dd>
        ${p.dirasakan ? `<dt>Dirasakan</dt><dd>${escapeHtml(p.dirasakan)} <span class="muted">skala MMI</span></dd>` : ''}
        ${!p.tsunami && p.potensi ? `<dt>Keterangan</dt><dd>${escapeHtml(p.potensi)}</dd>` : ''}
      </dl>
      ${p.shakemap ? `<a class="popup-link" href="${escapeHtml(p.shakemap)}" target="_blank" rel="noopener">Peta guncangan BMKG${icons.external}</a>` : ''}
      <p class="popup-source">Sumber: ${escapeHtml(p.source)}</p>
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

    // Gempa besar digambar lebih dulu supaya gempa kecil di atasnya tetap bisa
    // diklik; cincin putih memisahkan lingkaran yang bertumpuk.
    const byMagnitude = [...collection.features].sort((a, b) => b.properties.magnitude - a.properties.magnitude);
    for (const { geometry, properties: p } of byMagnitude) {
      const [lon, lat] = geometry.coordinates;
      const marker = L.circleMarker([lat, lon], {
        pane: 'quakes',
        radius: magnitudeRadius(p.magnitude),
        color: '#fff',
        weight: 1.5,
        fillColor: depthClass(p.depth_class).color,
        fillOpacity: 0.85,
      })
        .bindPopup(earthquakePopup(p), { maxWidth: 320 })
        .bindTooltip(`M ${formatDecimal(p.magnitude)} · ${timeAgo(p.occurred_at)}`, { direction: 'top' });
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
