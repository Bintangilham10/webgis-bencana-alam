// Produk BMKG dan PVMBG disusun per tanggal lokal, jadi tanggal, bulan, dan
// dasarian di sini memakai WIB. Partisi folder arsip tetap memakai UTC (paths.js).
const WIB_OFFSET_MS = 7 * 3_600_000;

const wibIso = (now) => new Date(Date.parse(now) + WIB_OFFSET_MS).toISOString();

// "2026-09-25T18:05:00Z" → "2026-09-26"
export const wibDate = (now) => wibIso(now).slice(0, 10);
export const wibHour = (now) => Number(wibIso(now).slice(11, 13));

export const pad2 = (n) => String(n).padStart(2, '0');

// Dasarian = sepertiga bulan versi BMKG: tanggal 1–10, 11–20, dan 21–akhir bulan.
export function dasarianOf(date) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, num: day <= 10 ? 1 : day <= 20 ? 2 : 3 };
}

export function nextDasarian({ year, month, num }) {
  if (num < 3) return { year, month, num: num + 1 };
  return month === 12 ? { year: year + 1, month: 1, num: 1 } : { year, month: month + 1, num: 1 };
}

export const compareDasarian = (a, b) => a.year - b.year || a.month - b.month || a.num - b.num;

export function nextMonth({ year, month }) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export const hoursSince = (iso, now) => (iso ? (Date.parse(now) - Date.parse(iso)) / 3_600_000 : Infinity);
