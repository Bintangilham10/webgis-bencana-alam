import L from 'leaflet';

export const INDONESIA_BOUNDS = L.latLngBounds([-11.2, 94.7], [6.3, 141.1]);

// Popup yang digeser otomatis ke dalam layar tidak boleh tertutup tombol zoom
// (kiri atas) atau pemilih peta dasar (kanan atas).
L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(60, 20), autoPanPaddingBottomRight: L.point(60, 20) });

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services';

// Peta umum, relief (peta timbul digital), dan citra satelit (raster) sesuai
// klasifikasi peta di Modul 2. Semua tanpa API key (CARTO kini mewajibkannya).
// Abu-abu netral dipakai bawaan supaya warna layer tematik lebih menonjol;
// labelnya di pane terpisah agar tetap terbaca di atas raster bahaya.
function createBasemaps() {
  const grayOptions = { maxNativeZoom: 16, maxZoom: 19 };
  return {
    'Peta dasar abu-abu (Esri)': L.layerGroup([
      L.tileLayer(`${ESRI_TILES}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
        ...grayOptions,
        attribution: `Peta dasar &copy; Esri, HERE, Garmin, ${OSM_ATTRIBUTION}`,
      }),
      L.tileLayer(`${ESRI_TILES}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, {
        ...grayOptions,
        pane: 'labels',
      }),
    ]),
    'Peta kemanusiaan (HOT)': L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      attribution: `${OSM_ATTRIBUTION}, gaya peta <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>`,
      subdomains: 'abc',
      maxZoom: 19,
    }),
    'Peta umum (OpenStreetMap)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
    }),
    'Relief/topografi (OpenTopoMap)': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: `${OSM_ATTRIBUTION}, SRTM | Gaya peta &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
      subdomains: 'abc',
      maxZoom: 17,
    }),
    'Citra satelit (Esri)': L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Citra &copy; Esri, Maxar, Earthstar Geographics', maxZoom: 19 },
    ),
  };
}

// Pada Web Mercator utara selalu tepat di atas peta.
const NorthArrow = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const el = L.DomUtil.create('div', 'north-arrow');
    el.title = 'Arah utara';
    el.innerHTML =
      '<svg viewBox="0 0 24 36" aria-hidden="true"><path d="M12 2 20 26 12 21 4 26z" fill="#1d2433"/>' +
      '<path d="M12 2 12 21 4 26z" fill="#fff" stroke="#1d2433" stroke-width="1"/></svg><span>U</span>';
    return el;
  },
});

// Urutan tumpukan layer (bawaan Leaflet: tile 200, overlay 400, marker 600).
// Raster bahaya di bawah garis, batas wilayah di bawah sesar, label peta dasar
// di atas raster, titik gempa di atas garis supaya tetap bisa diklik, dan hasil
// analisis cek risiko di atas gempa.
const PANES = { hazard: 250, boundaries: 350, labels: 420, quakes: 450, analysis: 460 };

// Tombol zoom sengaja tidak dibuat di sini: main.js menambahkannya di bawah
// kotak pencarian supaya pencarian berada paling atas.
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
  basemaps['Peta dasar abu-abu (Esri)'].addTo(map);
  L.control.layers(basemaps, null, { position: 'topright', collapsed: true }).addTo(map);
  new NorthArrow().addTo(map);
  L.control.scale({ metric: true, imperial: false, position: 'bottomright' }).addTo(map);
  return map;
}
