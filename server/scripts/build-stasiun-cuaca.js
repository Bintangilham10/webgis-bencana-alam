import { mkdir, writeFile } from 'node:fs/promises';
import { pool, query } from '../src/db.js';
import { fetchJson } from '../src/lib/http.js';

// Daftar stasiun cuaca sinoptik Indonesia untuk lapisan "Hujan terukur" dan riset,
// ditulis sebagai file statis server/data/stasiun-cuaca.json:
// - nama, koordinat, dan elevasi dari daftar stasiun resmi WMO (OSCAR/Surface),
//   yang diisi BMKG; hanya stasiun bernomor WMO lima angka (blok 96 dan 97),
//   karena nomor itulah yang dipakai laporan SYNOP;
// - kode bandara ICAO dari NOAA Aviation Weather Center, untuk menggabungkan
//   laporan cuaca bandara (METAR) dengan stasiunnya;
// - kab/kota dari batas wilayah di database SIGAP.
// Jalankan ulang bila BMKG menambah atau memindahkan stasiun: npm run build:stasiun
const OSCAR_URL = 'https://oscar.wmo.int/surface/rest/api/search/station?territoryName=IDN';
const AWC_URL = 'https://aviationweather.gov/api/data/stationinfo?bbox=-12,94,7,142&format=json';
const OUTPUT = new URL('../data/stasiun-cuaca.json', import.meta.url);

// Stasiun di dermaga atau pulau kecil bisa jatuh sedikit di luar poligon kab/kota.
const NEAR_METERS = 5_000;
const WILAYAH = `
  SELECT k.kode, k.nama, p.nama AS provinsi
  FROM wilayah k JOIN wilayah p ON p.kode = k.induk_kode
  WHERE k.tingkat <> 'provinsi'
    AND ST_DWithin(k.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
  ORDER BY ST_Distance(k.geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
  LIMIT 1`;

// "MAROS/SULTAN HASANUDDIN" → "Sultan Hasanuddin"; nama tanpa "/" dipakai utuh.
// Angka Romawi dan inisial di awal nama tetap huruf besar ("Sultan Syarif Kasim II",
// "F.L. Tobing", "H.AS. Hanandjoeddin"); singkatan di tengah tidak ("Bawean Is.").
const titleCase = (text) =>
  text
    .toLowerCase()
    .replace(/(^|[\s/(-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/\b(?:Ii|Iii|Iv|Vi|Vii|Viii|Ix)\b/g, (roman) => roman.toUpperCase())
    .replace(/^(?:\p{L}{1,2}\.)+/u, (initials) => initials.toUpperCase());
const stationName = (name) => titleCase(name.includes('/') ? name.slice(name.indexOf('/') + 1) : name).trim();
const round = (value, digits) => Number(Number(value).toFixed(digits));

// Satu baris per stasiun supaya diff git mudah dibaca.
const jsonLines = (rows) => `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;

try {
  const [oscar, awc] = await Promise.all([fetchJson(OSCAR_URL, { timeoutMs: 60_000 }), fetchJson(AWC_URL, { timeoutMs: 60_000 })]);
  const icaoByWmo = new Map(awc.filter((s) => s.country === 'ID' && s.wmoId).map((s) => [String(s.wmoId), s.icaoId]));

  const stations = [];
  for (const s of oscar.stationSearchResults ?? []) {
    const wmo = /^0-20000-0-(9[67]\d{3})$/.exec(s.wigosId ?? '')?.[1];
    if (!wmo || ![s.latitude, s.longitude].every(Number.isFinite)) continue;
    const lat = round(s.latitude, 4);
    const lon = round(s.longitude, 4);
    const { rows } = await query(WILAYAH, [lon, lat, NEAR_METERS]);
    stations.push({
      wmo,
      nama: stationName(s.name),
      nama_wmo: s.name,
      icao: icaoByWmo.get(wmo) ?? null,
      lat,
      lon,
      elevasi_m: Number.isFinite(s.elevation) ? round(s.elevation, 1) : null,
      kode: rows[0]?.kode ?? null,
      wilayah: rows[0]?.nama ?? null,
      provinsi: rows[0]?.provinsi ?? null,
    });
  }
  stations.sort((a, b) => a.wmo.localeCompare(b.wmo));

  await mkdir(new URL('.', OUTPUT), { recursive: true });
  await writeFile(OUTPUT, jsonLines(stations));
  const tanpaWilayah = stations.filter((s) => !s.kode).map((s) => s.wmo);
  console.log(`${stations.length} stasiun → server/data/stasiun-cuaca.json (${stations.filter((s) => s.icao).length} punya kode ICAO)`);
  if (tanpaWilayah.length) console.log(`Tanpa kab/kota (lebih dari ${NEAR_METERS / 1000} km dari batas): ${tanpaWilayah.join(', ')}`);
} finally {
  await pool.end();
}
