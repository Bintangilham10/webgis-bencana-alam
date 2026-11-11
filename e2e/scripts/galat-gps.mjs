// L1 akurasi posisi (rencana pengujian Tugas 1): jarak antara koordinat "Lokasi saya"
// di SIGAP dan koordinat titik acuan luar ruang. Kriteria lulus: galat ≤ 50 m.
//
// Masukan CSV dengan kolom: perangkat, titik, lat_acuan, lon_acuan, lat_sigap,
// lon_sigap, dan boleh ditambah akurasi_m (angka "akurasi ±… m" di chip pantau
// posisi). Templatnya docs/pengujian/templat-galat-gps.csv; caranya di
// docs/pengujian/uji-lokasi-dan-perangkat.md.
//
// Pakai (di e2e/): npm run gps -- pengukuran.csv
// Ringkasannya juga ditulis ke hasil/l1-galat-gps.md.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv } from './csv.mjs';

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hasil');
const LIMIT_M = 50;
const R = 6_371_008.8;

function haversineM(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Koma desimal (gaya Indonesia di spreadsheet) diterima juga.
const number = (text) => Number.parseFloat(String(text ?? '').replace(',', '.'));
const num = (x, d = 1) => x.toFixed(d).replace('.', ',');

const path = process.argv[2];
if (!path) {
  console.error('Pakai: npm run gps -- pengukuran.csv');
  process.exit(1);
}
const { columns, records } = await readCsv(path);
const required = ['perangkat', 'titik', 'lat_acuan', 'lon_acuan', 'lat_sigap', 'lon_sigap'];
const missing = required.filter((c) => !columns.includes(c));
if (missing.length) throw new Error(`Kolom tidak ada: ${missing.join(', ')}`);
if (!records.length) throw new Error('Belum ada baris pengukuran di CSV');

const rows = records.map((r) => {
  const values = ['lat_acuan', 'lon_acuan', 'lat_sigap', 'lon_sigap'].map((c) => number(r[c]));
  if (values.some((v) => !Number.isFinite(v))) throw new Error(`Koordinat tidak valid untuk ${r.perangkat} / ${r.titik}`);
  const error = haversineM(...values);
  return { perangkat: r.perangkat, titik: r.titik, galat: error, akurasi: number(r.akurasi_m), lulus: error <= LIMIT_M };
});

const lines = ['# L1 Akurasi posisi pengguna', '', `Galat = jarak ke titik acuan; lulus bila ≤ ${LIMIT_M} m.`, '', '| Perangkat | Titik | Galat (m) | Akurasi yang dilaporkan (m) | Status |', '|---|---|---|---|---|'];
for (const r of rows) lines.push(`| ${r.perangkat} | ${r.titik} | ${num(r.galat)} | ${Number.isFinite(r.akurasi) ? num(r.akurasi, 0) : '–'} | ${r.lulus ? 'lulus' : 'tidak'} |`);
lines.push('', '| Perangkat | Titik diuji | Median galat (m) | Galat terbesar (m) | Lulus |', '|---|---|---|---|---|');
for (const device of [...new Set(rows.map((r) => r.perangkat))]) {
  const own = rows.filter((r) => r.perangkat === device);
  const sorted = own.map((r) => r.galat).sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  lines.push(`| ${device} | ${own.length} | ${num(median)} | ${num(sorted.at(-1))} | ${own.filter((r) => r.lulus).length} dari ${own.length} |`);
}
const text = `${lines.join('\n')}\n`;
await mkdir(RESULTS, { recursive: true });
await writeFile(join(RESULTS, 'l1-galat-gps.md'), text);
console.log(text);
