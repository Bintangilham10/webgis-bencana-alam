// Cache sederhana di memori dengan TTL. maxEntries membatasi pemakaian memori
// untuk kunci yang tak terbatas jumlahnya (mis. koordinat cek risiko):
// entri tertua dibuang lebih dulu.
// Janji (promise) yang sedang berjalan ikut disimpan, jadi permintaan serentak
// untuk kunci yang sama cukup memanggil sumber sekali. Hasil gagal tidak disimpan.
export function memoize(load, ttlMs, { maxEntries = Infinity } = {}) {
  const entries = new Map();
  return (key = '') => {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = Promise.resolve().then(() => load(key));
    entries.delete(key);
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    return value;
  };
}
