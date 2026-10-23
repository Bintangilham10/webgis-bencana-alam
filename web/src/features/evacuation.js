import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDecimal } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { FACILITY_KINDS, HAZARD_CLASSES, pillStyle } from '../lib/symbology.js';

// Titik evakuasi dan fasilitas penting OpenStreetMap di sekitar titik cek risiko
// (M3): dimuat setelah profil tampil, digambar sebagai penanda, dan menjadi tujuan
// rute aman. Lapisan nasional titik evakuasi ada di createEvacuationSitesLayer.

export const facilityName = (f) => f.name ?? FACILITY_KINDS[f.category].label;

// Tempat OSM tidak dinilai keamanannya: yang berada di zona banjir/longsor kelas
// tinggi (raster InaRISK ±550 m, dari /api/evacuation) diberi pil merah.
export const zonePill = (hazards = []) =>
  hazards.length
    ? `<span class="class-pill" style="${pillStyle(HAZARD_CLASSES[2])}" title="Perkiraan dari raster bahaya InaRISK ±550 m">Zona ${hazards.join(' & ')} tinggi</span>`
    : '';

export function facilityIcon(category, { size = 26 } = {}) {
  const kind = FACILITY_KINDS[category];
  return L.divIcon({
    className: 'facility-marker',
    html: `<span class="facility-pin" style="--c:${kind.color}">${icons[kind.icon]}</span>`,
    iconSize: [size, size],
    popupAnchor: [0, -size / 2],
    tooltipAnchor: [0, -size / 2],
  });
}

export function facilityPopup(f) {
  const kind = FACILITY_KINDS[f.category];
  const where = f.tags?.['addr:full'] ?? f.tags?.['addr:street'];
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="facility-pin facility-pin--lg" style="--c:${kind.color}">${icons[kind.icon]}</span>
        <div class="popup-heading">
          <h3>${escapeHtml(facilityName(f))}</h3>
          <p class="popup-sub">${kind.label}${f.distance_m == null ? '' : ` · ${formatDecimal(f.distance_m / 1000)} km dari titik`}</p>
        </div>
      </div>
      ${where ? `<p class="popup-place">${escapeHtml(where)}</p>` : ''}
      ${f.zona_tinggi?.length ? `<p class="popup-place">${zonePill(f.zona_tinggi)}</p>` : ''}
      <button type="button" class="btn btn-primary btn-block" data-action="route" data-facility="${escapeHtml(f.id)}">${icons.route}Rute aman ke sini</button>
      <p class="popup-source">Sumber: OpenStreetMap (ODbL)${f.tags?.evacuation_center === 'yes' ? ' · ditandai sebagai tempat evakuasi' : ''}</p>
    </div>`;
}

// Tombol "Rute aman ke sini" di popup sebuah penanda.
function wireRouteButton(marker, f, onRoute) {
  marker.on('popupopen', (event) =>
    event.popup.getElement()?.querySelector('[data-action="route"]')?.addEventListener('click', () => {
      marker.closePopup();
      onRoute(f);
    }),
  );
}

export function createEvacuation({ map, card, onRoute }) {
  const layer = L.featureGroup().addTo(map);
  const facilities = new Map();
  let markers = new Map();

  function draw(data) {
    layer.clearLayers();
    markers = new Map();
    for (const f of [...data.facilities, ...data.evacuation]) {
      const evacuation = f.category === 'evakuasi' || f.category === 'titik_kumpul';
      const marker = L.marker([f.lat, f.lon], { icon: facilityIcon(f.category), zIndexOffset: evacuation ? 500 : 0 })
        .bindTooltip(escapeHtml(facilityName(f)), { direction: 'top' })
        .bindPopup(() => facilityPopup(f), { maxWidth: 300 });
      wireRouteButton(marker, f, onRoute);
      markers.set(f.id, marker);
      layer.addLayer(marker);
    }
  }

  return {
    async load(latlng, signal) {
      try {
        const data = await getJson(`/api/evacuation?lat=${latlng.lat.toFixed(5)}&lon=${latlng.lng.toFixed(5)}`, { signal });
        facilities.clear();
        for (const f of [...data.evacuation, ...data.facilities]) facilities.set(f.id, f);
        draw(data);
        card.renderEvacuation(data);
      } catch (err) {
        if (err.name !== 'AbortError') card.evacuationError(err.message);
      }
    },
    get: (id) => facilities.get(id),
    // Penanda tujuan rute ditonjolkan; yang lain diredupkan.
    highlight(id) {
      for (const [key, marker] of markers) marker.getElement()?.classList.toggle('is-dimmed', id !== null && key !== id);
    },
    clear() {
      layer.clearLayers();
      facilities.clear();
      markers = new Map();
    },
  };
}

// Lapisan nasional: semua titik evakuasi dan titik kumpul OSM (±1.600), dimuat
// sekali saat dinyalakan. Titik kanvas karena jumlahnya banyak.
export function createEvacuationSitesLayer({ onLoad, onError, onRoute }) {
  const renderer = L.canvas({ padding: 0.3 });
  const layer = L.geoJSON(null, {
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, { renderer, radius: 4.5, color: '#fff', weight: 1.2, fillColor: FACILITY_KINDS[feature.properties.category].color, fillOpacity: 0.95 }),
    onEachFeature(feature, marker) {
      const f = { ...feature.properties, lat: feature.geometry.coordinates[1], lon: feature.geometry.coordinates[0] };
      marker.bindTooltip(escapeHtml(facilityName(f)), { direction: 'top' });
      marker.bindPopup(() => facilityPopup(f), { maxWidth: 300 });
      wireRouteButton(marker, f, onRoute);
    },
  });
  let loaded = false;
  layer.on('add', async () => {
    if (loaded) return;
    loaded = true;
    try {
      const data = await getJson('/api/evacuation-sites');
      layer.addData(data);
      onLoad?.(data);
    } catch (err) {
      loaded = false;
      onError?.(err);
    }
  });
  return layer;
}

export const evacuationSitesLegend = () => `
  <div class="legend-row"><span class="facility-dot" style="--c:${FACILITY_KINDS.evakuasi.color}"></span>Tempat evakuasi dan titik kumpul</div>
  <p class="legend-note">Dari OpenStreetMap: evacuation_center=yes, emergency=assembly_point, dan titik pengungsian hasil pemetaan BPBD/HOT. Belum lengkap; banyak daerah belum memetakannya. Ikuti arahan BPBD setempat.</p>`;
