export async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal memuat ${url} (HTTP ${res.status})`);
  return res.json();
}
