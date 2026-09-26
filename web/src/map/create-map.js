import L from 'leaflet';

export const INDONESIA_BOUNDS = L.latLngBounds([-11.2, 94.7], [6.3, 141.1]);

// Popup yang digeser otomatis ke dalam layar tidak boleh tertutup bilah alat
// di kanan peta.
L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(24, 24), autoPanPaddingBottomRight: L.point(76, 24) });

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services';
// Gambar mini pemilih peta dasar: tile zoom 5 yang menampilkan Jawa bagian barat.
const THUMB = { z: 5, x: 25, y: 16 };

// Peta umum, relief (peta timbul digital), dan citra satelit (raster) sesuai
// klasifikasi peta di Modul 2. Semua tanpa API key (CARTO kini mewajibkannya).
// Abu-abu netral dipakai bawaan supaya warna layer tematik lebih menonjol;
// labelnya di pane terpisah agar tetap terbaca di atas raster bahaya.
function createBasemaps() {
  const gray = { maxNativeZoom: 16, maxZoom: 19 };
  const esriThumb = (service) => `${ESRI_TILES}/${service}/MapServer/tile/${THUMB.z}/${THUMB.y}/${THUMB.x}`;
  return [
    {
      id: 'abu',
      name: 'Abu-abu',
      thumbnail: esriThumb('Canvas/World_Light_Gray_Base'),
      layer: L.layerGroup([
        L.tileLayer(`${ESRI_TILES}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
          ...gray,
          attribution: `Peta dasar &copy; Esri, HERE, Garmin, ${OSM_ATTRIBUTION}`,
        }),
        L.tileLayer(`${ESRI_TILES}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { ...gray, pane: 'labels' }),
      ]),
    },
    {
      id: 'hot',
      name: 'Kemanusiaan (HOT)',
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
      thumbnail: `https://tile.openstreetmap.org/${THUMB.z}/${THUMB.x}/${THUMB.y}.png`,
      layer: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: OSM_ATTRIBUTION, maxZoom: 19 }),
    },
    {
      id: 'topo',
      name: 'Relief (topografi)',
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
      thumbnail: esriThumb('World_Imagery'),
      layer: L.tileLayer(`${ESRI_TILES}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
        attribution: 'Citra &copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      }),
    },
  ];
}

// Pada Web Mercator utara selalu tepat di atas peta.
const NorthArrow = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const el = L.DomUtil.create('div', 'north-arrow');
    el.title = 'Arah utara';
    el.innerHTML =
      '<svg viewBox="0 0 16 24" aria-hidden="true"><path d="M8 1 14 19 8 15.5 2 19z" fill="#111c2a"/>' +
      '<path d="M8 1v14.5L2 19z" fill="#fff" stroke="#111c2a" stroke-width="1" stroke-linejoin="round"/></svg><span>U</span>';
    return el;
  },
});

// Urutan tumpukan layer (bawaan Leaflet: tile 200, overlay 400, marker 600).
// Raster bahaya di bawah garis, batas wilayah di bawah sesar, label peta dasar
// di atas raster, titik gempa di atas garis supaya tetap bisa diklik, dan hasil
// analisis cek risiko di atas gempa.
const PANES = { hazard: 250, boundaries: 350, labels: 420, quakes: 450, analysis: 460 };

// Tombol zoom dan pemilih peta dasar ada di bilah alat (map/toolbar.js).
export function createMap(element) {
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

  const basemaps = createBasemaps();
  basemaps[0].layer.addTo(map);
  basemaps[0].active = true;
  new NorthArrow().addTo(map);
  L.control.scale({ metric: true, imperial: false, position: 'bottomright' }).addTo(map);
  return { map, basemaps };
}
