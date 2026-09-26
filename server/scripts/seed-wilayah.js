import { withTransaction } from '../src/db.js';
import { loadRaw } from './raw-cache.js';

// Batas administrasi Kepmendagri No 300.2.2-2430 Tahun 2025 (MIT, cahyadsn).
const BASE_URL = 'https://raw.githubusercontent.com/cahyadsn/wilayah_boundaries/main/db';
const PROVINCE_FILE_COUNT = 8;
const EXPECTED_KABKOTA = 514;

// Baris data: ('32.73','Kota Bandung',-6.91,107.61,'[[[lat,lng],...]]').
// Sebagian file memakai spasi setelah koma (mis. Kalimantan Selatan).
const ROW = /\('([\d.]+)',\s*'((?:[^']|'')*)',\s*(-?[\d.]+),\s*(-?[\d.]+),\s*'(\[[^']*\])'/g;

export function parseBoundarySql(sql) {
  return [...sql.matchAll(ROW)].map(([, kode, nama, , , path]) => ({
    kode,
    nama: nama.replaceAll("''", "'"),
    rings: toRings(JSON.parse(path)),
  }));
}

// Sumber menyimpan cincin poligon sebagai larik titik [lat, lng]. Susunan
// larik tidak membedakan pulau dan lubang (enclave), jadi semua cincin
// dikumpulkan dan poligon disusun ulang di database (lihat UPSERT).
export function toRings(path) {
  const rings = [];
  const seen = new Set();
  (function collect(node) {
    if (typeof node[0]?.[0] === 'number') {
      const ring = node.map(([lat, lng]) => [lng, lat]);
      const [first, last] = [ring[0], ring.at(-1)];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
      const key = JSON.stringify(ring);
      // Cincin kembar akan saling meniadakan di ST_BuildArea, jadi dibuang.
      if (ring.length >= 4 && !seen.has(key)) {
        seen.add(key);
        rings.push(ring);
      }
      return;
    }
    node.forEach(collect);
  })(path);
  return rings;
}

// ST_Node memecah cincin yang memotong dirinya sendiri (mis. Rokan Hulu),
// lalu ST_BuildArea menyusun poligon: cincin di dalam cincin lain menjadi
// lubang, sehingga enclave seperti Kota Bogor tidak ikut masuk Kabupaten Bogor.
const UPSERT = `
  WITH area AS (
    SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
      ST_BuildArea(ST_Node(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)))), 3)) AS geom
  )
  INSERT INTO wilayah (kode, nama, tingkat, induk_kode, titik, geom)
  SELECT $1, $2, $3, $4, ST_PointOnSurface(geom), geom FROM area
  ON CONFLICT (kode) DO UPDATE SET
    nama = EXCLUDED.nama, tingkat = EXCLUDED.tingkat, induk_kode = EXCLUDED.induk_kode,
    titik = EXCLUDED.titik, geom = EXCLUDED.geom`;

async function upsertAll(client, rows, levelOf, parentOf) {
  for (const row of rows) {
    const lines = JSON.stringify({ type: 'MultiLineString', coordinates: row.rings });
    try {
      await client.query(UPSERT, [row.kode, row.nama, levelOf(row), parentOf(row), lines]);
    } catch (err) {
      throw new Error(`Gagal menyimpan ${row.kode} ${row.nama}: ${err.message}`, { cause: err });
    }
  }
}

export async function seedWilayah() {
  const provinces = [];
  for (let i = 1; i <= PROVINCE_FILE_COUNT; i++) {
    const name = `wilayah/prov_${i}.sql`;
    provinces.push(...parseBoundarySql(await loadRaw(name, `${BASE_URL}/prov/wilayah_boundaries_prov_${i}.sql`)));
  }

  const kabkota = [];
  for (const { kode } of provinces) {
    const name = `wilayah/kab_${kode}.sql`;
    kabkota.push(...parseBoundarySql(await loadRaw(name, `${BASE_URL}/kab/wilayah_boundaries_kab_${kode}.sql`)));
  }
  if (kabkota.length !== EXPECTED_KABKOTA) {
    console.warn(`Peringatan: ${kabkota.length} kab/kota terbaca, seharusnya ${EXPECTED_KABKOTA}`);
  }

  await withTransaction(async (client) => {
    await upsertAll(client, provinces, () => 'provinsi', () => null);
    await upsertAll(
      client,
      kabkota,
      (row) => (row.nama.startsWith('Kota ') ? 'kota' : 'kabupaten'),
      (row) => row.kode.slice(0, 2),
    );
  });
  return provinces.length + kabkota.length;
}
