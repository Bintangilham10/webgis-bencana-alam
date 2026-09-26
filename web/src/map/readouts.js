import L from 'leaflet';
import proj4 from 'proj4';
import { formatNumber } from '../lib/format.js';

// Koordinat kursor dalam tiga sistem dari Modul 4: geografis (WGS84),
// proyeksi UTM (zona dihitung otomatis), dan Web Mercator (EPSG:3857).
export function toUtm(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const south = lat < 0;
  const utm = `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
  const [easting, northing] = proj4('EPSG:4326', utm, [lon, lat]);
  return { zone: `${zone}${south ? 'S' : 'N'}`, easting, northing };
}

// Klasifikasi skala peta dari Modul 2 (Pertemuan 2).
const SCALE_CLASSES = [
  { max: 5_000, label: 'kadaster' },
  { max: 250_000, label: 'skala besar' },
  { max: 500_000, label: 'skala sedang' },
  { max: 1_000_000, label: 'skala kecil' },
  { max: Infinity, label: 'peta geografis' },
];

// Resolusi Web Mercator di ekuator pada zoom 0 (m/piksel), dan ukuran piksel
// standar OGC 0,28 mm untuk mengubah resolusi layar menjadi angka skala.
const METERS_PER_PIXEL_Z0 = 156_543.03392;
const OGC_PIXEL_SIZE_M = 0.00028;

export function scaleDenominator(lat, zoom) {
  return (METERS_PER_PIXEL_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom / OGC_PIXEL_SIZE_M;
}

// Kotak kecil di kanan bawah peta: koordinat kursor (atau pusat peta di layar
// sentuh) dan angka skala 1:n beserta klasnya. Koordinat memakai titik desimal
// (konvensi GIS) supaya tidak rancu dengan koma pemisah lintang/bujur.
export const ReadoutControl = L.Control.extend({
  options: { position: 'bottomright' },

  onAdd(map) {
    const el = L.DomUtil.create('div', 'map-readout');
    el.innerHTML = '<span class="readout-geo"></span><span class="readout-proj"></span><span class="readout-scale"></span>';
    const geo = el.querySelector('.readout-geo');
    const proj = el.querySelector('.readout-proj');
    const scale = el.querySelector('.readout-scale');

    const showCoordinates = (latlng) => {
      const { lat, lng } = latlng;
      const utm = toUtm(lat, lng);
      const mercator = map.options.crs.project(latlng);
      geo.textContent = `WGS84 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      proj.textContent =
        `UTM ${utm.zone} ${Math.round(utm.easting)} E ${Math.round(utm.northing)} N · ` +
        `EPSG:3857 ${Math.round(mercator.x)}, ${Math.round(mercator.y)}`;
    };
    const showScale = () => {
      const denominator = scaleDenominator(map.getCenter().lat, map.getZoom());
      const { label } = SCALE_CLASSES.find((c) => denominator <= c.max);
      scale.textContent = `Skala ≈ 1:${formatNumber(Number(denominator.toPrecision(2)))} (${label})`;
    };

    this._onMove = (event) => showCoordinates(event.latlng);
    this._onMoveEnd = () => {
      showCoordinates(map.getCenter());
      showScale();
    };
    map.on('mousemove', this._onMove);
    map.on('moveend zoomend', this._onMoveEnd);
    this._onMoveEnd();
    return el;
  },

  onRemove(map) {
    map.off('mousemove', this._onMove);
    map.off('moveend zoomend', this._onMoveEnd);
  },
});
