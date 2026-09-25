// Semua partisi folder memakai tanggal UTC supaya konsisten lintas WIB/WITA/WIT.
function toIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Tanggal tidak valid: ${value}`);
  return date.toISOString();
}

// "2026-09-25T13:47:30Z" → "2026/09/25"
export function datePath(value) {
  const iso = toIso(value);
  return `${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

// "2026-09-25T13:47:30Z" → "2026/09"
export function monthPath(value) {
  return datePath(value).slice(0, 7);
}

// "2026-09-25T13:47:30.000Z" → "20260925T134730Z" (aman sebagai nama file di Windows)
export function compactTimestamp(value) {
  return toIso(value).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function safeName(text) {
  return String(text).replace(/[^A-Za-z0-9._-]/g, '_');
}
