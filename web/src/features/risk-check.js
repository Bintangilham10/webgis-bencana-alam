import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { formatDecimal } from '../lib/format.js';
import { ANALYSIS_COLOR, FAULT_COLOR, VOLCANO_LEVELS } from '../lib/symbology.js';

// Cek risiko lokasi (M2): memanggil /api/risk untuk sebuah titik, lalu
// menampilkan profil di kartu dan garis jarak ke sesar & gunung api terdekat.
// viewPadding() memberi ruang peta yang tertutup kartu saat membidik hasil.
export function createRiskCheck({ map, card, onPickingChange, viewPadding = () => ({}) }) {
  const layer = L.featureGroup().addTo(map);
  const hint = L.DomUtil.create('div', 'map-hint', map.getContainer());
  hint.textContent = window.matchMedia('(pointer: coarse)').matches
    ? 'Ketuk titik di peta untuk cek risiko'
    : 'Klik titik di peta untuk cek risiko · Esc untuk batal';
  hint.hidden = true;

  let picking = false;
  let controller = null;
  let lastRequest = null;

  function setPicking(active) {
    picking = active;
    map.getContainer().classList.toggle('is-picking', active);
    hint.hidden = !active;
    onPickingChange?.(active);
  }

  // Label jarak ditempel di ujung garis (sesar/gunung api), bukan di tengahnya:
  // dua garis pendek dari titik yang sama membuat label di tengah bertumpuk.
  function link(from, to, color, text) {
    L.polyline([from, to], { pane: 'analysis', color, weight: 2, dashArray: '6 6', interactive: false }).addTo(layer);
    L.circleMarker(to, { pane: 'analysis', radius: 4, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, interactive: false })
      .bindTooltip(text, { permanent: true, direction: 'top', offset: [0, -6], className: 'distance-label' })
      .addTo(layer);
  }

  function drawPoint(latlng, accuracyM) {
    layer.clearLayers();
    if (accuracyM) {
      L.circle(latlng, { pane: 'analysis', radius: accuracyM, color: ANALYSIS_COLOR, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(layer);
    }
    L.circleMarker(latlng, { pane: 'analysis', radius: 7, color: '#fff', weight: 2, fillColor: ANALYSIS_COLOR, fillOpacity: 1, interactive: false }).addTo(layer);
  }

  // Garis ditarik dari titik yang diklik, bukan dari titik sel cache server
  // (koordinat dibulatkan 3 desimal); selisihnya < 100 m.
  function drawProximity({ nearest_fault: fault, nearest_volcanoes: volcanoes }, origin) {
    if (fault) {
      const [lon, lat] = fault.closest_point;
      link(origin, [lat, lon], FAULT_COLOR, `${formatDecimal(fault.distance_km)} km ke sesar`);
    }
    const [volcano] = volcanoes;
    if (volcano) {
      const [lon, lat] = volcano.coordinates;
      link(origin, [lat, lon], VOLCANO_LEVELS[volcano.level].color, `${formatDecimal(volcano.distance_km)} km ke ${volcano.nama}`);
    }
  }

  async function check(latlng, { label, accuracyM } = {}) {
    lastRequest = [latlng, { label, accuracyM }];
    setPicking(false);
    // Hanya hasil permintaan terakhir yang ditampilkan.
    controller?.abort();
    controller = new AbortController();
    drawPoint(latlng, accuracyM);
    card.showLoading({ lat: latlng.lat, lon: latlng.lng, label });
    try {
      const url = `/api/risk?lat=${latlng.lat.toFixed(5)}&lon=${latlng.lng.toFixed(5)}`;
      const profile = await getJson(url, { signal: controller.signal });
      card.render(profile, { label, lat: latlng.lat, lon: latlng.lng });
      drawProximity(profile, latlng);
    } catch (err) {
      if (err.name !== 'AbortError') card.showError(err.message);
    }
  }

  map.on('click', (event) => {
    if (picking) check(event.latlng);
  });
  // Pintasan: klik kanan di desktop atau tekan lama di layar sentuh.
  map.on('contextmenu', (event) => check(event.latlng));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && picking) setPicking(false);
  });

  return {
    check,
    retry: () => lastRequest && check(...lastRequest),
    togglePicking: () => setPicking(!picking),
    fitToResult: () => {
      if (layer.getLayers().length) map.fitBounds(layer.getBounds(), { maxZoom: 13, ...viewPadding() });
    },
    clear() {
      controller?.abort();
      layer.clearLayers();
      card.hide();
      setPicking(false);
    },
  };
}
