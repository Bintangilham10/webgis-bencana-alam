// Hanya reset dasar dan utility class Bootstrap: halaman harus tetap ringan
// untuk HP dengan sinyal lemah di daerah bencana.
import 'bootstrap/dist/css/bootstrap-reboot.min.css';
import 'bootstrap/dist/css/bootstrap-utilities.min.css';
import 'leaflet/dist/leaflet.css';
import './styles.css';

import L from 'leaflet';
import { createRiskCheck } from './features/risk-check.js';
import { createEarthquakeLayer, earthquakeLegend } from './layers/earthquakes.js';
import { createHazardLayer, HAZARDS, hazardLegend } from './layers/hazards.js';
import {
  boundaryLegend,
  createBoundaryLayer,
  createFaultLayer,
  createPlateLayer,
  faultLegend,
  plateLegend,
} from './layers/reference.js';
import { createVolcanoLayer, volcanoLegend } from './layers/volcanoes.js';
import { createMap } from './map/create-map.js';
import { showCoordinates, showScale } from './map/readouts.js';
import { SearchControl } from './map/search-control.js';
import { ToolsControl } from './map/tools-control.js';
import { createLayerPanel } from './ui/layer-panel.js';
import { createRiskCard } from './ui/risk-card.js';
import { createSyncStatus, renderEarthquakeSummary, renderVolcanoSummary } from './ui/summary.js';

const $ = (selector) => document.querySelector(selector);

const EARTHQUAKE_REFRESH_MS = 60_000;
const VOLCANO_REFRESH_MS = 10 * 60_000;
const HAZARD_OPACITY = 0.65;
const PLACE_ZOOM = 13;

const map = createMap($('#map'));
showCoordinates(map, $('#coordinates'));
showScale(map, $('#scale-readout'));

// ---------- Cek risiko lokasi: pencarian, lokasi saya, dan pilih titik ----------
const isNarrowScreen = () => window.matchMedia('(max-width: 767.98px)').matches;

// Bagian peta yang tertutup kartu risiko (kanan di desktop, bawah di HP), supaya
// titik dan label jarak tidak tersembunyi di balik kartu saat peta membidik hasil.
function viewPadding() {
  return {
    paddingTopLeft: [40, 40],
    paddingBottomRight: isNarrowScreen() ? [40, Math.round(window.innerHeight * 0.5)] : [420, 40],
  };
}

const riskCard = createRiskCard($('#risk-card'), {
  onClose: () => risk.clear(),
  onFit: () => risk.fitToResult(),
});
const tools = new ToolsControl({
  onLocate: locateUser,
  onPick: () => risk.togglePicking(),
});
const risk = createRiskCheck({
  map,
  card: riskCard,
  viewPadding,
  onPickingChange: (active) => tools.setPicking(active),
});

map.addControl(
  new SearchControl({
    onSelect(place) {
      const target = L.latLng(place.lat, place.lon);
      map.fitBounds(place.bounds ?? target.toBounds(2_000), { maxZoom: PLACE_ZOOM, ...viewPadding() });
      risk.check(target, { label: place.name });
    },
  }),
);
map.addControl(L.control.zoom({ position: 'topleft', zoomInTitle: 'Perbesar', zoomOutTitle: 'Perkecil' }));
map.addControl(tools);

function locateUser() {
  if (!navigator.geolocation) {
    riskCard.showMessage('Browser ini tidak mendukung penentuan lokasi. Cari lokasi secara manual.');
    return;
  }
  riskCard.showMessage('Mencari lokasi Anda…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const here = L.latLng(coords.latitude, coords.longitude);
      map.fitBounds(here.toBounds(Math.max(coords.accuracy * 2, 1_500)), { maxZoom: PLACE_ZOOM, ...viewPadding() });
      risk.check(here, { label: 'Lokasi Anda', accuracyM: coords.accuracy });
    },
    (err) =>
      riskCard.showMessage(
        err.code === err.PERMISSION_DENIED
          ? 'Izin lokasi ditolak. Izinkan akses lokasi di browser, atau cari lokasi secara manual.'
          : 'Lokasi tidak dapat ditentukan. Coba lagi atau cari lokasi secara manual.',
      ),
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  );
}

const status = createSyncStatus($('#sync-status'));
const earthquakes = createEarthquakeLayer(map);
const volcanoes = createVolcanoLayer();
const reportLoadError = (name) => (err) => status.fail(name, err);

createLayerPanel({
  map,
  container: $('#layer-controls'),
  legendElement: $('#legend'),
  groups: [
    {
      id: 'kejadian',
      title: 'Kejadian & status terkini',
      items: [
        { label: 'Gempa BMKG (7 hari)', layer: earthquakes.layer, legend: earthquakeLegend, on: true },
        { label: 'Status gunung api (MAGMA)', layer: volcanoes.layer, legend: volcanoLegend, on: true },
      ],
    },
    {
      id: 'bahaya',
      title: 'Peta rawan bencana',
      note: 'InaRISK BNPB',
      exclusive: true,
      opacity: HAZARD_OPACITY,
      items: HAZARDS.map((hazard) => ({
        label: hazard.label,
        layer: createHazardLayer(hazard, HAZARD_OPACITY),
        legend: hazardLegend,
      })),
    },
    {
      id: 'geologi',
      title: 'Geologi & wilayah',
      items: [
        { label: 'Sesar aktif (PuSGeN 2024)', layer: createFaultLayer(reportLoadError('Sesar')), legend: faultLegend, on: true },
        { label: 'Batas lempeng tektonik', layer: createPlateLayer(reportLoadError('Lempeng')), legend: plateLegend, on: true },
        { label: 'Batas kabupaten/kota', layer: createBoundaryLayer(reportLoadError('Batas wilayah')), legend: boundaryLegend },
      ],
    },
  ],
});

async function refreshEarthquakes() {
  try {
    const collection = await earthquakes.load();
    renderEarthquakeSummary(collection, {
      list: $('#quake-list'),
      count24h: $('#stat-quakes-24h'),
      countM5: $('#stat-quakes-m5'),
      onSelect: (id) => {
        closePanelOnMobile();
        earthquakes.focus(id);
      },
    });
    status.ok('Gempa', collection.meta.synced_at);
  } catch (err) {
    status.fail('Gempa', err);
  }
}

async function refreshVolcanoes() {
  try {
    const collection = await volcanoes.load();
    renderVolcanoSummary(collection, { countAlert: $('#stat-volcanoes') });
    status.ok('Gunung api', collection.meta.synced_at);
  } catch (err) {
    status.fail('Gunung api', err);
  }
}

refreshEarthquakes();
refreshVolcanoes();
setInterval(refreshEarthquakes, EARTHQUAKE_REFRESH_MS);
setInterval(refreshVolcanoes, VOLCANO_REFRESH_MS);

// Di layar sempit panel menjadi laci yang bisa dibuka/tutup.
const panel = $('#panel');
const toggle = $('#panel-toggle');
function setPanelOpen(open) {
  panel.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
}
function closePanelOnMobile() {
  if (isNarrowScreen()) setPanelOpen(false);
}
toggle.addEventListener('click', () => setPanelOpen(!panel.classList.contains('is-open')));
