// Pesan error dari API (mis. "Koordinat harus di kawasan Indonesia") diteruskan
// apa adanya supaya bisa ditampilkan ke pengguna.
export async function getJson(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const message = await res
      .json()
      .then((body) => body.error)
      .catch(() => null);
    throw new Error(message ?? `Gagal memuat data (HTTP ${res.status})`);
  }
  return res.json();
}
