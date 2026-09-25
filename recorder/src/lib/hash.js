import { createHash } from 'node:crypto';

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// Urutan key diabaikan, supaya sumber yang mengacak urutan field
// tidak terbaca sebagai revisi data.
export function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

// Hash pendek untuk nama file revisi.
export function contentHash(value) {
  return sha256(stableStringify(value)).slice(0, 12);
}
