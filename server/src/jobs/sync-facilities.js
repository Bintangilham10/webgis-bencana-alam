import { query, withTransaction } from '../db.js';
import { fetchFacilities } from '../sources/overpass.js';

// Data baru yang jauh lebih sedikit dari data lama kemungkinan jawaban Overpass
// yang terpotong, jadi tidak dipakai untuk menggantikan data lama.
const MIN_KEEP_RATIO = 0.8;

const INSERT_FACILITIES = `
  INSERT INTO facilities (id, category, name, tags, geom)
  SELECT f->>'id', f->>'category', f->>'name', f->'tags',
         ST_SetSRID(ST_MakePoint((f->>'lon')::float8, (f->>'lat')::float8), 4326)
  FROM jsonb_array_elements($1::jsonb) AS f
  ON CONFLICT (id) DO NOTHING`;

// fetch dapat diganti saat test supaya tidak memanggil Overpass.
export async function syncFacilities({ fetch = fetchFacilities } = {}) {
  const facilities = await fetch();
  const { rows } = await query('SELECT count(*)::int AS n FROM facilities');
  if (facilities.length < rows[0].n * MIN_KEEP_RATIO) {
    throw new Error(`Overpass hanya memberi ${facilities.length} fasilitas (sebelumnya ${rows[0].n}); data lama dipertahankan`);
  }
  await withTransaction(async (client) => {
    await client.query('DELETE FROM facilities');
    // Dikirim per 2.000 supaya satu parameter JSON tidak terlalu besar.
    for (let i = 0; i < facilities.length; i += 2000) {
      await client.query(INSERT_FACILITIES, [JSON.stringify(facilities.slice(i, i + 2000))]);
    }
  });
  return { items: facilities.length, message: null };
}
