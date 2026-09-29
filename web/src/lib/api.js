// Pesan error dari API (mis. "Koordinat harus di kawasan Indonesia") diteruskan
// apa adanya supaya bisa ditampilkan ke pengguna; `status` = kode HTTP.
export async function getJson(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const message = await res
      .json()
      .then((body) => body.error)
      .catch(() => null);
    throw Object.assign(new Error(message ?? `Gagal memuat data (HTTP ${res.status})`), { status: res.status });
  }
  return res.json();
}
