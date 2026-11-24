import { hasTsunamiPotential } from '../lib/classify.js';

// Dashboard Sintesis: satu status (0 Normal, 1 Waspada, 2 Siaga, 3 Awas) per
// kab/kota dari data resmi yang sudah disinkronkan SIGAP.
//
//   Status = max( max(CEWS, CAP), Gempa, Gunung api )
//
// - CEWS: level BMKG untuk kab/kota itu (dasarian berjalan), level resmi.
// - CAP: peringatan dini cuaca BMKG yang sedang berlaku di kab/kota itu. CAP tidak
//   memakai skala Waspada/Siaga/Awas, jadi tingkat keparahannya dipetakan sama
//   dengan notifikasi (jobs/notify.js): Minor/Moderate 1, Severe 2, Extreme 3.
// - Gempa: gempa BMKG 24 jam terakhir yang cukup dekat (aturan QUAKE_RULES).
// - Gunung api: level PVMBG − 1 untuk kab/kota lokasi gunung atau yang berada
//   dalam radius dari gunung berstatus Waspada ke atas.
//
// CEWS dan CAP sama-sama soal hujan, jadi digabung dulu (kelompok hidrometeorologi)
// supaya hujan tidak dihitung dua kali. Indikasi SIGAP 3 hari tidak ikut status:
// aturannya belum dikalibrasi, jadi ditampilkan di sampingnya (gabungan = max).
// Sumber tanpa data tidak pernah dianggap aman: status 0 dengan satu kelompok
// tanpa data menjadi "belum pasti".
export const RULES_VERSION = 'status v0.1';

export const CAP_SEVERITY_LEVEL = { Minor: 1, Moderate: 1, Severe: 2, Extreme: 3 };
export const capLevel = (severity) => CAP_SEVERITY_LEVEL[severity] ?? 1;

// Radius dihitung dari batas kab/kota (bukan titik tengahnya).
export const QUAKE_RULES = [
  { level: 3, label: 'M ≥ 7 atau berpotensi tsunami', radiusKm: 200 },
  { level: 2, label: 'M ≥ 6', radiusKm: 100 },
  { level: 1, label: 'M ≥ 5', radiusKm: 50 },
  { level: 1, label: 'M < 5 dirasakan', radiusKm: 25 },
];

export function quakeRule({ magnitude, potensi, dirasakan }) {
  if (hasTsunamiPotential(potensi) || magnitude >= 7) return QUAKE_RULES[0];
  if (magnitude >= 6) return QUAKE_RULES[1];
  if (magnitude >= 5) return QUAKE_RULES[2];
  // Feed autogempa BMKG mengisi "-" bila gempa tidak dilaporkan dirasakan.
  const felt = (typeof dirasakan === 'string' && !['', '-'].includes(dirasakan.trim())) || /dirasakan/i.test(potensi ?? '');
  return felt ? QUAKE_RULES[3] : null;
}

// Radius gunung api per level MAGMA (2 Waspada, 3 Siaga, 4 Awas), sejalan dengan
// orde radius rekomendasi PVMBG; kab/kota lokasi gunung selalu ikut.
export const VOLCANO_RADIUS_KM = { 2: 3, 3: 5, 4: 7 };
export const volcanoLevel = (magmaLevel) => Math.max(0, magmaLevel - 1);

// Sumber yang dianggap tanpa data bila tidak berhasil disinkronkan selama ini.
export const STALE_AFTER_MS = {
  'bmkg-cap': 6 * 60 * 60_000,
  'bmkg-gempa': 6 * 60 * 60_000,
  magma: 24 * 60 * 60_000,
};

// Penentu disebut dari yang paling mendesak bila beberapa komponen sama tinggi.
const DRIVER_ORDER = ['cap', 'gempa', 'gunungapi', 'cews'];

const maxOf = (values) => {
  const known = values.filter((v) => v !== null && v !== undefined);
  return known.length ? Math.max(...known) : null;
};

// c = { cews, cap, gempa, gunungapi } (0–3 atau null), ind = { hujan, banjir, longsor }.
const isMissing = (v) => v === null || v === undefined;

// Level tertinggi; bila yang diketahui Normal tetapi ada input tanpa data,
// hasilnya null (belum pasti), bukan Normal.
const sureMax = (values) => {
  const known = maxOf(values);
  return known === 0 && values.some(isMissing) ? null : known;
};

// c = { cews, cap, gempa, gunungapi } (0–3 atau null), ind = { hujan, banjir, longsor }.
export function combine(c, ind = {}) {
  const hidromet = maxOf([c.cews, c.cap]);
  const known = maxOf([hidromet, c.gempa, c.gunungapi]);
  // Satu komponen tanpa data saja sudah cukup membuat status Normal tidak pasti
  // (mis. CEWS belum terbit walau CAP ada: peringatan hujan 10 hari tidak diketahui).
  const missing = [c.cews, c.cap, c.gempa, c.gunungapi].some(isMissing);
  const indikasi = maxOf([ind.hujan, ind.banjir, ind.longsor]);

  let status = known;
  let state = 'pasti';
  if (known === null) state = 'tanpa_data';
  else if (known === 0 && missing) state = 'belum_pasti';

  const drivers = status > 0 ? DRIVER_ORDER.filter((key) => c[key] === status) : [];
  return {
    status,
    state,
    hidromet,
    // Horizon dari data resmi saja: kejadian sekarang (CAP ±2 jam, gempa 24 jam,
    // gunung api) dan prakiraan (CEWS 10 hari). Indikasi SIGAP terpisah.
    sekarang: sureMax([c.cap, c.gempa, c.gunungapi]),
    prakiraan: sureMax([c.cews]),
    indikasi,
    gabungan: maxOf([status, indikasi]),
    drivers,
    // Status di atas Normal dengan komponen tanpa data adalah batas bawah: bisa lebih tinggi.
    minimal: status > 0 && missing,
  };
}

// Kunci hitungan nasional; tiap kab/kota masuk tepat satu kunci.
export function countKey({ status, state }) {
  if (state === 'tanpa_data' || state === 'belum_pasti') return 'belum_pasti';
  return ['normal', 'waspada', 'siaga', 'awas'][status];
}

// Kesepakatan dua penilaian biner (≥ Waspada atau tidak) di kab/kota yang
// keduanya punya data: tabel 2×2 dan Cohen kappa.
export function agreement(pairs) {
  const table = { both: 0, onlyA: 0, onlyB: 0, neither: 0 };
  for (const [a, b] of pairs) {
    if (a === null || a === undefined || b === null || b === undefined) continue;
    if (a > 0 && b > 0) table.both++;
    else if (a > 0) table.onlyA++;
    else if (b > 0) table.onlyB++;
    else table.neither++;
  }
  const n = table.both + table.onlyA + table.onlyB + table.neither;
  if (!n) return { ...table, n, kappa: null };
  const po = (table.both + table.neither) / n;
  const aYes = (table.both + table.onlyA) / n;
  const bYes = (table.both + table.onlyB) / n;
  const pe = aYes * bYes + (1 - aYes) * (1 - bYes);
  const kappa = pe === 1 ? null : (po - pe) / (1 - pe);
  return { ...table, n, kappa: kappa === null ? null : Math.round(kappa * 100) / 100 };
}
