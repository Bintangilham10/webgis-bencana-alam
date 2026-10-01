import { Router } from 'express';
import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { searchNominatim } from '../sources/nominatim.js';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const LOCAL_LIMIT = 4;
// Kandidat wilayah diambil lebih banyak dari yang ditampilkan, supaya nama yang
// cocok di awal kata tidak terpotong oleh nama yang hanya cocok di tengah kata.
const LOCAL_CANDIDATES = 8;
const ONE_DAY_MS = 24 * 60 * 60_000;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "Lembang" cocok di awal kata pada "Lembang" tetapi tidak pada "Kota Palembang".
export const matchesWordStart = (name, q) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(q)}`, 'iu').test(name);

// Urutan hasil: wilayah yang cocok di awal kata, lalu tempat dari OSM, lalu
// wilayah yang hanya cocok di tengah kata (mis. "Lembang" → Kota Palembang,
// yang dulu tampil di urutan pertama). Tempat OSM yang namanya sama dengan
// wilayah cukup ditampilkan sekali (versi database).
export function rankResults(q, wilayah, places) {
  const wilayahNames = new Set(wilayah.map((w) => w.name.toLowerCase()));
  const otherPlaces = places.filter((p) => !wilayahNames.has(p.name.toLowerCase()));
  const atWordStart = wilayah.filter((w) => matchesWordStart(w.name, q)).slice(0, LOCAL_LIMIT);
  const inWord = wilayah.filter((w) => !matchesWordStart(w.name, q)).slice(0, LOCAL_LIMIT - atWordStart.length);
  return [...atWordStart, ...otherPlaces, ...inWord];
}

// Nama kab/kota/provinsi dicari dulu di database sendiri (instan, tanpa beban
// ke Nominatim); tempat lain (kelurahan, jalan, fasilitas) dicari di OSM.
async function searchWilayah(q) {
  const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const { rows } = await query(
    `SELECT kode, nama, tingkat, ST_X(titik) AS lon, ST_Y(titik) AS lat,
            ST_XMin(geom) AS west, ST_YMin(geom) AS south, ST_XMax(geom) AS east, ST_YMax(geom) AS north
     FROM wilayah
     WHERE nama ILIKE $1
     ORDER BY position(lower($2) IN lower(nama)), length(nama)
     LIMIT ${LOCAL_CANDIDATES}`,
    [pattern, q],
  );
  return rows.map((r) => ({
    source: 'wilayah',
    name: r.nama,
    label: `${r.nama} (${r.tingkat === 'provinsi' ? 'provinsi' : `kode ${r.kode}`})`,
    type: r.tingkat,
    lat: r.lat,
    lon: r.lon,
    bounds: [[r.south, r.west], [r.north, r.east]],
  }));
}

export function createGeocodeRouter({ searchPlaces = searchNominatim } = {}) {
  const router = Router();
  const searchPlacesCached = memoize(searchPlaces, ONE_DAY_MS, { maxEntries: 1000 });

  router.get('/geocode', async (req, res) => {
    const q = String(req.query.q ?? '').trim().replace(/\s+/g, ' ');
    if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ error: `Kata kunci harus ${MIN_QUERY_LENGTH}–${MAX_QUERY_LENGTH} karakter` });
    }

    const [wilayah, places] = await Promise.all([
      searchWilayah(q),
      searchPlacesCached(q.toLowerCase()).catch((err) => ({ error: err.message })),
    ]);
    res.json({
      query: q,
      results: rankResults(q, wilayah, Array.isArray(places) ? places : []),
      warning: places.error ? 'Pencarian OpenStreetMap sedang tidak tersedia; hanya nama wilayah yang dicari.' : null,
    });
  });

  return router;
}
