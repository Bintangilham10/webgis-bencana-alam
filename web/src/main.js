// Hanya reset dasar dan utility class Bootstrap: halaman harus tetap ringan
// untuk HP dengan sinyal lemah di daerah bencana.
import 'bootstrap/dist/css/bootstrap-reboot.min.css';
import 'bootstrap/dist/css/bootstrap-utilities.min.css';
import 'leaflet/dist/leaflet.css';
import './styles.css';

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
import { createLayerPanel } from './ui/layer-panel.js';
import { createSyncStatus, renderEarthquakeSummary, renderVolcanoSummary } from './ui/summary.js';

const $ = (selector) => document.querySelector(selector);

const EARTHQUAKE_REFRESH_MS = 60_000;
const VOLCANO_REFRESH_MS = 10 * 60_000;
const HAZARD_OPACITY = 0.65;

const map = createMap($('#map'));
showCoordinates(map, $('#coordinates'));
showScale(map, $('#scale-readout'));

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
  if (window.matchMedia('(max-width: 767.98px)').matches) setPanelOpen(false);
}
toggle.addEventListener('click', () => setPanelOpen(!panel.classList.contains('is-open')));
