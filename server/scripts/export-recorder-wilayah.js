import { mkdir, writeFile } from 'node:fs/promises';
import { pool, query } from '../src/db.js';
import { rainPoint } from '../src/risk/outlook.js';

// Perekam (recorder/) berjalan di GitHub Actions tanpa akses database, jadi
// data rujukannya diekspor sebagai file statis:
// - wilayah.json: kab/kota beserta satu titik di dalam wilayahnya, untuk merekam
//   prakiraan PVMBG dan ensemble hujan serta mencocokkan nama wilayah CEWS/berita;
// - titik-pantau.json: titik pantau indikasi SIGAP beserta kelas bahayanya (hasil
//   npm run seed -- bahaya), untuk arsip indikasi tiap siklus model. Jalankan ulang
//   setelah seed bahaya supaya perekam memakai titik yang sama dengan server.
const DATA_DIR = new URL('../../recorder/data/', import.meta.url);

// Satu baris per entri supaya diff git mudah dibaca.
const jsonLines = (rows) => `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;

try {
  const { rows: wilayah } = await query(
    `SELECT k.kode, k.nama, k.tingkat, p.nama AS provinsi,
            round(ST_Y(k.titik)::numeric, 4)::float8 AS lat,
            round(ST_X(k.titik)::numeric, 4)::float8 AS lon
     FROM wilayah k JOIN wilayah p ON p.kode = k.induk_kode
     WHERE k.tingkat <> 'provinsi'
     ORDER BY k.kode`,
  );
  // Koordinat dibulatkan dengan fungsi yang sama dengan job indikasi server
  // (rainPoint, 3 desimal), jadi perekam meminta hujan di titik yang persis sama.
  const { rows } = await query(
    `SELECT kode, hazard, urutan, kelas, ST_Y(geom)::float8 AS lat, ST_X(geom)::float8 AS lon
     FROM titik_pantau
     ORDER BY kode, hazard, urutan`,
  );
  const titik = rows.map(({ lat, lon, ...point }) => {
    const rounded = rainPoint(lat, lon);
    return { ...point, lat: rounded.lat, lon: rounded.lon };
  });
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(new URL('wilayah.json', DATA_DIR), jsonLines(wilayah));
  await writeFile(new URL('titik-pantau.json', DATA_DIR), jsonLines(titik));
  console.log(`${wilayah.length} kab/kota → recorder/data/wilayah.json`);
  console.log(`${titik.length} titik pantau → recorder/data/titik-pantau.json`);
} finally {
  await pool.end();
}
