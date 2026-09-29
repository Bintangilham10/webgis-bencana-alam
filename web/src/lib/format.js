// Semua teks dari sumber luar (BMKG, MAGMA, dll.) di-escape sebelum masuk HTML.
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const dateTimeFormat = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Asia/Jakarta',
});

export const formatDateTime = (iso) => `${dateTimeFormat.format(new Date(iso))} WIB`;

const numberFormat = new Intl.NumberFormat('id-ID');
export const formatNumber = (value) => numberFormat.format(value);

// Desimal gaya Indonesia (koma), mis. 0,78 atau 9,9.
export const formatDecimal = (value, digits = 1) =>
  new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value);

// Tanggal prakiraan "YYYY-MM-DD" (zona WIB) → "Sab, 26/9".
const dayFormat = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jakarta' });
export const formatDay = (isoDate) => dayFormat.format(new Date(`${isoDate}T12:00:00+07:00`));

export const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : '');

// Teks wilayah BMKG "Pusat gempa berada di laut 46 km utara Ruteng" dipersingkat
// menjadi "Laut 46 km utara Ruteng" untuk daftar dan popup.
export const shortQuakeRegion = (text) => capitalize(String(text ?? '').replace(/^pusat gempa berada di\s+/i, '').trim());

const relativeFormat = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' });
const UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export function timeAgo(iso, now = Date.now()) {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return 'baru saja';
}

// Dasarian BMKG {start: "2026-09-21", end: "2026-09-30", num: 3} → "21–30 Sep 2026 (dasarian III)".
const monthShort = new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'UTC' });
// short: "21–30 Sep" untuk ruang sempit.
export function formatDasarian({ start, end, num }, { short = false } = {}) {
  const [year, month, first] = start.split('-').map(Number);
  const last = Number(end.slice(8, 10));
  const range = `${first}–${last} ${monthShort.format(new Date(Date.UTC(year, month - 1, 15)))}`;
  return short ? range : `${range} ${year} (dasarian ${['I', 'II', 'III'][num - 1]})`;
}

// Bulan prakiraan "2026-09" → "September 2026".
const monthLong = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const formatMonth = (yyyymm) => monthLong.format(new Date(`${yyyymm}-15T00:00:00Z`));

// Tanggal kejadian "2021-01-06" → "6 Jan 2021".
const dateShort = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const formatDateShort = (isoDate) => dateShort.format(new Date(`${isoDate}T00:00:00Z`));

// Rentang prakiraan "2026-09-29".."2026-10-01" → "29 Sep–1 Okt".
const dayMonth = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const formatDateRange = (from, to) => `${dayMonth.format(new Date(`${from}T00:00:00Z`))}–${dayMonth.format(new Date(`${to}T00:00:00Z`))}`;
