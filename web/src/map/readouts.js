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

export function showCoordinates(map, element) {
  const update = (latlng) => {
    const { lat, lng } = latlng;
    const utm = toUtm(lat, lng);
    const mercator = map.options.crs.project(latlng);
    element.textContent =
      `WGS84 ${lat.toFixed(5)}, ${lng.toFixed(5)} | ` +
      `UTM ${utm.zone} ${Math.round(utm.easting)} E ${Math.round(utm.northing)} N | ` +
      `EPSG:3857 ${Math.round(mercator.x)}, ${Math.round(mercator.y)}`;
  };
  map.on('mousemove', (e) => update(e.latlng));
  // Di layar sentuh tidak ada kursor, jadi tampilkan koordinat pusat peta.
  map.on('moveend', () => update(map.getCenter()));
  update(map.getCenter());
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

export function showScale(map, element) {
  const update = () => {
    const denominator = scaleDenominator(map.getCenter().lat, map.getZoom());
    const rounded = Number(denominator.toPrecision(2));
    const { label } = SCALE_CLASSES.find((c) => denominator <= c.max);
    element.textContent = `Skala ≈ 1:${formatNumber(rounded)} (${label})`;
  };
  map.on('zoomend moveend', update);
  update();
}
