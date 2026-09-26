import { mkdir, writeFile } from 'node:fs/promises';
import { loadRaw } from './raw-cache.js';

// Batas lempeng PB2002 (Bird, 2003; konversi Ahlenius/Nordpil, ODC-By) dipotong
// ke kawasan Indonesia dan ditulis sebagai file statis untuk frontend.
const SOURCE_URL = 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json';
const OUTPUT = new URL('../../web/public/data/plates.geojson', import.meta.url);
const REGION = { west: 88, south: -16, east: 146, north: 13 };

const PLATE_NAMES = {
  AU: 'Australia', BH: 'Kepala Burung', BS: 'Laut Banda', BU: 'Burma', CL: 'Caroline',
  IN: 'India', MA: 'Mariana', MO: 'Maoke', MS: 'Laut Maluku', NB: 'Bismarck Utara',
  PA: 'Pasifik', PS: 'Laut Filipina', SB: 'Bismarck Selatan', SU: 'Sunda', TI: 'Timor', WL: 'Woodlark',
};

const inRegion = ([lon, lat]) =>
  lon >= REGION.west && lon <= REGION.east && lat >= REGION.south && lat <= REGION.north;
const round = (n) => Math.round(n * 1000) / 1000;

const { features } = JSON.parse(await loadRaw('pb2002_boundaries.json', SOURCE_URL));
const plates = features
  .filter((f) => f.geometry.type === 'LineString' && f.geometry.coordinates.some(inRegion))
  .map(({ properties: p, geometry }) => ({
    type: 'Feature',
    properties: {
      nama: `${PLATE_NAMES[p.PlateA] ?? p.PlateA} – ${PLATE_NAMES[p.PlateB] ?? p.PlateB}`,
      subduksi: p.Type === 'subduction',
    },
    geometry: { type: 'LineString', coordinates: geometry.coordinates.map(([lon, lat]) => [round(lon), round(lat)]) },
  }));

await mkdir(new URL('.', OUTPUT), { recursive: true });
await writeFile(
  OUTPUT,
  `${JSON.stringify({
    type: 'FeatureCollection',
    attribution: 'Batas lempeng: Bird (2003) PB2002, konversi H. Ahlenius/Nordpil (ODC-By)',
    features: plates,
  })}\n`,
);
console.log(`${plates.length} segmen batas lempeng ditulis ke ${OUTPUT.pathname}`);
