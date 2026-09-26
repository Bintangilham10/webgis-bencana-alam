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
