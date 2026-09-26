// Cache sederhana di memori dengan TTL. maxEntries membatasi pemakaian memori
// untuk kunci yang tak terbatas jumlahnya (mis. koordinat cek risiko):
// entri tertua dibuang lebih dulu.
export function memoize(load, ttlMs, { maxEntries = Infinity } = {}) {
  const entries = new Map();
  return async (key = '') => {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await load(key);
    entries.delete(key);
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    return value;
  };
}
