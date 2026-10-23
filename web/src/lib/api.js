// Pesan error dari API (mis. "Koordinat harus di kawasan Indonesia") diteruskan
// apa adanya supaya bisa ditampilkan ke pengguna; `status` = kode HTTP.
export const getJson = (url, { signal } = {}) => request(url, { signal });

// POST JSON, mis. permintaan rute aman.
export const postJson = (url, body, { signal } = {}) =>
  request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });

async function request(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const message = await res
      .json()
      .then((body) => body.error)
      .catch(() => null);
    throw Object.assign(new Error(message ?? `Gagal memuat data (HTTP ${res.status})`), { status: res.status });
  }
  return res.json();
}
