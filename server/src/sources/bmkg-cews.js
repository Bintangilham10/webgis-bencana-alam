import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { postForm } from '../lib/http.js';
import { CEWS_LEVELS, createGazetteer, dasarianOf, fetchDasarian, pad2, wibDate } from '../lib/recorder.js';

// Peringatan Dini Curah Hujan Tinggi BMKG (CEWS): level per kab/kota untuk satu
// dasarian (tanggal 1–10, 11–20, 21–akhir bulan). Daftar per level dicocokkan ke
// kode Kepmendagri dengan gazeter yang sama dengan perekam arsip.
export const LEVEL_LABELS = ['Aman', 'Waspada', 'Siaga', 'Awas'];
export const ATTRIBUTION = 'Peringatan dini curah hujan tinggi: BMKG (CEWS)';
export const PAGE_URL = 'https://cews.bmkg.go.id/';

// Produk dasarian jarang berubah; 3 jam cukup untuk menangkap revisi.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const PAUSE_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function dasarianRange({ year, month, num }) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const [first, last] = [[1, 10], [11, 20], [21, lastDay]][num - 1];
  const day = (d) => `${year}-${pad2(month)}-${pad2(d)}`;
  return { start: day(first), end: day(last) };
}

// { aman: [{ provinsi, kab_kota }], waspada: [...], ... } → level tertinggi per kode.
export function codeLevels(levels, gazetteer) {
  const byCode = {};
  const unmatched = [];
  CEWS_LEVELS.forEach((name, level) => {
    for (const entry of levels[name] ?? []) {
      const wilayah = gazetteer.match(entry.kab_kota, entry.provinsi);
      if (!wilayah) {
        unmatched.push(`${entry.kab_kota} (${entry.provinsi})`);
        continue;
      }
      byCode[wilayah.kode] = Math.max(byCode[wilayah.kode] ?? 0, level);
    }
  });
  return { byCode, unmatched };
}

export async function loadGazetteer() {
  const { rows } = await query(
    `SELECT k.kode, k.nama, k.tingkat, p.nama AS provinsi
     FROM wilayah k JOIN wilayah p ON p.kode = k.induk_kode
     WHERE k.tingkat <> 'provinsi'`,
  );
  return createGazetteer(rows);
}

// Empat POST berurutan (satu per level); jeda perekam 1 detik dipersingkat
// karena di sini ada pengguna yang menunggu, dan hasilnya di-cache 3 jam.
const fetchLevels = (dasarian) =>
  fetchDasarian({ postForm: (url, fields) => postForm(url, fields, { timeoutMs: 20_000 }) }, dasarian, () => sleep(PAUSE_MS));

// Layanan bersama untuk cek risiko dan layer peta. fetchLevels dan gazetteer
// bisa diganti saat test supaya tidak memanggil BMKG.
export function createRainWarnings({ fetch = fetchLevels, gazetteer = loadGazetteer } = {}) {
  const getGazetteer = memoize(gazetteer, 24 * 60 * 60 * 1000);
  const load = memoize(async (key) => {
    const [year, month, num] = key.split('-').map(Number);
    const dasarian = { year, month, num };
    const [levels, names] = await Promise.all([fetch(dasarian), getGazetteer()]);
    const { byCode, unmatched } = codeLevels(levels, names);
    const counts = Object.fromEntries(CEWS_LEVELS.map((name) => [name, levels[name]?.length ?? 0]));
    return {
      dasarian: { ...dasarian, ...dasarianRange(dasarian) },
      // Sebelum BMKG menerbitkan produk dasarian ini, semua daftar kosong.
      published: Object.values(counts).some((n) => n > 0),
      counts,
      by_code: byCode,
      unmatched,
      fetched_at: new Date().toISOString(),
    };
  }, CACHE_TTL_MS);

  return (now = new Date()) => {
    const { year, month, num } = dasarianOf(wibDate(now));
    return load(`${year}-${month}-${num}`);
  };
}

// Level untuk satu kab/kota: null bila produk belum terbit atau kode tidak ada;
// kab/kota yang tidak tercantum di daftar mana pun dianggap Aman.
export function levelFor(warnings, kode) {
  if (!warnings?.published || !kode) return null;
  return warnings.by_code[kode] ?? 0;
}
