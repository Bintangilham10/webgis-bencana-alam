import { mkdir, writeFile } from 'node:fs/promises';
import { pool, query } from '../src/db.js';

// Perekam (recorder/) berjalan di GitHub Actions tanpa akses database, jadi
// daftar kab/kota beserta satu titik di dalam wilayahnya diekspor sebagai file
// statis. Dipakai untuk merekam prakiraan PVMBG, ensemble hujan, dan
// mencocokkan nama wilayah di data CEWS dan berita.
const OUTPUT = new URL('../../recorder/data/wilayah.json', import.meta.url);

try {
  const { rows } = await query(
    `SELECT k.kode, k.nama, k.tingkat, p.nama AS provinsi,
            round(ST_Y(k.titik)::numeric, 4)::float8 AS lat,
            round(ST_X(k.titik)::numeric, 4)::float8 AS lon
     FROM wilayah k JOIN wilayah p ON p.kode = k.induk_kode
     WHERE k.tingkat <> 'provinsi'
     ORDER BY k.kode`,
  );
  await mkdir(new URL('.', OUTPUT), { recursive: true });
  // Satu wilayah per baris supaya diff git mudah dibaca.
  await writeFile(OUTPUT, `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
  console.log(`${rows.length} kab/kota ditulis ke recorder/data/wilayah.json`);
} finally {
  await pool.end();
}
