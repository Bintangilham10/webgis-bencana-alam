// "2026-09-25T13:47:30+00:00" → "20260925T134730Z"
export function compactTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Tanggal tidak valid: ${value}`);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
