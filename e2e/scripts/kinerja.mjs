// P6 Kinerja (rencana pengujian Tugas 1): Lighthouse dan waktu /api/outlook dan
// /api/wilayah. Kriteria lulus: LCP ≤ 2,5 detik; API p95 ≤ 1 detik.
//
// - Waktu respons API diukur langsung ke server API (30 permintaan berurutan per
//   endpoint setelah 3 pemanasan, dengan kompresi gzip seperti browser), ditambah
//   cek risiko (titik baru dan titik yang sama lagi) serta rute aman.
// - Lighthouse 13 untuk halaman pertama (build produksi), profil HP dan desktop.
//
// Jalankan saat API dan `npm run preview` (web/) berjalan: npm run kinerja.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const API = process.env.SIGAP_API ?? 'http://localhost:3000';
const WEB = process.env.SIGAP_URL ?? 'http://localhost:4173';
const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hasil');
const RUNS = 30;

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];

async function timed(url, init) {
  const start = performance.now();
  const res = await fetch(url, { ...init, headers: { 'Accept-Encoding': 'gzip', ...init?.headers } });
  const body = await res.arrayBuffer();
  return { ms: performance.now() - start, status: res.status, bytes: body.byteLength, encoded: Number(res.headers.get('content-length')) || null };
}

function summary(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const round = (x) => Math.round(x);
  return { n: sorted.length, p50_ms: round(quantile(sorted, 0.5)), p95_ms: round(quantile(sorted, 0.95)), maks_ms: round(sorted.at(-1)) };
}

async function apiTimings() {
  const endpoints = [
    '/api/outlook',
    '/api/wilayah?tingkat=kabkota',
    '/api/wilayah?tingkat=provinsi',
    '/api/earthquakes?days=7',
    '/api/volcanoes',
    '/api/cap',
    '/api/faults',
    '/api/evacuation?lat=-6.2236&lon=106.8656',
    '/api/evacuation-sites',
    '/api/health',
  ];
  const rows = [];
  for (const path of endpoints) {
    for (let i = 0; i < 3; i++) await timed(API + path);
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await timed(API + path));
    rows.push({ endpoint: path, status: runs[0].status, ukuran_kb: Math.round(runs[0].bytes / 1024), ...summary(runs.map((r) => r.ms)) });
    console.log(`  ${path}: p95 ${rows.at(-1).p95_ms} ms`);
  }
  return rows;
}

// Cek risiko di titik baru (belum ada di cache server) lalu titik yang sama lagi.
async function riskTimings() {
  const salt = (Date.now() % 997) / 1e4;
  const points = [
    [-6.9, 107.6], [-7.8, 110.37], [-0.95, 100.35], [3.59, 98.67], [-8.65, 115.2],
    [-5.14, 119.42], [-0.9, 119.87], [1.47, 124.84], [-3.7, 128.18], [-2.53, 140.7],
  ].map(([lat, lon]) => [Number((lat - salt).toFixed(3)), Number((lon + salt).toFixed(3))]);
  const cold = [];
  const warm = [];
  // Hanya jawaban 200 yang dihitung (mis. 429 dari pembatas laju 120 cek per 10 menit).
  const ok = async (url, list) => {
    const r = await timed(url);
    if (r.status !== 200) throw new Error(`HTTP ${r.status} untuk ${url}`);
    list.push(r.ms);
  };
  for (const [lat, lon] of points) await ok(`${API}/api/risk?lat=${lat}&lon=${lon}`, cold);
  for (const [lat, lon] of points) await ok(`${API}/api/risk?lat=${lat}&lon=${lon}`, warm);
  return { titik_baru: summary(cold), titik_sama_lagi: summary(warm), waktu_titik_baru_ms: cold.map(Math.round) };
}

async function routeTimings() {
  const trips = [
    [{ lat: -6.2236, lon: 106.8656 }, { lat: -6.2256, lon: 106.8649 }, 'jalan_kaki'],
    [{ lat: -6.2236, lon: 106.8656 }, { lat: -6.2302, lon: 106.8580 }, 'motor'],
    [{ lat: -6.9175, lon: 107.6191 }, { lat: -6.9030, lon: 107.6186 }, 'jalan_kaki'],
    [{ lat: -0.9471, lon: 100.4172 }, { lat: -0.9280, lon: 100.3610 }, 'mobil'],
    [{ lat: -7.0300, lon: 107.5300 }, { lat: -7.0100, lon: 107.5600 }, 'jalan_kaki'],
  ];
  const rows = [];
  for (const [from, to, mode] of trips) {
    const r = await timed(`${API}/api/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, mode }) });
    rows.push({ mode, status: r.status, ms: Math.round(r.ms) });
  }
  return { ...summary(rows.map((r) => r.ms)), perjalanan: rows };
}

async function lighthouseRun(label, config) {
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-first-run'] });
  try {
    const { lhr, report } = await lighthouse(`${WEB}/`, { port: chrome.port, output: ['html', 'json'], logLevel: 'error' }, config);
    await writeFile(join(RESULTS, `lighthouse-${label}.html`), report[0]);
    await writeFile(join(RESULTS, `lighthouse-${label}.json`), report[1]);
    const audit = (id) => lhr.audits[id]?.numericValue;
    return {
      profil: label,
      skor: Object.fromEntries(Object.entries(lhr.categories).map(([id, c]) => [id, Math.round(c.score * 100)])),
      lcp_ms: Math.round(audit('largest-contentful-paint')),
      fcp_ms: Math.round(audit('first-contentful-paint')),
      tbt_ms: Math.round(audit('total-blocking-time')),
      cls: Number(audit('cumulative-layout-shift').toFixed(3)),
      speed_index_ms: Math.round(audit('speed-index')),
      lcp_elemen: lhr.audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? null,
    };
  } finally {
    await chrome.kill();
  }
}

await mkdir(RESULTS, { recursive: true });
const results = { diukur: new Date().toISOString(), api: API, web: WEB };
console.log('Waktu respons API');
results.api_endpoint = await apiTimings();
console.log('Cek risiko');
results.cek_risiko = await riskTimings();
console.log('Rute aman');
results.rute = await routeTimings();
console.log('Lighthouse');
results.lighthouse = [await lighthouseRun('hp', undefined), await lighthouseRun('desktop', desktopConfig)];
for (const l of results.lighthouse) console.log(`  ${l.profil}: LCP ${l.lcp_ms} ms, skor ${JSON.stringify(l.skor)}`);
await writeFile(join(RESULTS, 'p6-kinerja.json'), `${JSON.stringify(results, null, 2)}\n`);
