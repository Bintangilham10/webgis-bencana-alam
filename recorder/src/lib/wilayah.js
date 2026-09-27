import { readFileSync } from 'node:fs';

// Daftar 514 kab/kota (Kepmendagri 2025) beserta satu titik di dalam wilayahnya.
// Dibuat dari database server: `npm run export:recorder` di folder server.
export function loadWilayah(file = new URL('../../data/wilayah.json', import.meta.url)) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const words = (text) =>
  String(text)
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

// Ejaan yang berbeda antar-sumber, atau nama lama sebelum diganti (arsip CEWS
// 2022 masih memakai batas lama, mis. Mamuju Utara → Pasangkayu).
const NAME_ALIASES = {
  MAHAKAMHULU: 'MAHAKAMULU',
  TOBASAMOSIR: 'TOBA',
  TANGGERANG: 'TANGERANG',
  TANGGERANGSELATAN: 'TANGERANGSELATAN',
  SIDOARDJO: 'SIDOARJO',
  ENREKKANG: 'ENREKANG',
  KOTASUBUSSALAM: 'SUBULUSSALAM',
  SUBUSSALAM: 'SUBULUSSALAM',
  KUANTANSENGINGI: 'KUANTANSINGINGI',
  PADANGSIDEMPUAN: 'PADANGSIDIMPUAN',
  PANGKAJENEKEPULAUAN: 'PANGKAJENEDANKEPULAUAN',
  SIDENRENGRAPANG: 'SIDENRENGRAPPANG',
  LIMAPULUHKOTO: 'LIMAPULUHKOTA',
  SAWAHLUNTOSIJUNJUNG: 'SIJUNJUNG',
  MAMUJUUTARA: 'PASANGKAYU',
  MALUKUTENGGARABARAT: 'TANIMBAR',
  PASIR: 'PASER',
  MOROTAI: 'PULAUMOROTAI',
  MEMBERAMORAYA: 'MAMBERAMORAYA',
  SITARO: 'SIAUTAGULANDANGBIARO',
  PALI: 'PENUKALABABLEMATANGILIR',
  PAHUWATO: 'POHUWATO',
};
const PROVINCE_ALIASES = { 'DAERAH KHUSUS IBUKOTA JAKARTA': 'DKI JAKARTA', 'DAERAH ISTIMEWA YOGYAKARTA': 'DI YOGYAKARTA' };

const provinceKey = (name) => {
  const w = words(name);
  return (PROVINCE_ALIASES[w] ?? w).replace(/ /g, '');
};

// Kunci pembanding nama kab/kota. Sumber lain menulis "GUNUNG KIDUL" untuk
// "Kabupaten Gunungkidul", "SIAU TAGULANDANG BIARO" untuk "Kabupaten Kep. Siau
// Tagulandang Biaro", dan "KOTA JAKARTA BARAT" untuk "Kota Administrasi Jakarta
// Barat", jadi awalan dan spasi diabaikan.
export function nameKey(name) {
  let w = words(name)
    .replace(/^(KABUPATEN|KAB) /, '')
    .replace(/\bADMINISTRASI /, '')
    .replace(/ ADMINISTRATIF$/, '');
  const isKota = w.startsWith('KOTA ');
  if (isKota) w = w.slice(5);
  const base = w.replace(/^(KEPULAUAN|KEP) /, '').replace(/ /g, '');
  return `${isKota ? 'KOTA' : 'KAB'}:${NAME_ALIASES[base] ?? base}`;
}

// Nama polos (tanpa "Kabupaten"/"Kota") yang juga kata umum atau nama tempat
// lain; hanya dihitung bila didahului "Kabupaten", "Kota", "Bupati", atau "Wali Kota".
const COMMON_WORDS = new Set(['BATU', 'BURU', 'PATI', 'PUNCAK', 'LEBAK', 'MUNA', 'KAMPAR', 'SIAK', 'BINTAN', 'TOBA']);

const PROVINCE_SHORT = {
  Jabar: 'Jawa Barat',
  Jateng: 'Jawa Tengah',
  Jatim: 'Jawa Timur',
  DIY: 'Daerah Istimewa Yogyakarta',
  Sumbar: 'Sumatera Barat',
  Sumut: 'Sumatera Utara',
  Sumsel: 'Sumatera Selatan',
  Sulsel: 'Sulawesi Selatan',
  Sulteng: 'Sulawesi Tengah',
  Sulut: 'Sulawesi Utara',
  Sultra: 'Sulawesi Tenggara',
  Sulbar: 'Sulawesi Barat',
  Kalbar: 'Kalimantan Barat',
  Kalteng: 'Kalimantan Tengah',
  Kalsel: 'Kalimantan Selatan',
  Kaltim: 'Kalimantan Timur',
  Kaltara: 'Kalimantan Utara',
  NTB: 'Nusa Tenggara Barat',
  NTT: 'Nusa Tenggara Timur',
  Babel: 'Kepulauan Bangka Belitung',
  Kepri: 'Kepulauan Riau',
  Malut: 'Maluku Utara',
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Nama resmi → pola yang toleran terhadap spasi/tanda hubung dan singkatan "Kep.".
const namePattern = (name) =>
  escapeRegex(name)
    .replace(/^Kep\\\. /, '(?:Kep\\.?|Kepulauan) ')
    .replace(/\s+/g, '[\\s-]+');

export function createGazetteer(wilayah) {
  const byKey = new Map();
  for (const w of wilayah) {
    const key = nameKey(w.nama);
    byKey.set(key, [...(byKey.get(key) ?? []), w]);
  }

  // Satu pola per kab/kota: nama berawalan (keyakinan tinggi) dan nama polos (rendah).
  const patterns = wilayah.map((w) => {
    const isKota = w.tingkat === 'kota';
    const bare = w.nama.replace(/^(Kabupaten|Kota)( Administrasi)? /, '');
    const prefix = isKota ? '(?:Kota|Wali\\s?kota)' : '(?:Kabupaten|Kab\\.?|Bupati)';
    return {
      wilayah: w,
      bare,
      prefixed: new RegExp(`\\b${prefix}\\s+${namePattern(bare)}\\b`, 'giu'),
      plain: COMMON_WORDS.has(words(bare)) ? null : new RegExp(`\\b${namePattern(bare)}\\b`, 'giu'),
    };
  });
  const provinces = [...new Set(wilayah.map((w) => w.provinsi))];
  const provincePatterns = [
    ...provinces.map((p) => ({ provinsi: p, re: new RegExp(`\\b${namePattern(p)}\\b`, 'iu') })),
    ...Object.entries(PROVINCE_SHORT).map(([short, p]) => ({ provinsi: p, re: new RegExp(`\\b${short}\\b`, 'u') })),
  ].filter((p) => provinces.includes(p.provinsi));

  return {
    // Nama kab/kota dari sumber lain (mis. CEWS BMKG) → baris wilayah, atau null.
    match(name, provinsi) {
      const key = nameKey(name);
      const candidates = byKey.get(key) ?? (key.startsWith('KAB:') ? byKey.get(`KOTA:${key.slice(4)}`) : null) ?? [];
      const inProvince = provinsi ? candidates.filter((w) => provinceKey(w.provinsi) === provinceKey(provinsi)) : candidates;
      const pick = inProvince.length ? inProvince : candidates;
      return pick.length === 1 ? pick[0] : null;
    },

    // Kab/kota dan provinsi yang disebut dalam teks (mis. judul berita).
    // Nama terpanjang menang, jadi "Bandung Barat" tidak ikut dihitung "Bandung".
    // Nama polos yang dipakai kabupaten sekaligus kota (mis. "Tasikmalaya")
    // mencatat keduanya dengan keyakinan rendah.
    findInText(text) {
      const found = [];
      for (const { wilayah: w, bare, prefixed, plain } of patterns) {
        for (const re of [prefixed, plain]) {
          if (!re) continue;
          for (const m of text.matchAll(re)) {
            found.push({ w, bare, start: m.index, end: m.index + m[0].length, strong: re === prefixed });
          }
        }
      }
      found.sort((a, b) => b.strong - a.strong || b.bare.length - a.bare.length);
      const taken = [];
      const kabKota = new Map();
      for (const f of found) {
        const overlap = taken.filter((t) => f.start < t.end && t.start < f.end);
        const twin = overlap.length > 0 && overlap.every((t) => !t.strong && !f.strong && t.start === f.start && t.end === f.end && t.bare === f.bare);
        if (overlap.length && !twin) continue;
        taken.push(f);
        const previous = kabKota.get(f.w.kode);
        if (!previous || (f.strong && previous.keyakinan === 'rendah')) {
          kabKota.set(f.w.kode, { kode: f.w.kode, nama: f.w.nama, keyakinan: f.strong ? 'tinggi' : 'rendah' });
        }
      }
      const provinsi = [...new Set(provincePatterns.filter((p) => p.re.test(text)).map((p) => p.provinsi))];
      return { kabKota: [...kabKota.values()], provinsi };
    },
  };
}
