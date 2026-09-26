import { fetchText } from '../lib/http.js';

// MAGMA tidak menyediakan API, tetapi halaman utamanya menyematkan data peta
// sebagai literal JSON: `var markersGunungApi = [...]`, lengkap dengan
// koordinat dan status level setiap gunung api.
export const HOME_URL = 'https://magma.esdm.go.id/';

const MIN_EXPECTED_VOLCANOES = 50;

export function extractVolcanoes(html) {
  const markers = JSON.parse(extractJsonLiteral(html, 'markersGunungApi'));
  if (!Array.isArray(markers) || markers.length < MIN_EXPECTED_VOLCANOES) {
    throw new Error(`markersGunungApi hanya berisi ${markers?.length ?? 0} data; format MAGMA mungkin berubah`);
  }

  return markers.map((m) => {
    const volcano = {
      kode: m.ga_code,
      nama: m.ga_nama_gapi,
      kabupaten: m.ga_kab_gapi || null,
      provinsi: m.ga_prov_gapi || null,
      elevasiM: Number.isFinite(m.ga_elev_gapi) ? m.ga_elev_gapi : null,
      level: Number(m.ga_status),
      lat: Number(m.ga_lat_gapi),
      lon: Number(m.ga_lon_gapi),
    };
    const valid =
      volcano.kode && volcano.nama && volcano.level >= 1 && volcano.level <= 4 &&
      Number.isFinite(volcano.lat) && Number.isFinite(volcano.lon);
    if (!valid) throw new Error(`Data gunung api MAGMA tidak valid: ${JSON.stringify(m)}`);
    return volcano;
  });
}

// Ambil literal [...] / {...} setelah `var <nama> =` dengan menghitung kurung.
// Isi string dilewati supaya kurung di dalam teks tidak ikut terhitung.
export function extractJsonLiteral(text, varName) {
  const declaration = text.indexOf(`var ${varName}`);
  if (declaration === -1) throw new Error(`Variabel ${varName} tidak ditemukan`);
  const start = text.indexOf('=', declaration) + 1;
  const source = text.slice(start).trimStart();

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return source.slice(0, i + 1);
    }
  }
  throw new Error(`Literal ${varName} tidak ditutup`);
}

export async function fetchMagmaVolcanoes() {
  return extractVolcanoes(await fetchText(HOME_URL, { timeoutMs: 30_000 }));
}
