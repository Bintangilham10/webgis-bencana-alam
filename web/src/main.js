// Font Plus Jakarta Sans (Tokotype, Indonesia); browser hanya mengunduh subset
// huruf yang dipakai halaman (±27 KB untuk Latin).
import '@fontsource-variable/plus-jakarta-sans';
import 'leaflet/dist/leaflet.css';
import './styles/base.css';
import './styles/motion.css';
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
import { HAZARD_ICONS, icons } from './lib/icons.js';
import { flyToBounds } from './lib/motion.js';
import { DEPTH_CLASSES, volcanoSymbol } from './lib/symbology.js';
import { cssVar, currentTheme, onThemeChange, setTheme } from './lib/theme.js';
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
import { hideSplashWhen } from './ui/splash.js';
import { createTabs } from './ui/tabs.js';

const $ = (selector) => document.querySelector(selector);
const px = (name) => parseFloat(cssVar(name)) || 0;

const EARTHQUAKE_REFRESH_MS = 60_000;
const VOLCANO_REFRESH_MS = 10 * 60_000;
const HAZARD_OPACITY = 0.65;
const PLACE_ZOOM = 13;

// Ikon untuk elemen statis di index.html (atribut data-icon).
for (const el of document.querySelectorAll('[data-icon]')) el.insertAdjacentHTML('afterbegin', icons[el.dataset.icon]);

// ---------- Panel samping (di HP menjadi lembar bawah) ----------
const sidebar = createSidebar({
  element: $('#sidebar'),
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

// Popup yang digeser otomatis ke dalam layar tidak boleh tertutup bilah atas,
// panel samping/lembar bawah, atau bilah alat kanan.
L.Popup.mergeOptions(
  sidebar.isMobile()
    ? { autoPanPaddingTopLeft: L.point(12, px('--topbar-h') + 32), autoPanPaddingBottomRight: L.point(64, px('--sheet-peek') + 16) }
    : { autoPanPaddingTopLeft: L.point(px('--sidebar-w') + 48, px('--topbar-h') + 48), autoPanPaddingBottomRight: L.point(80, 32) },
);

// ---------- Peta dan kontrolnya ----------
const { map, basemaps } = createMap($('#map'), { theme: currentTheme() });

// Peta memenuhi layar dan sebagian tertutup panel melayang. viewPadding()
// menghitung ruang itu supaya hasil yang dibidik tidak tersembunyi. `detail` =
// hasil akan dibuka di panel detail (lembar bawah diperluas di HP).
function viewPadding({ detail = false } = {}) {
  const forResult = detail || sidebar.isDetailOpen();
  // Label jarak menjulur ±30 px di atas titik ujung garis; beri ruang ekstra.
  const top = px('--gap') + px('--topbar-h') + (forResult ? 48 : 16);
  if (sidebar.isMobile()) {
    const covered = sidebar.coveredHeight(forResult ? { expanded: true } : {});
    // Saat menampilkan seluruh Indonesia, bilah alat boleh menutupi tepi peta
    // supaya peta tidak mengecil di layar sempit.
    return { paddingTopLeft: [8, top], paddingBottomRight: [forResult ? 68 : 8, covered + 8] };
  }
  return { paddingTopLeft: [px('--gap') + px('--sidebar-w') + 32, top + 8], paddingBottomRight: [84, 40] };
}

map.fitBounds(INDONESIA_BOUNDS, viewPadding());
const legend = new LegendControl().addTo(map);
new ReadoutControl().addTo(map);

// ---------- Cek risiko: pencarian, lokasi saya, dan pilih titik ----------
const riskDetail = createRiskDetail($('#detail-view'), {
  sidebar,
  onClose: () => risk.clear(),
  onFit: () => risk.fitToResult(),
  onRetry: () => risk.retry(),
});
const toolbar = new MapToolbar({
  basemaps,
  onHome: () => flyToBounds(map, INDONESIA_BOUNDS, viewPadding()),
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
    flyToBounds(map, place.bounds ?? target.toBounds(2_000), { maxZoom: PLACE_ZOOM, ...viewPadding({ detail: true }) });
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
      const area = here.toBounds(Math.max(coords.accuracy * 2, 1_500));
      flyToBounds(map, area, { maxZoom: PLACE_ZOOM, ...viewPadding({ detail: true }) });
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

// ---------- Tema gelap/terang ----------
const themeToggle = $('#theme-toggle');
function labelThemeToggle(theme) {
  const next = theme === 'dark' ? 'terang' : 'gelap';
  themeToggle.setAttribute('aria-label', `Ganti ke mode ${next}`);
  themeToggle.title = `Ganti ke mode ${next}`;
}
labelThemeToggle(currentTheme());
themeToggle.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
onThemeChange((theme) => {
  labelThemeToggle(theme);
  const [canvas] = basemaps;
  canvas.setTheme(theme);
  toolbar.setThumbnail(canvas.id, canvas.thumbnail);
});

// ---------- Lapisan ----------
const freshness = createFreshness($('#freshness'));
const earthquakes = createEarthquakeLayer(map);
const volcanoes = createVolcanoLayer(map);
const reportLoadError = (name) => (err) => freshness.fail(name, err);

const symbol = {
  quake: `<span class="sym sym-circle" style="--sym:${DEPTH_CLASSES[0].color}"></span>`,
  volcano: volcanoSymbol(3),
  fault: '<span class="sym sym-line" style="--sym:var(--fault-color)"></span>',
  plate: '<span class="sym sym-line sym-line--thick" style="--sym:var(--plate-color)"></span>',
  boundary: '<span class="sym sym-line sym-line--thin" style="--sym:var(--boundary-color)"></span>',
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
        icon: HAZARD_ICONS[hazard.id],
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

// Layar pembuka hilang setelah data gempa dan gunung api pertama selesai dimuat.
hideSplashWhen($('#splash'), Promise.allSettled([refreshEarthquakes(), refreshVolcanoes()]));
setInterval(refreshEarthquakes, EARTHQUAKE_REFRESH_MS);
setInterval(refreshVolcanoes, VOLCANO_REFRESH_MS);
