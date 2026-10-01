// Cache sederhana di memori dengan TTL. maxEntries membatasi pemakaian memori
// untuk kunci yang tak terbatas jumlahnya (mis. koordinat cek risiko):
// entri tertua dibuang lebih dulu.
// Janji (promise) yang sedang berjalan ikut disimpan, jadi permintaan serentak
// untuk kunci yang sama cukup memanggil sumber sekali. Hasil gagal tidak disimpan.
// ttlFor(hasil) → ms, bila ada, menggantikan ttlMs setelah hasilnya diketahui
// (mis. produk yang belum terbit disimpan lebih singkat).
export function memoize(load, ttlMs, { maxEntries = Infinity, ttlFor } = {}) {
  const entries = new Map();
  return (key = '') => {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = Promise.resolve().then(() => load(key));
    const entry = { value, expiresAt: Date.now() + ttlMs };
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    value.then(
      (result) => {
        if (ttlFor) entry.expiresAt = Date.now() + ttlFor(result);
      },
      () => {
        if (entries.get(key) === entry) entries.delete(key);
      },
    );
    return value;
  };
}
