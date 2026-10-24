// P3 Akurasi data (rencana pengujian Tugas 1): data SIGAP dicocokkan dengan sumber
// resminya. Kriteria lulus: ≥ 95% cocok; kelas InaRISK identik.
//
// - Gempa: tiga feed publik BMKG (autogempa, gempaterkini, gempadirasakan) dicocokkan
//   dengan /api/earthquakes menurut waktu kejadian; magnitudo, kedalaman, dan
//   koordinat harus sama.
// - Gunung api: tabel tingkat aktivitas MAGMA (halaman lain dari yang dibaca server)
//   dibandingkan dengan level di /api/volcanoes.
// - InaRISK: di 50 titik pantau dari 50 kab/kota, kelas dan indeks bahaya di cek
//   risiko SIGAP dibandingkan dengan nilai identify InaRISK di koordinat yang sama.
//
// Jalankan saat API berjalan: npm run akurasi (API bawaan http://localhost:3000).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_URL as MAGMA_LEVELS_URL, parseLevels } from '../../recorder/src/sources/magma.js';

const API = process.env.SIGAP_API ?? 'http://localhost:3000';
const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hasil');
const HEADERS = { 'User-Agent': 'SIGAP-Bencana-uji/1.0 (tugas besar Telkom University)' };
const INARISK = 'https://gis.bnpb.go.id/server/rest/services/inarisk';
const SERVICES = {
  gempa: 'INDEKS_BAHAYA_GEMPABUMI',
  cuaca: 'INDEKS_BAHAYA_CUACAEKSTRIM',
  banjir: 'INDEKS_BAHAYA_BANJIR',
  longsor: 'INDEKS_BAHAYA_TANAHLONGSOR',
  gunungapi: 'INDEKS_BAHAYA_GUNUNGAPI',
};

async function getJson(url, { timeoutMs = 30_000 } = {}) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${url}`);
  return res.json();
}
const percent = (n, total) => (total ? Math.round((1000 * n) / total) / 10 : null);

// ---------- Gempa BMKG ----------
const compact = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

async function checkQuakes() {
  const official = new Map();
  for (const feed of ['autogempa', 'gempaterkini', 'gempadirasakan']) {
    const json = await getJson(`https://data.bmkg.go.id/DataMKG/TEWS/${feed}.json`);
    for (const g of [].concat(json.Infogempa.gempa)) {
      const [lat, lon] = g.Coordinates.split(',').map(Number);
      const id = `bmkg:${compact(g.DateTime)}`;
      official.set(id, { id, waktu: g.DateTime, magnitude: Number(g.Magnitude), kedalaman_km: Number.parseInt(g.Kedalaman, 10), lat, lon, wilayah: g.Wilayah });
    }
  }
  const sigap = new Map((await getJson(`${API}/api/earthquakes?days=90`)).features.map((f) => [f.properties.id, f]));
  const rows = [...official.values()].map((o) => {
    const s = sigap.get(o.id);
    if (!s) return { ...o, cocok: false, beda: 'tidak ada di SIGAP' };
    const [lon, lat] = s.geometry.coordinates;
    const diffs = [
      s.properties.magnitude !== o.magnitude && `magnitudo ${s.properties.magnitude} ≠ ${o.magnitude}`,
      Math.round(s.properties.depth_km) !== o.kedalaman_km && `kedalaman ${s.properties.depth_km} ≠ ${o.kedalaman_km}`,
      (Math.abs(lat - o.lat) > 0.001 || Math.abs(lon - o.lon) > 0.001) && `koordinat ${lat},${lon} ≠ ${o.lat},${o.lon}`,
    ].filter(Boolean);
    return { ...o, cocok: !diffs.length, beda: diffs.join('; ') || null };
  });
  const matched = rows.filter((r) => r.cocok).length;
  return { sumber: 'BMKG data.bmkg.go.id (autogempa, gempaterkini, gempadirasakan)', gempa: rows.length, cocok: matched, persen: percent(matched, rows.length), tidak_cocok: rows.filter((r) => !r.cocok) };
}

// ---------- Gunung api MAGMA ----------
const volcanoKey = (name) => name.toLowerCase().replace(/^(gunung|gn\.?)\s+/, '').replace(/[^a-z0-9]/g, '');

async function checkVolcanoes() {
  const res = await fetch(MAGMA_LEVELS_URL, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${MAGMA_LEVELS_URL}`);
  const official = parseLevels(await res.text());
  const sigap = new Map((await getJson(`${API}/api/volcanoes`)).features.map((f) => [volcanoKey(f.properties.nama), f.properties]));
  const rows = official.map((o) => {
    const s = sigap.get(volcanoKey(o.name));
    if (!s) return { nama: o.name, level_magma: o.level, cocok: false, beda: 'tidak ada di SIGAP' };
    return { nama: o.name, level_magma: o.level, level_sigap: s.level, cocok: s.level === o.level, beda: s.level === o.level ? null : `level ${s.level} ≠ ${o.level}` };
  });
  const matched = rows.filter((r) => r.cocok).length;
  return { sumber: MAGMA_LEVELS_URL, gunung_api: rows.length, cocok: matched, persen: percent(matched, rows.length), tidak_cocok: rows.filter((r) => !r.cocok) };
}

// ---------- InaRISK ----------
// Kelas BNPB: indeks 0–1 dibagi sepertiga, batas atas inklusif. Indeks 0 (dan
// NoData) = di luar zona bahaya, seperti aturan warna peta InaRISK (NoDataRanges
// [-1, 0,0001]).
const hazardClass = (index) =>
  index === null || index <= 1e-4 ? null : index <= 1 / 3 + 1e-4 ? 'rendah' : index <= 2 / 3 + 1e-4 ? 'sedang' : 'tinggi';

async function identify(service, lat, lon) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    returnGeometry: 'false',
    returnCatalogItems: 'false',
    f: 'json',
  });
  const json = await getJson(`${INARISK}/${service}/ImageServer/identify?${params}`, { timeoutMs: 12_000 });
  if (json.value === undefined) throw new Error('respons identify tidak dikenal');
  return json.value === 'NoData' ? null : Number.parseFloat(json.value);
}

async function checkInarisk() {
  const { regions } = await getJson(`${API}/api/outlook`);
  const sorted = [...regions].sort((a, b) => a.kode.localeCompare(b.kode));
  // 50 kab/kota tersebar merata menurut kode; bergantian titik pantau hujan, banjir,
  // longsor (kab/kota tanpa titik pantau untuk bahaya itu memakai titik lain, atau
  // diganti kab/kota berikutnya).
  const points = [];
  for (let i = 0; points.length < 50 && i < sorted.length * 2; i++) {
    const region = sorted[Math.floor((points.length * sorted.length) / 50) + (i - points.length)];
    if (!region) break;
    const kinds = ['hujan', 'banjir', 'longsor'];
    const preferred = kinds[points.length % 3];
    const h = [preferred, ...kinds].map((k) => region.hazards[k]).find((x) => Number.isFinite(x?.lat) && Number.isFinite(x?.lon));
    if (!h) continue;
    // Cek risiko membulatkan titik ke 3 desimal (sel cache ±100 m); InaRISK diminta di titik yang sama.
    points.push({ kode: region.kode, nama: region.nama, lat: Number(h.lat.toFixed(3)), lon: Number(h.lon.toFixed(3)) });
  }
  const down = new Map(); // layanan yang gagal 3 kali berturut-turut dilewati
  const perHazard = Object.fromEntries(Object.keys(SERVICES).map((id) => [id, { dibandingkan: 0, identik: 0, tidak_tersedia: 0 }]));
  const mismatches = [];
  for (const [i, p] of points.entries()) {
    const profile = await getJson(`${API}/api/risk?lat=${p.lat}&lon=${p.lon}`, { timeoutMs: 60_000 });
    const official = await Promise.all(
      Object.entries(SERVICES).map(async ([id, service]) => {
        if ((down.get(id) ?? 0) >= 3) return [id, { error: 'layanan mati' }];
        try {
          const index = await identify(service, p.lat, p.lon);
          down.set(id, 0);
          return [id, { index }];
        } catch (err) {
          down.set(id, (down.get(id) ?? 0) + 1);
          return [id, { error: err.message }];
        }
      }),
    );
    for (const [id, o] of official) {
      const s = profile.hazards.find((h) => h.id === id);
      const stat = perHazard[id];
      if (o.error || s.error) {
        stat.tidak_tersedia++;
        continue;
      }
      stat.dibandingkan++;
      const sameIndex = (s.index === null && o.index === null) || Math.abs(s.index - o.index) < 1e-6;
      const sameClass = (s.class?.id ?? null) === hazardClass(o.index);
      if (sameIndex && sameClass) stat.identik++;
      else mismatches.push({ titik: p, bahaya: id, sigap: { index: s.index, kelas: s.class?.id ?? null }, inarisk: { index: o.index, kelas: hazardClass(o.index) } });
    }
    process.stdout.write(`\r  InaRISK ${i + 1}/50`);
  }
  process.stdout.write('\n');
  const compared = Object.values(perHazard).reduce((n, s) => n + s.dibandingkan, 0);
  const identical = Object.values(perHazard).reduce((n, s) => n + s.identik, 0);
  return { sumber: `${INARISK}/*/ImageServer/identify`, titik: points.length, per_bahaya: perHazard, dibandingkan: compared, identik: identical, persen: percent(identical, compared), tidak_identik: mismatches };
}

const results = { diukur: new Date().toISOString(), api: API };
for (const [name, run] of [['gempa', checkQuakes], ['gunung_api', checkVolcanoes], ['inarisk', checkInarisk]]) {
  try {
    results[name] = await run();
  } catch (err) {
    results[name] = { galat: err.message };
  }
  const r = results[name];
  console.log(`${name}: ${r.galat ?? `${r.cocok ?? r.identik}/${r.gempa ?? r.gunung_api ?? r.dibandingkan} (${r.persen}%)`}`);
}
await mkdir(RESULTS, { recursive: true });
await writeFile(join(RESULTS, 'p3-akurasi.json'), `${JSON.stringify(results, null, 2)}\n`);
