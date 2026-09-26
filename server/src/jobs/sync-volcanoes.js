import { withTransaction } from '../db.js';
import { fetchMagmaVolcanoes } from '../sources/magma.js';

// level_changed_at hanya diisi saat level berubah dibanding data sebelumnya;
// gunung api yang baru pertama masuk belum dianggap "berubah".
const UPSERT_VOLCANO = `
  INSERT INTO volcanoes (kode, nama, kabupaten, provinsi, elevasi_m, level, checked_at, geom)
  VALUES ($1, $2, $3, $4, $5, $6, now(), ST_SetSRID(ST_MakePoint($7, $8), 4326))
  ON CONFLICT (kode) DO UPDATE SET
    nama = EXCLUDED.nama,
    kabupaten = EXCLUDED.kabupaten,
    provinsi = EXCLUDED.provinsi,
    elevasi_m = EXCLUDED.elevasi_m,
    geom = EXCLUDED.geom,
    level_changed_at = CASE WHEN volcanoes.level <> EXCLUDED.level THEN now() ELSE volcanoes.level_changed_at END,
    level = EXCLUDED.level,
    checked_at = now()`;

export async function syncVolcanoes({ fetchVolcanoes = fetchMagmaVolcanoes } = {}) {
  const volcanoes = await fetchVolcanoes();
  await withTransaction(async (client) => {
    for (const v of volcanoes) {
      await client.query(UPSERT_VOLCANO, [v.kode, v.nama, v.kabupaten, v.provinsi, v.elevasiM, v.level, v.lon, v.lat]);
    }
  });
  return { items: volcanoes.length, message: null };
}
