const ZONES = { 420: 'WIB', 480: 'WITA', 540: 'WIT' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Waktu pada zona waktu Indonesia (selisih menit dari UTC, bawaan WIB) untuk teks
// notifikasi: localClock → "21.25", localDateTime → "20 Okt, 23.29 WIB".
const shifted = (value, offsetMinutes) => new Date(new Date(value).getTime() + offsetMinutes * 60_000);
export const zoneName = (offsetMinutes = 420) => ZONES[offsetMinutes] ?? `UTC${offsetMinutes < 0 ? '−' : '+'}${Math.abs(offsetMinutes) / 60}`;
export function localClock(value, offsetMinutes = 420) {
  const date = shifted(value, offsetMinutes);
  return `${String(date.getUTCHours()).padStart(2, '0')}.${String(date.getUTCMinutes()).padStart(2, '0')}`;
}
export function localDateTime(value, offsetMinutes = 420) {
  const date = shifted(value, offsetMinutes);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${localClock(value, offsetMinutes)} ${zoneName(offsetMinutes)}`;
}

// "2026-09-25T13:47:30+00:00" → "20260925T134730Z"
export function compactTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Tanggal tidak valid: ${value}`);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
