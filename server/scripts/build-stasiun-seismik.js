import { mkdir, writeFile } from 'node:fs/promises';
import { fetchText } from '../src/lib/http.js';

// Stasiun seismograf jaringan internasional yang terpasang di Indonesia, ditulis
// sebagai file statis untuk frontend (web/public/data/stasiun-seismik.geojson):
// - GE: jaringan GEOFON milik GFZ (Jerman), dioperasikan bersama BMKG;
// - II: Global Seismographic Network (IRIS/IDA, Amerika Serikat).
// Sumber: layanan FDSN station milik GEOFON dan EarthScope. Jalankan ulang bila
// ada stasiun baru: npm run build:seismik
const REGION = 'minlatitude=-12&maxlatitude=7&minlongitude=94&maxlongitude=142';
const SOURCES = [
  {
    url: `https://geofon.gfz.de/fdsnws/station/1/query?network=GE&${REGION}&level=station&format=text`,
    network: 'GE',
    jaringan: 'GEOFON',
    pengelola: 'GFZ (Jerman) bersama BMKG',
    // Rekaman getaran stasiun GE di Indonesia tidak dibuka untuk umum (uji 11 Nov 2026: HTTP 403).
    data_terbuka: false,
  },
  {
    url: `https://service.iris.edu/fdsnws/station/1/query?network=II&${REGION}&level=station&format=text`,
    network: 'II',
    jaringan: 'Global Seismographic Network (IRIS/IDA)',
    pengelola: 'Scripps Institution of Oceanography (Amerika Serikat) bersama BMKG',
    data_terbuka: true,
  },
];
const OUTPUT = new URL('../../web/public/data/stasiun-seismik.geojson', import.meta.url);

// Nama tempat berbahasa Inggris di daftar stasiun → nama Indonesia.
const PLACES = { Java: 'Jawa', Sumatra: 'Sumatera', Moluccas: 'Maluku', 'Irian Jaya': 'Papua' };
// Daftar GEOFON menulis stasiun LUWI (Luwuk, Sulawesi) sebagai "Lhokseumave".
const NAME_FIXES = { LUWI: 'Luwuk, Sulawesi' };

function siteName(code, raw) {
  if (NAME_FIXES[code]) return NAME_FIXES[code];
  let name = raw.replace(/^(?:BMKG\/)?GEOFON Station\s+/i, '').replace(/,?\s*Indonesia$/i, '').replace('Lhokseumave', 'Lhokseumawe');
  for (const [english, indonesian] of Object.entries(PLACES)) name = name.replace(english, indonesian);
  return name.trim();
}

// Baris teks FDSN: Network|Station|Latitude|Longitude|Elevation|SiteName|StartTime|EndTime.
// Yang diambil hanya stasiun di Indonesia yang masih aktif (EndTime kosong atau di masa depan).
function parseStations(text, source, now) {
  return text
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter(([, , , , , site, , end]) => /Indonesia/i.test(site) && (!end || Date.parse(end) > now))
    .map(([, code, lat, lon, elevation, site, start]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(Number(lon).toFixed(4)), Number(Number(lat).toFixed(4))] },
      properties: {
        kode: `${source.network}.${code}`,
        nama: siteName(code, site),
        jaringan: source.jaringan,
        pengelola: source.pengelola,
        sejak: Number(start.slice(0, 4)),
        elevasi_m: Number(elevation),
        data_terbuka: source.data_terbuka,
      },
    }));
}

const now = Date.now();
const features = [];
for (const source of SOURCES) features.push(...parseStations(await fetchText(source.url, { timeoutMs: 60_000 }), source, now));
// Epoch lama stasiun yang sama (alat diganti) muncul sebagai baris terpisah; yang dipakai yang terbaru.
const latest = new Map();
for (const feature of features) {
  const seen = latest.get(feature.properties.kode);
  if (!seen || feature.properties.sejak >= seen.properties.sejak) latest.set(feature.properties.kode, feature);
}
const stations = [...latest.values()].sort((a, b) => a.properties.kode.localeCompare(b.properties.kode));

await mkdir(new URL('.', OUTPUT), { recursive: true });
await writeFile(
  OUTPUT,
  `${JSON.stringify({
    type: 'FeatureCollection',
    attribution: 'Stasiun seismograf: GEOFON (GFZ) dan Global Seismographic Network (IRIS/IDA) lewat layanan FDSN',
    features: stations,
  })}\n`,
);
console.log(`${stations.length} stasiun → web/public/data/stasiun-seismik.geojson`);
for (const { properties: p } of stations) console.log(`  ${p.kode.padEnd(8)} ${p.nama} (sejak ${p.sejak})`);
