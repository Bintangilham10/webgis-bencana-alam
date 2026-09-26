// Font Plus Jakarta Sans (Tokotype, Indonesia); browser hanya mengunduh subset
// huruf yang dipakai halaman (±27 KB untuk Latin).
import '@fontsource-variable/plus-jakarta-sans';
import 'leaflet/dist/leaflet.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/map.css';
import './styles/detail.css';

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
import { icons } from './lib/icons.js';
import { BOUNDARY_COLOR, DEPTH_CLASSES, FAULT_COLOR, PLATE_COLOR, VOLCANO_LEVELS } from './lib/symbology.js';
import { createMap, INDONESIA_BOUNDS } from './map/create-map.js';
import { LegendControl } from './map/legend-control.js';
import { ReadoutControl } from './map/readouts.js';
import { MapToolbar } from './map/toolbar.js';
import { createFreshness } from './ui/freshness.js';
import { createLayerPanel } from './ui/layer-panel.js';
import { createOverview } from './ui/overview.js';
import { createRiskDetail } from './ui/risk-detail.js';
import { createSearch } from './ui/search.js';
import { createSidebar } from './ui/sidebar.js';
import { createTabs } from './ui/tabs.js';

const $ = (selector) => document.querySelector(selector);

const EARTHQUAKE_REFRESH_MS = 60_000;
const VOLCANO_REFRESH_MS = 10 * 60_000;
const HAZARD_OPACITY = 0.65;
const PLACE_ZOOM = 13;

// Ikon untuk elemen statis di index.html (atribut data-icon).
for (const el of document.querySelectorAll('[data-icon]')) el.insertAdjacentHTML('afterbegin', icons[el.dataset.icon]);

// ---------- Panel samping (di HP menjadi lembar bawah) ----------
const sidebar = createSidebar({
  element: $('#sidebar'),
  app: $('.app'),
  handle: $('#sheet-handle'),
  mainView: $('#main-view'),
  detailView: $('#detail-view'),
});
createTabs($('.tabs'), {
  onChange() {
    $('#main-scroll').scrollTop = 0;
    sidebar.expand();
  },
});

// ---------- Peta dan kontrolnya ----------
const { map, basemaps } = createMap($('#map'));

// Ruang peta yang tertutup bilah alat (kanan) atau lembar bawah (HP), supaya
// titik dan label jarak tidak tersembunyi saat peta membidik hasil. `detail`
// = hasil akan dibuka di panel detail (lembar bawah diperluas di HP).
function viewPadding({ detail = false } = {}) {
  const forResult = detail || sidebar.isDetailOpen();
  if (sidebar.isMobile()) {
    const covered = sidebar.coveredHeight(forResult ? { expanded: true } : {});
    // Saat menampilkan seluruh Indonesia, bilah alat boleh menutupi tepi peta
    // supaya peta tidak mengecil di layar sempit.
    return { paddingTopLeft: [8, 8], paddingBottomRight: [forResult ? 68 : 8, covered + 8] };
  }
  return { paddingTopLeft: [40, 40], paddingBottomRight: [84, 40] };
}

const legend = new LegendControl().addTo(map);
new ReadoutControl().addTo(map);
// Di HP seluruh Indonesia ditampilkan di atas lembar bawah yang terlipat.
if (sidebar.isMobile()) map.fitBounds(INDONESIA_BOUNDS, viewPadding());

// ---------- Cek risiko: pencarian, lokasi saya, dan pilih titik ----------
const riskDetail = createRiskDetail($('#detail-view'), {
  sidebar,
  onClose: () => risk.clear(),
  onFit: () => risk.fitToResult(),
  onRetry: () => risk.retry(),
});
const toolbar = new MapToolbar({
  basemaps,
  onHome: () => map.fitBounds(INDONESIA_BOUNDS, viewPadding()),
  onLocate: locateUser,
  onPick: togglePicking,
}).addTo(map);
const ctaPick = $('[data-action="pick"]');
const risk = createRiskCheck({
  map,
  card: riskDetail,
  viewPadding,
  onPickingChange(active) {
    toolbar.setPicking(active);
    ctaPick.setAttribute('aria-pressed', String(active));
  },
});

// Di HP lembar bawah dikecilkan dulu supaya peta terlihat saat memilih titik.
function togglePicking() {
  sidebar.collapse();
  risk.togglePicking();
}

createSearch($('#search'), {
  onSelect(place) {
    const target = L.latLng(place.lat, place.lon);
    map.fitBounds(place.bounds ?? target.toBounds(2_000), { maxZoom: PLACE_ZOOM, ...viewPadding({ detail: true }) });
    risk.check(target, { label: place.name });
  },
});

$('#panel-ikhtisar').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'locate') locateUser();
  else if (action === 'pick') togglePicking();
});

function locateUser() {
  if (!navigator.geolocation) {
    riskDetail.showMessage('Browser ini tidak mendukung penentuan lokasi. Cari lokasi secara manual.');
    return;
  }
  riskDetail.showMessage('Mencari lokasi Anda…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const here = L.latLng(coords.latitude, coords.longitude);
      map.fitBounds(here.toBounds(Math.max(coords.accuracy * 2, 1_500)), { maxZoom: PLACE_ZOOM, ...viewPadding({ detail: true }) });
      risk.check(here, { label: 'Lokasi Anda', accuracyM: coords.accuracy });
    },
    (err) =>
      riskDetail.showMessage(
        err.code === err.PERMISSION_DENIED
          ? 'Izin lokasi ditolak. Izinkan akses lokasi di browser, atau cari lokasi secara manual.'
          : 'Lokasi tidak dapat ditentukan. Coba lagi atau cari lokasi secara manual.',
      ),
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  );
}

// ---------- Lapisan ----------
const freshness = createFreshness($('#freshness'));
const earthquakes = createEarthquakeLayer(map);
const volcanoes = createVolcanoLayer(map);
const reportLoadError = (name) => (err) => freshness.fail(name, err);

const symbol = {
  quake: `<span class="sym sym-circle" style="--sym:${DEPTH_CLASSES[0].color}"></span>`,
  volcano: `<span class="sym sym-triangle" style="--sym:${VOLCANO_LEVELS[3].color}"></span>`,
  fault: `<span class="sym sym-line" style="--sym:${FAULT_COLOR}"></span>`,
  plate: `<span class="sym sym-line sym-line--thick" style="--sym:${PLATE_COLOR}"></span>`,
  boundary: `<span class="sym sym-line sym-line--thin" style="--sym:${BOUNDARY_COLOR}"></span>`,
};

createLayerPanel({
  map,
  container: $('#layer-controls'),
  legend,
  groups: [
    {
      id: 'kejadian',
      title: 'Kejadian & status',
      items: [
        {
          label: 'Gempa BMKG',
          description: '7 hari terakhir · diperbarui tiap menit',
          legendTitle: 'Gempa BMKG (7 hari)',
          symbol: symbol.quake,
          layer: earthquakes.layer,
          legend: earthquakeLegend,
          on: true,
        },
        {
          label: 'Status gunung api',
          description: 'PVMBG — MAGMA · diperbarui tiap 30 menit',
          legendTitle: 'Status gunung api (PVMBG)',
          symbol: symbol.volcano,
          layer: volcanoes.layer,
          legend: volcanoLegend,
          on: true,
        },
      ],
    },
    {
      id: 'bahaya',
      title: 'Peta rawan bencana',
      note: 'InaRISK BNPB',
      description: 'Satu peta rawan ditampilkan sekaligus supaya warnanya tidak saling menutupi.',
      exclusive: true,
      opacity: HAZARD_OPACITY,
      items: HAZARDS.map((hazard) => ({
        label: hazard.label.replace(/\s*\(.*\)$/, ''),
        legendTitle: `Indeks bahaya ${hazard.label.toLowerCase()}`,
        layer: createHazardLayer(hazard, HAZARD_OPACITY),
        legend: hazardLegend,
      })),
    },
    {
      id: 'geologi',
      title: 'Geologi & wilayah',
      items: [
        {
          label: 'Sesar aktif',
          description: 'PuSGeN 2024 · 401 segmen',
          symbol: symbol.fault,
          layer: createFaultLayer(reportLoadError('Sesar')),
          legend: faultLegend,
          on: true,
        },
        {
          label: 'Batas lempeng tektonik',
          description: 'Bird (2003)',
          symbol: symbol.plate,
          layer: createPlateLayer(reportLoadError('Lempeng')),
          legend: plateLegend,
          on: true,
        },
        {
          label: 'Batas kabupaten/kota',
          description: 'Kepmendagri 2025 · 514 wilayah',
          symbol: symbol.boundary,
          layer: createBoundaryLayer(reportLoadError('Batas wilayah')),
          legend: boundaryLegend,
        },
      ],
    },
  ],
});

// ---------- Ikhtisar & pembaruan data berkala ----------
const overview = createOverview({
  stats: {
    quakes24h: $('#stat-quakes-24h'),
    quakes24hSub: $('#stat-quakes-24h-sub'),
    quakesM5: $('#stat-quakes-m5'),
    volcanoes: $('#stat-volcanoes'),
    volcanoesSub: $('#stat-volcanoes-sub'),
  },
  quakeList: $('#quake-list'),
  volcanoList: $('#volcano-alerts'),
  onSelectQuake(id) {
    sidebar.collapse();
    earthquakes.focus(id);
  },
  onSelectVolcano(kode) {
    sidebar.collapse();
    volcanoes.focus(kode);
  },
});

async function refreshEarthquakes() {
  try {
    const collection = await earthquakes.load();
    overview.renderQuakes(collection);
    freshness.ok('Gempa', collection.meta.synced_at);
  } catch (err) {
    overview.showError($('#quake-list'), 'Data gempa gagal dimuat. Dicoba lagi otomatis tiap menit.');
    freshness.fail('Gempa', err);
  }
}

async function refreshVolcanoes() {
  try {
    const collection = await volcanoes.load();
    overview.renderVolcanoes(collection);
    freshness.ok('Gunung api', collection.meta.synced_at);
  } catch (err) {
    overview.showError($('#volcano-alerts'), 'Status gunung api gagal dimuat.');
    freshness.fail('Gunung api', err);
  }
}

refreshEarthquakes();
refreshVolcanoes();
setInterval(refreshEarthquakes, EARTHQUAKE_REFRESH_MS);
setInterval(refreshVolcanoes, VOLCANO_REFRESH_MS);
