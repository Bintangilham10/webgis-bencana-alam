// Cache sederhana di memori untuk data yang jarang berubah (sesar, batas
// wilayah), supaya query geometri besar tidak diulang di setiap request.
export function memoize(load, ttlMs) {
  const entries = new Map();
  return async (key = '') => {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await load(key);
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  };
}
