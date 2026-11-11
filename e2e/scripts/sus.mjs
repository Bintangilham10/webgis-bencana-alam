// Uji pengguna (lapis 5 rencana pengujian Tugas 1): skor SUS dan keberhasilan tugas
// dari jawaban Google Form (tab Respons → Unduh CSV). Kriteria lulus di slide 17:
// n ≥ 15 responden, rata-rata SUS ≥ 68, tugas selesai ≥ 90%.
//
// Formulirnya ada di docs/pengujian/formulir-uji-pengguna.md. Kolom dikenali dari
// awalan judul pertanyaan: "S1." sampai "S10." untuk pernyataan SUS (skala 1–5) dan
// "T1 Hasil" sampai "T5 Hasil" untuk hasil tugas.
//
// Pakai (di e2e/): npm run sus -- jawaban.csv
// Ringkasannya juga ditulis ke hasil/lapis5-sus.md.
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv } from './csv.mjs';

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hasil');
const TARGET = { n: 15, sus: 68, tasks: 90 };
const TASKS = ['Cari kab/kota', 'Cek risiko lokasi', 'Baca level', 'Ganti lapisan', 'Cari nomor darurat'];
const PROFILE = ['Status', 'Usia', 'Perangkat'];
// Nilai t dua sisi 95% untuk derajat bebas 1–30; di atasnya 1,96.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

// Skor SUS satu responden (Brooke 1996): butir ganjil (pernyataan positif) nilai − 1,
// butir genap (negatif) 5 − nilai, jumlahnya × 2,5 → 0–100.
const susScore = (answers) => 2.5 * answers.reduce((sum, value, i) => sum + (i % 2 === 0 ? value - 1 : 5 - value), 0);

// "Berhasil sendiri" = selesai tanpa bantuan; hanya ini yang dihitung selesai.
function taskOutcome(text) {
  const t = text.toLowerCase();
  if (!t) return null;
  if (t.includes('tidak')) return 'gagal';
  if (t.includes('bantuan')) return 'bantuan';
  if (t.includes('berhasil')) return 'sendiri';
  return null;
}

function summarize(values) {
  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? (T95[n - 2] ?? 1.96) * (sd / Math.sqrt(n)) : 0;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, mean, sd, median, min: sorted[0], max: sorted[n - 1], ci: [mean - half, mean + half] };
}

const num = (x, d = 1) => x.toFixed(d).replace('.', ',');
const pct = (part, total) => (total ? (100 * part) / total : 0);
const mark = (ok) => (ok ? 'lulus' : 'belum');

function analyze({ columns, records }) {
  const susColumns = [];
  for (const name of columns) {
    const m = name.match(/^S(\d{1,2})\s*[.)]/);
    if (m) susColumns[Number(m[1]) - 1] = name;
  }
  const missing = Array.from({ length: 10 }, (_, i) => i).filter((i) => !susColumns[i]);
  if (missing.length) throw new Error(`Kolom SUS tidak lengkap: tidak ada ${missing.map((i) => `S${i + 1}.`).join(', ')}`);
  const taskColumns = TASKS.map((_, i) => columns.find((name) => new RegExp(`^T${i + 1}\\s+Hasil`, 'i').test(name)) ?? null);

  const scores = [];
  const skipped = [];
  const itemTotals = Array(10).fill(0);
  for (const [row, record] of records.entries()) {
    const answers = susColumns.map((name) => Number.parseInt(record[name], 10));
    if (answers.some((v) => !(v >= 1 && v <= 5))) {
      skipped.push(row + 2);
      continue;
    }
    answers.forEach((v, i) => (itemTotals[i] += v));
    scores.push(susScore(answers));
  }
  const tasks = taskColumns.map((name, i) => {
    const outcomes = name ? records.map((r) => taskOutcome(r[name])).filter(Boolean) : [];
    const count = (kind) => outcomes.filter((o) => o === kind).length;
    return { nomor: i + 1, tugas: `T${i + 1} ${TASKS[i]}`, n: outcomes.length, sendiri: count('sendiri'), bantuan: count('bantuan'), gagal: count('gagal') };
  });
  const profile = PROFILE.map((prefix) => {
    const name = columns.find((c) => c.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!name) return null;
    const counts = {};
    for (const r of records) if (r[name]) counts[r[name]] = (counts[r[name]] ?? 0) + 1;
    return { kolom: name, counts };
  }).filter(Boolean);
  return { scores, skipped, itemMeans: itemTotals.map((t) => (scores.length ? t / scores.length : 0)), tasks, profile };
}

function report({ scores, skipped, itemMeans, tasks, profile }, source) {
  if (!scores.length) throw new Error('Tidak ada jawaban SUS yang lengkap');
  const s = summarize(scores);
  const above = scores.filter((x) => x >= TARGET.sus).length;
  const attempts = tasks.reduce((n, t) => n + t.n, 0);
  const done = tasks.reduce((n, t) => n + t.sendiri, 0);
  const lines = [
    '# Hasil uji pengguna SIGAP Bencana',
    '',
    `Dihitung ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC dari \`${source}\` dengan \`e2e/scripts/sus.mjs\`.`,
    '',
    '| Ukuran | Target | Hasil | Status |',
    '|---|---|---|---|',
    `| Responden | ≥ ${TARGET.n} | ${s.n} | ${mark(s.n >= TARGET.n)} |`,
    `| Skor SUS rata-rata | ≥ ${TARGET.sus} | ${num(s.mean)} (IK 95% ${num(s.ci[0])}–${num(s.ci[1])}) | ${mark(s.mean >= TARGET.sus)} |`,
    `| Tugas selesai tanpa bantuan | ≥ ${TARGET.tasks}% | ${attempts ? `${num(pct(done, attempts))}% (${done} dari ${attempts})` : 'tidak ada data tugas'} | ${attempts ? mark(pct(done, attempts) >= TARGET.tasks) : '–'} |`,
    '',
    `Skor SUS: median ${num(s.median)}, simpangan baku ${num(s.sd)}, rentang ${num(s.min)}–${num(s.max)}; ${above} dari ${s.n} responden (${num(pct(above, s.n), 0)}%) memberi skor ≥ ${TARGET.sus}.`,
  ];
  if (skipped.length) lines.push('', `Baris yang tidak dihitung untuk skor SUS karena jawabannya tidak lengkap: ${skipped.join(', ')} (hasil tugasnya tetap dihitung).`);
  lines.push('', '## Keberhasilan tugas', '', '| Tugas | n | Berhasil sendiri | Dengan bantuan | Tidak berhasil |', '|---|---|---|---|---|');
  for (const t of tasks) {
    lines.push(t.n ? `| ${t.tugas} | ${t.n} | ${t.sendiri} (${num(pct(t.sendiri, t.n), 0)}%) | ${t.bantuan} | ${t.gagal} |` : `| ${t.tugas} | 0 | tidak ada jawaban di kolom "T${t.nomor} Hasil" | | |`);
  }
  lines.push('', '## Rata-rata tiap pernyataan SUS (1–5)', '', 'Butir ganjil bernada positif (makin tinggi makin baik), butir genap bernada negatif (makin rendah makin baik).', '', '| Butir | Rata-rata |', '|---|---|');
  itemMeans.forEach((m, i) => lines.push(`| S${i + 1} | ${num(m, 2)} |`));
  if (profile.length) {
    lines.push('', '## Profil responden', '');
    for (const p of profile) lines.push(`- ${p.kolom}: ${Object.entries(p.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

const path = process.argv[2];
if (!path) {
  console.error('Pakai: npm run sus -- jawaban.csv');
  process.exit(1);
}
const text = report(analyze(await readCsv(path)), basename(path));
await mkdir(RESULTS, { recursive: true });
await writeFile(join(RESULTS, 'lapis5-sus.md'), text);
console.log(text);
