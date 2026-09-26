import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDecimal } from '../lib/format.js';
import { flyToBounds, tween } from '../lib/motion.js';
import { VOLCANO_LEVELS } from '../lib/symbology.js';
import { cssVar } from '../lib/theme.js';

const LINE_DRAW_MS = 800;
const SECOND_LINE_DELAY_MS = 250;

// Cek risiko lokasi (M2): memanggil /api/risk untuk sebuah titik, lalu
// menampilkan profil di panel dan garis jarak ke sesar & gunung api terdekat.
// viewPadding() memberi ruang peta yang tertutup panel saat membidik hasil.
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
  let point = null;
  const cancelAnimations = [];

  function setPicking(active) {
    picking = active;
    map.getContainer().classList.toggle('is-picking', active);
    hint.hidden = !active;
    onPickingChange?.(active);
  }

  function clearLayer() {
    cancelAnimations.splice(0).forEach((cancel) => cancel());
    layer.clearLayers();
  }

  // Garis tergambar pelan dari titik ke sesar/gunung api, lalu titik ujung dan
  // label jarak muncul. Label ditempel di ujung garis (bukan di tengah) supaya
  // dua garis pendek dari titik yang sama tidak membuat label bertumpuk.
  function link(from, to, color, text, delay) {
    const target = L.latLng(to);
    const line = L.polyline([from, from], { pane: 'analysis', color, weight: 2.5, dashArray: '6 6', interactive: false }).addTo(layer);
    const draw = () =>
      cancelAnimations.push(
        tween(
          LINE_DRAW_MS,
          (t) => line.setLatLngs([from, [from.lat + (target.lat - from.lat) * t, from.lng + (target.lng - from.lng) * t]]),
          {
            onDone: () =>
              L.circleMarker(target, { pane: 'analysis', radius: 4, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, interactive: false })
                .bindTooltip(`<span class="distance-label__inner">${escapeHtml(text)}</span>`, {
                  permanent: true,
                  direction: 'top',
                  offset: [0, -6],
                  className: 'distance-label',
                })
                .addTo(layer),
          },
        ),
      );
    const timer = setTimeout(draw, delay);
    cancelAnimations.push(() => clearTimeout(timer));
  }

  // Titik yang dianalisis: cincin berdenyut cepat selama memuat.
  function drawPoint(latlng, accuracyM) {
    clearLayer();
    if (accuracyM) {
      L.circle(latlng, { pane: 'analysis', className: 'accuracy-circle', radius: accuracyM, weight: 1, fillOpacity: 0.1, interactive: false }).addTo(layer);
    }
    point = L.marker(latlng, {
      pane: 'analysis',
      icon: L.divIcon({
        className: 'analysis-marker is-loading',
        html: '<span class="analysis-marker__pulse"></span><span class="analysis-marker__dot"></span>',
        iconSize: [30, 30],
      }),
      interactive: false,
      keyboard: false,
    }).addTo(layer);
  }

  // Garis ditarik dari titik yang diklik, bukan dari titik sel cache server
  // (koordinat dibulatkan 3 desimal); selisihnya < 100 m.
  function drawProximity({ nearest_fault: fault, nearest_volcanoes: volcanoes }, origin) {
    if (fault) {
      const [lon, lat] = fault.closest_point;
      link(origin, [lat, lon], cssVar('--fault-color'), `${formatDecimal(fault.distance_km)} km ke sesar`, 0);
    }
    const [volcano] = volcanoes;
    if (volcano) {
      const [lon, lat] = volcano.coordinates;
      const label = `${formatDecimal(volcano.distance_km)} km ke ${volcano.nama}`;
      link(origin, [lat, lon], VOLCANO_LEVELS[volcano.level].color, label, SECOND_LINE_DELAY_MS);
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
      point?.getElement()?.classList.remove('is-loading');
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
      if (layer.getLayers().length) flyToBounds(map, layer.getBounds(), { maxZoom: 13, ...viewPadding() });
    },
    clear() {
      controller?.abort();
      clearLayer();
      card.hide();
      setPicking(false);
    },
  };
}
