// Batas permintaan per alamat IP untuk endpoint yang memanggil layanan luar gratis:
// cek risiko (InaRISK, Open-Meteo, PVMBG, BMKG) dan pencarian (Nominatim). Tanpa
// batas, satu skrip bisa menghabiskan kuota harian Open-Meteo server (juga dipakai
// indikasi SIGAP) atau memenuhi antrean Nominatim untuk semua pengguna. Batasnya
// longgar karena satu kelas atau kantor bisa keluar lewat satu IP yang sama.
// Jendela tetap per IP, disimpan di memori proses (server berjalan satu instance).
export function rateLimit({ limit, windowMs, message, now = Date.now }) {
  const hits = new Map();
  let sweptAt = now();
  return (req, res, next) => {
    const t = now();
    // Entri yang jendelanya sudah lewat dibuang sesekali supaya Map tidak terus tumbuh.
    if (t - sweptAt >= windowMs) {
      for (const [ip, entry] of hits) if (t - entry.start >= windowMs) hits.delete(ip);
      sweptAt = t;
    }
    const ip = req.ip ?? 'tidak diketahui';
    let entry = hits.get(ip);
    if (!entry || t - entry.start >= windowMs) {
      entry = { start: t, count: 0 };
      hits.set(ip, entry);
    }
    entry.count++;
    if (entry.count <= limit) return next();
    res.set('Retry-After', String(Math.ceil((entry.start + windowMs - t) / 1000)));
    res.status(429).json({ error: message });
  };
}
