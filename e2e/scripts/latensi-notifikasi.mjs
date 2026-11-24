// Latensi notifikasi langsung (SSE): berapa lama dari notifikasi dibuat di server
// sampai tiba di klien, diukur pada notifikasi sungguhan (gempa BMKG, perubahan
// level gunung api, peringatan dini cuaca BMKG).
//
// Dua jeda dicatat terpisah untuk tiap notifikasi:
// - latensi kirim (latensi_ms) = waktu tiba di klien − created_at (saat server
//   menyimpan lalu menyiarkannya). Inilah bagian yang dikerjakan SIGAP sesudah
//   notifikasinya ada.
// - jeda sejak waktu sumber (jeda_sumber_s) = created_at − waktu sumber (waktu gempa
//   terjadi, waktu BMKG menerbitkan peringatan). Di dalamnya ada jeda sumber
//   menerbitkan datanya dan selang SIGAP memeriksa sumber itu (gempa tiap 1 menit,
//   peringatan cuaca tiap 5 menit). Untuk gunung api "waktu sumber" adalah saat
//   SIGAP sendiri melihat perubahan level di MAGMA, jadi tidak diringkas.
//
// Jam klien dan server tidak persis sama, jadi selisihnya diukur dulu ke /api/time
// (tujuh kali bolak-balik, dipakai yang paling cepat), lalu diulang tiap 5 menit dan
// tiap kali menyambung lagi. Ketidakpastiannya paling besar setengah waktu
// bolak-balik itu.
//
// Yang dihitung hanya notifikasi yang dibuat sesudah sambungan terbuka. Yang lain
// tetap dicatat (langsung = false) tetapi tidak masuk ringkasan:
// - kiriman ulang setelah sambungan putus;
// - notifikasi yang dibuat selagi perekam terhenti (laptop tidur): selisihnya adalah
//   lama tidur laptop, bukan latensi sistem.
//
// Pakai (di e2e/):
//   npm run latensi -- --api https://alamat-server --menit 120
//   npm run latensi -- --ringkas                 # hitung ulang ringkasan dari CSV
// Tiap jalan menambah baris ke hasil/latensi-notifikasi.csv; ringkasannya ditulis
// ke hasil/latensi-notifikasi.md. Ctrl+C menghentikan perekaman dan tetap menulis
// ringkasan.
//
// Untuk data riset: `npm run latensi:server -- --menit 1440` merekam server produksi
// ke research/results/latensi_notifikasi.csv (ikut dikomit, karena rekaman kejadian
// nyata tidak bisa diulang).
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsv } from './csv.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

// --csv mengganti berkas rekaman (bawaan hasil/latensi-notifikasi.csv); ringkasannya
// ditulis di sebelahnya dengan akhiran .md.
const CSV = arg('csv', join(dirname(fileURLToPath(import.meta.url)), '..', 'hasil', 'latensi-notifikasi.csv'));
const SUMMARY = `${CSV.endsWith('.csv') ? CSV.slice(0, -4) : CSV}.md`;
const COLUMNS = ['diterima_utc', 'server', 'id', 'jenis', 'level', 'dibuat_utc', 'sumber_utc', 'latensi_ms', 'jeda_sumber_s', 'selisih_jam_ms', 'rtt_ms', 'langsung'];
const CLOCK_SAMPLES = 7;
const CLOCK_EVERY_MS = 5 * 60_000;
const RECONNECT_MS = 10_000;
const TICK_MS = 1000;
const SUSPEND_GAP_MS = 5000;
// Batas setTimeout Node adalah ±24,8 hari.
const MAX_MINUTES = 21 * 24 * 60;

// Jam dinding beresolusi tinggi yang tidak ikut melompat bila jam sistem dikoreksi.
const now = () => performance.timeOrigin + performance.now();
const iso = (ms) => new Date(ms).toISOString();

// Satu blok SSE (baris-baris sampai baris kosong) → event, atau null bila tanpa data
// (komentar ": ping", baris "retry:").
function parseBlock(block) {
  const event = { id: null, event: 'message', data: [] };
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'data') event.data.push(value);
    else if (field === 'id' || field === 'event') event[field] = value;
  }
  return event.data.length ? { ...event, data: event.data.join('\n') } : null;
}

// Potongan teks SSE → event yang sudah lengkap, dan sisa yang belum berakhir baris kosong.
export function parseSse(buffer) {
  const blocks = buffer.replaceAll('\r\n', '\n').split('\n\n');
  const rest = blocks.pop();
  return { events: blocks.map(parseBlock).filter(Boolean), rest };
}

// Selisih jam server − klien dari beberapa bolak-balik: yang paling cepat paling tepat.
export function clockOffset(samples) {
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  return { offset: best.serverMs - (best.sent + best.received) / 2, rtt: best.rtt };
}

async function clockSample(api) {
  const sent = now();
  const res = await fetch(`${api}/api/time`, { cache: 'no-store' }).catch((err) => {
    throw new Error(`${api} tidak terjangkau (${err.cause?.code ?? err.cause?.message ?? err.message})`);
  });
  if (!res.ok) throw new Error(`${api}/api/time menjawab HTTP ${res.status}. Server perlu versi yang punya /api/time.`);
  const { time } = await res.json();
  const received = now();
  return { sent, received, rtt: received - sent, serverMs: Date.parse(time) };
}

// Bolak-balik dilakukan satu per satu supaya tidak saling memperlambat.
async function measureClock(api, samples = []) {
  if (samples.length === CLOCK_SAMPLES) return clockOffset(samples);
  return measureClock(api, [...samples, await clockSample(api)]);
}

// Satu notifikasi yang diterima → satu baris CSV. `liveSinceMs` = jam klien saat
// perekam mulai mendengarkan (sambungan terbuka, atau bangun dari tidur); `stale` =
// selisih jam belum diukur ulang sesudah perekam terhenti.
export function toRow({ notification, receivedMs, clock, liveSinceMs, server, stale = false }) {
  const created = Date.parse(notification.created_at);
  const source = notification.source_time ? Date.parse(notification.source_time) : null;
  return {
    diterima_utc: iso(receivedMs),
    server,
    id: notification.id,
    jenis: notification.kind,
    level: notification.level,
    dibuat_utc: notification.created_at,
    sumber_utc: notification.source_time ?? '',
    latensi_ms: (receivedMs + clock.offset - created).toFixed(1),
    jeda_sumber_s: source === null ? '' : ((created - source) / 1000).toFixed(1),
    selisih_jam_ms: clock.offset.toFixed(1),
    rtt_ms: clock.rtt.toFixed(1),
    langsung: !stale && created >= liveSinceMs + clock.offset,
  };
}

// Persentil cara peringkat terdekat (nearest rank).
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
const stats = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return { n: sorted.length, min: sorted[0], p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), p95: quantile(sorted, 0.95), maks: sorted.at(-1) };
};
const statsOrNull = (values) => (values.length ? stats(values) : null);
const isLive = (r) => String(r.langsung) === 'true';

// Jenis yang waktu sumbernya berasal dari sumbernya: waktu gempa terjadi dan waktu
// BMKG menerbitkan peringatan. MAGMA tidak mencantumkan waktu penetapan level, jadi
// untuk gunung api yang tercatat adalah saat SIGAP melihat perubahannya.
const HAS_SOURCE_TIME = new Set(['gempa', 'cuaca']);

function sourceDelays(rows) {
  const values = rows.filter((r) => r.jeda_sumber_s !== '').map((r) => Number(r.jeda_sumber_s));
  return { valid: values.filter((v) => v >= 0), negatif: values.filter((v) => v < 0).length };
}

function summarizeKind(jenis, live) {
  const of = live.filter((r) => r.jenis === jenis);
  const source = HAS_SOURCE_TIME.has(jenis) ? sourceDelays(of) : { valid: [], negatif: 0 };
  return { jenis, n: of.length, latensi_ms: statsOrNull(of.map((r) => Number(r.latensi_ms))), jeda_sumber_s: statsOrNull(source.valid), sumber_negatif: source.negatif };
}

// Notifikasi yang sama (id dan created_at sama) dihitung sekali walau terekam dua
// kali, mis. oleh dua perekam yang berjalan bersamaan. Baris langsung didahulukan.
function unique(rows) {
  const kept = new Map();
  for (const r of rows) {
    const key = `${r.id}|${r.dibuat_utc}`;
    const first = kept.get(key);
    if (!first || (!isLive(first) && isLive(r))) kept.set(key, r);
  }
  return [...kept.values()];
}

function summarizeServer(server, recorded) {
  const rows = unique(recorded);
  const live = rows.filter(isLive);
  const latency = live.map((r) => Number(r.latensi_ms));
  const times = rows.map((r) => r.diterima_utc).toSorted((a, b) => a.localeCompare(b));
  const kinds = [...new Set(rows.map((r) => r.jenis))].toSorted((a, b) => a.localeCompare(b));
  const perKind = kinds.map((jenis) => summarizeKind(jenis, live));
  return {
    server,
    dari: times[0],
    sampai: times.at(-1),
    diterima: rows.length,
    duplikat: recorded.length - rows.length,
    tidak_langsung: rows.length - live.length,
    // Peringatan cuaca datang berombongan tiap sinkronisasi; satu rombongan = satu detik created_at.
    rombongan: new Set(live.map((r) => r.dibuat_utc.slice(0, 19))).size,
    latensi_ms: statsOrNull(latency),
    negatif: latency.filter((v) => v < 0).length,
    sumber_negatif: perKind.reduce((sum, k) => sum + k.sumber_negatif, 0),
    ketidakpastian_jam_ms: live.length ? Math.max(...live.map((r) => Number(r.rtt_ms))) / 2 : null,
    per_jenis: perKind,
  };
}

// Ringkasan per server dari baris CSV (nilai berupa teks).
export function summarize(records) {
  const servers = new Map();
  for (const r of records) {
    if (!servers.has(r.server)) servers.set(r.server, []);
    servers.get(r.server).push(r);
  }
  return [...servers].map(([server, rows]) => summarizeServer(server, rows));
}

const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2).replace('.', ',')} detik` : `${Math.round(v)} ms`);
const minutes = (seconds) => `${(seconds / 60).toFixed(1).replace('.', ',')} menit`;
const KIND = { gempa: 'Gempa BMKG', gunung_api: 'Level gunung api', cuaca: 'Peringatan dini cuaca BMKG' };

function kindLine(k) {
  const source = k.jeda_sumber_s;
  return `| ${KIND[k.jenis] ?? k.jenis} | ${k.n} | ${ms(k.latensi_ms.p50)} | ${source ? minutes(source.p50) : '—'} | ${source ? minutes(source.p90) : '—'} |`;
}

function notes(s) {
  const lines = [];
  if (s.negatif) lines.push(`Catatan: ${s.negatif} latensi bernilai negatif, lebih kecil dari ketidakpastian jam; artinya latensinya di bawah ketelitian ukur.`);
  if (s.duplikat) lines.push(`Catatan: ${s.duplikat} baris rekaman ganda (notifikasi yang sama terekam dua kali) dihitung sekali.`);
  if (s.sumber_negatif) lines.push(`Catatan: ${s.sumber_negatif} notifikasi punya waktu sumber yang lebih baru daripada waktu simpannya; jeda sejak waktu sumbernya tidak dihitung.`);
  return lines.flatMap((line) => [line, '']);
}

function serverLines(s) {
  const head = [`## ${s.server}`, '', `Direkam ${s.dari} sampai ${s.sampai}.`, ''];
  if (!s.latensi_ms) return [...head, `Belum ada notifikasi langsung (${s.diterima} diterima, tidak ada yang dibuat selagi perekam mendengarkan).`, ''];
  const l = s.latensi_ms;
  return [
    ...head,
    '| Hal | Nilai |', '|---|---|',
    `| Notifikasi langsung | ${l.n} (dalam ${s.rombongan} kali siaran) |`,
    `| Tidak dihitung (kiriman ulang setelah sambungan putus, atau dibuat selagi perekam terhenti) | ${s.tidak_langsung} |`,
    `| Latensi kirim, median | ${ms(l.p50)} |`,
    `| Latensi kirim, persentil ke-90 | ${ms(l.p90)} |`,
    `| Latensi kirim, persentil ke-95 | ${ms(l.p95)} |`,
    `| Latensi kirim, tercepat dan terlama | ${ms(l.min)} dan ${ms(l.maks)} |`,
    `| Ketidakpastian jam klien–server | paling besar ±${ms(s.ketidakpastian_jam_ms)} |`,
    '',
    ...notes(s),
    '| Jenis | Notifikasi | Latensi kirim, median | Sejak waktu sumber, median | Sejak waktu sumber, persentil ke-90 |', '|---|---|---|---|---|',
    ...s.per_jenis.filter((k) => k.n).map(kindLine),
    '',
  ];
}

export function report(summaries, recording = 'latensi-notifikasi.csv') {
  return [
    '# Latensi notifikasi langsung', '', `Dibuat oleh \`e2e/scripts/latensi-notifikasi.mjs\` dari berkas rekamannya, \`${recording}\`.`, '',
    ...summaries.flatMap(serverLines),
    'Latensi kirim dihitung dari saat server menyimpan notifikasi sampai datanya tiba di klien perekam; waktu menggambar notifikasi di layar tidak termasuk. Persentil memakai cara peringkat terdekat.',
    '',
    'Jeda sejak waktu sumber dihitung dari waktu yang dicantumkan sumber (waktu gempa terjadi, waktu BMKG menerbitkan peringatan) sampai server menyimpan notifikasinya. Di dalamnya ada jeda sumber menerbitkan datanya dan selang SIGAP memeriksa sumber itu (gempa tiap 1 menit, peringatan cuaca tiap 5 menit). Untuk gunung api tidak dihitung: MAGMA tidak mencantumkan waktu penetapan level, jadi yang tercatat adalah saat SIGAP melihat perubahannya.',
    '',
  ].join('\n');
}

async function writeSummary() {
  if (!existsSync(CSV)) {
    console.log(`Belum ada ${CSV}.`);
    return;
  }
  const text = report(summarize(parseCsv(await readFile(CSV, 'utf8')).records), basename(CSV));
  await writeFile(SUMMARY, text);
  console.log(`\n${text}`);
}

// Satu sambungan SSE sampai putus atau dihentikan; onChunk dipanggil untuk tiap
// potongan yang tiba, juga yang hanya berisi ": ping".
async function readStream(api, lastId, signal, onChunk) {
  const headers = { Accept: 'text/event-stream' };
  if (lastId !== null) headers['Last-Event-ID'] = String(lastId);
  const res = await fetch(`${api}/api/stream`, { headers, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const openedMs = now();
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    const receivedMs = now();
    const parsed = parseSse(buffer + decoder.decode(chunk, { stream: true }));
    buffer = parsed.rest;
    const notifications = parsed.events.filter((e) => e.event === 'notification').map((e) => JSON.parse(e.data));
    await onChunk(notifications, receivedMs, openedMs);
  }
}

// Keadaan satu kali perekaman: selisih jam yang sedang dipakai, kapan perekam terakhir
// bangun dari tidur, dan notifikasi yang sudah dicatat. `measure`, `wallClock`,
// `monotonic`, dan `warn` bisa diganti saat test.
export function createRecorder({ server, clock, measure, wallClock = Date.now, monotonic = now, warn = console.error }) {
  const state = { clock, stale: false, epoch: 0, resumedMs: -Infinity, lastTick: wallClock(), lastId: null, seen: new Set(), received: 0 };

  const refreshClock = async () => {
    const epoch = state.epoch;
    try {
      const measured = await measure();
      // Hasil ukur yang dimulai sebelum perekam terhenti tidak dipakai.
      if (epoch !== state.epoch) return;
      state.clock = measured;
      state.stale = false;
    } catch (err) {
      warn(`Jam server tidak terukur: ${err.message}`);
    }
  };

  // Laptop yang tidur menghentikan proses ini, dan notifikasi yang dibuat selama itu
  // baru terbaca saat bangun. Jam sistem yang melompat lebih dari SUSPEND_GAP_MS di
  // antara dua detak menandainya: yang dibuat sebelum saat bangun diperlakukan seperti
  // kiriman ulang, dan selisih jam diukur lagi (jam penghitung bisa ikut berhenti).
  // Mengembalikan pengukuran ulang yang sedang berjalan, atau null bila tidak terhenti.
  const checkSuspend = () => {
    const wall = wallClock();
    const gap = wall - state.lastTick;
    state.lastTick = wall;
    if (gap < SUSPEND_GAP_MS) return null;
    state.epoch++;
    state.stale = true;
    state.resumedMs = monotonic();
    warn(`Perekam terhenti ±${Math.round(gap / 1000)} detik (laptop tidur?). Notifikasi yang dibuat selama itu tidak dihitung.`);
    return refreshClock();
  };

  // Notifikasi dari satu potongan aliran → baris yang perlu dicatat. Saat menyambung
  // lagi, server bisa mengirim notifikasi yang sama dua kali (langsung dan sebagai
  // kiriman ulang); yang kedua dilewati.
  const accept = (notifications, receivedMs, openedMs) => {
    void checkSuspend();
    const key = (n) => `${n.id}|${n.created_at}`;
    const fresh = notifications.filter((n) => !state.seen.has(key(n)));
    if (!fresh.length) return [];
    for (const n of fresh) state.seen.add(key(n));
    state.lastId = Math.max(state.lastId ?? 0, ...fresh.map((n) => n.id));
    state.received += fresh.length;
    const liveSinceMs = Math.max(openedMs, state.resumedMs);
    return fresh.map((notification) => toRow({ notification, receivedMs, clock: state.clock, liveSinceMs, server, stale: state.stale }));
  };

  return { state, refreshClock, checkSuspend, accept };
}

// Sambungan dibuka satu per satu: bila putus, tunggu sebentar, ukur jam lagi, lalu sambung lagi.
async function keepConnected(api, recorder, save, signal) {
  if (signal.aborted) return;
  try {
    await readStream(api, recorder.state.lastId, signal, save);
    if (!signal.aborted) console.error(`Sambungan ditutup server; menyambung lagi ${RECONNECT_MS / 1000} detik lagi.`);
  } catch (err) {
    if (!signal.aborted) console.error(`Sambungan putus (${err.message}); menyambung lagi ${RECONNECT_MS / 1000} detik lagi.`);
  }
  if (signal.aborted) return;
  await delay(RECONNECT_MS, undefined, { signal }).catch(() => {});
  if (signal.aborted) return;
  await recorder.refreshClock();
  await keepConnected(api, recorder, save, signal);
}

async function record(api, minutesToRun) {
  // Jam diukur dulu: bila server tidak terjangkau, tidak ada berkas yang dibuat.
  const measure = () => measureClock(api);
  const recorder = createRecorder({ server: new URL(api).host, clock: await measure(), measure });
  await mkdir(dirname(CSV), { recursive: true });
  if (!existsSync(CSV)) await writeFile(CSV, `${COLUMNS.join(',')}\n`);
  const { clock } = recorder.state;
  console.log(`Selisih jam server − klien ${clock.offset.toFixed(0)} ms (bolak-balik ${clock.rtt.toFixed(0)} ms). Merekam ${minutesToRun} menit dari ${api} …`);
  const refresh = setInterval(recorder.refreshClock, CLOCK_EVERY_MS);
  const tick = setInterval(recorder.checkSuspend, TICK_MS);
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), minutesToRun * 60_000);
  process.once('SIGINT', () => stop.abort());

  const save = async (notifications, receivedMs, openedMs) => {
    const rows = recorder.accept(notifications, receivedMs, openedMs);
    if (!rows.length) return;
    await appendFile(CSV, rows.map((row) => `${COLUMNS.map((c) => row[c]).join(',')}\n`).join(''));
    for (const row of rows) {
      const result = row.langsung ? `${row.latensi_ms} ms` : 'tidak dihitung';
      console.log(`  ${row.diterima_utc.slice(11, 19)} ${row.jenis} #${row.id}: ${result}`);
    }
  };
  await keepConnected(api, recorder, save, stop.signal);
  clearTimeout(timer);
  clearInterval(refresh);
  clearInterval(tick);
  console.log(`${recorder.state.received} notifikasi diterima.`);
}

async function main() {
  if (!process.argv.includes('--ringkas')) {
    const api = new URL(arg('api', process.env.SIGAP_API ?? 'http://localhost:3000')).origin;
    const minutesToRun = Number(arg('menit', 60));
    if (!(minutesToRun > 0 && minutesToRun <= MAX_MINUTES)) throw new Error(`--menit harus angka lebih dari 0 dan paling banyak ${MAX_MINUTES} (21 hari)`);
    await record(api, minutesToRun);
  }
  await writeSummary();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (err) {
    console.error(`Gagal: ${err.message}`);
    process.exitCode = 1;
  }
}
