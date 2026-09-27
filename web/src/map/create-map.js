import L from 'leaflet';

export const INDONESIA_BOUNDS = L.latLngBounds([-11.2, 94.7], [6.3, 141.1]);

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services';
// Gambar mini pemilih peta dasar: tile zoom 5 yang menampilkan Jawa bagian barat.
const THUMB = { z: 5, x: 25, y: 16 };

const esriThumb = (service) => `${ESRI_TILES}/${service}/MapServer/tile/${THUMB.z}/${THUMB.y}/${THUMB.x}`;

// Kanvas abu-abu Esri (terang atau gelap). Labelnya di pane terpisah agar tetap
// terbaca di atas raster bahaya.
function canvasBasemap({ id, name, tone, service }) {
  const options = { maxNativeZoom: 16, maxZoom: 19 };
  return {
    id,
    name,
    tone,
    thumbnail: esriThumb(`Canvas/${service}_Base`),
    layer: L.layerGroup([
      L.tileLayer(`${ESRI_TILES}/Canvas/${service}_Base/MapServer/tile/{z}/{y}/{x}`, {
        ...options,
        attribution: `Peta dasar &copy; Esri, HERE, Garmin, ${OSM_ATTRIBUTION}`,
      }),
      L.tileLayer(`${ESRI_TILES}/Canvas/${service}_Reference/MapServer/tile/{z}/{y}/{x}`, { ...options, pane: 'labels' }),
    ]),
  };
}

// Peta umum, relief (peta timbul digital), dan citra satelit (raster) sesuai
// klasifikasi peta di Modul 2. Semua tanpa API key (CARTO kini mewajibkannya).
// Kanvas netral dipakai bawaan supaya warna layer tematik lebih menonjol.
// tone = nada peta dasar (terang/gelap); warna garis dan simbol menyesuaikan.
function createBasemaps() {
  return [
    canvasBasemap({ id: 'kanvas-terang', name: 'Kanvas terang', tone: 'light', service: 'World_Light_Gray' }),
    canvasBasemap({ id: 'kanvas-gelap', name: 'Kanvas gelap', tone: 'dark', service: 'World_Dark_Gray' }),
    {
      id: 'hot',
      name: 'Kemanusiaan (HOT)',
      tone: 'light',
      thumbnail: `https://a.tile.openstreetmap.fr/hot/${THUMB.z}/${THUMB.x}/${THUMB.y}.png`,
      layer: L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        attribution: `${OSM_ATTRIBUTION}, gaya peta <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>`,
        subdomains: 'abc',
        maxZoom: 19,
      }),
    },
    {
      id: 'osm',
      name: 'OpenStreetMap',
      tone: 'light',
      thumbnail: `https://tile.openstreetmap.org/${THUMB.z}/${THUMB.x}/${THUMB.y}.png`,
      layer: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: OSM_ATTRIBUTION, maxZoom: 19 }),
    },
    {
      id: 'topo',
      name: 'Relief (topografi)',
      tone: 'light',
      thumbnail: `https://a.tile.opentopomap.org/${THUMB.z}/${THUMB.x}/${THUMB.y}.png`,
      layer: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: `${OSM_ATTRIBUTION}, SRTM | Gaya peta &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
        subdomains: 'abc',
        maxZoom: 17,
      }),
    },
    {
      id: 'citra',
      name: 'Citra satelit',
      tone: 'dark',
      thumbnail: esriThumb('World_Imagery'),
      layer: L.tileLayer(`${ESRI_TILES}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
        attribution: 'Citra &copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      }),
    },
  ];
}

// Pada Web Mercator utara selalu tepat di atas peta. Warnanya mengikuti tema (CSS).
const NorthArrow = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const el = L.DomUtil.create('div', 'north-arrow glass');
    el.title = 'Arah utara';
    el.innerHTML =
      '<svg viewBox="0 0 16 24" aria-hidden="true"><path class="na-dark" d="M8 1 14 19 8 15.5 2 19z"/>' +
      '<path class="na-light" d="M8 1v14.5L2 19z" stroke-width="1" stroke-linejoin="round"/></svg><span>U</span>';
    return el;
  },
});

// Urutan tumpukan layer (bawaan Leaflet: tile 200, overlay 400, marker 600).
// Raster bahaya di bawah garis, lalu peringatan hujan BMKG dan hujan satelit,
// batas wilayah di bawah sesar, label peta dasar
// di atas raster, titik gempa di atas garis supaya tetap bisa diklik, dan hasil
// analisis cek risiko di atas gempa.
const PANES = { hazard: 250, warnings: 300, boundaries: 350, labels: 420, quakes: 450, analysis: 460 };

// Tombol zoom dan pemilih peta dasar ada di bilah alat (map/toolbar.js).
export function createMap(element, { theme = 'dark' } = {}) {
  // minZoom 3 supaya seluruh Indonesia tetap muat di layar HP (±390 px).
  const map = L.map(element, {
    minZoom: 3,
    maxBounds: INDONESIA_BOUNDS.pad(0.6),
    zoomSnap: 0.5,
    zoomControl: false,
  });
  for (const [name, zIndex] of Object.entries(PANES)) map.createPane(name).style.zIndex = String(zIndex);
  map.getPane('labels').style.pointerEvents = 'none';
  map.fitBounds(INDONESIA_BOUNDS);

  // Peta dasar awal menyesuaikan tema saat halaman dibuka. Setelah itu peta
  // dasar dipilih sendiri lewat bilah alat dan tidak berubah saat tema diganti.
  const basemaps = createBasemaps();
  const initial = basemaps.find((b) => b.id === (theme === 'light' ? 'kanvas-terang' : 'kanvas-gelap'));
  initial.layer.addTo(map);
  initial.active = true;
  // Nada peta dasar dipasang di elemen peta; warna garis rujukan dan simbol
  // (styles/base.css) mengikutinya supaya tetap kontras.
  element.dataset.tone = initial.tone;
  map.on('basemapchange', ({ basemap }) => {
    element.dataset.tone = basemap.tone;
  });
  new NorthArrow().addTo(map);
  L.control.scale({ metric: true, imperial: false, position: 'bottomright' }).addTo(map);
  return { map, basemaps };
}
