import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { HttpError } from '../src/lib/http.js';
import { MODEL_META_URL, rainBatchUrl } from '../src/lib/open-meteo-hujan.js';
import { createArchive } from '../src/lib/store.js';
import { RULES_VERSION } from '../src/lib/warning-rules.js';
import { BUDGET_MS, MAX_RUNS, recordSigapIndikasi, SETTLE_MS } from '../src/sources/sigap-indikasi.js';

// Siklus ECMWF 00Z 1 Okt 2026, tersedia 06:32 UTC (nilai asli meta.json Open-Meteo),
// siklus 18Z sebelumnya, serta siklus 06Z dan 12Z berikutnya (tersedia ±6,5 jam setelah inisialisasi).
const META_00Z = { last_run_initialisation_time: 1790812800, last_run_availability_time: 1790836340 };
const META_18Z_LALU = { last_run_initialisation_time: 1790791200, last_run_availability_time: 1790814740 };
const META_06Z = { last_run_initialisation_time: 1790834400, last_run_availability_time: 1790857940 };
const META_12Z = { last_run_initialisation_time: 1790856000, last_run_availability_time: 1790879540 };
const PAST = ['2026-09-28', '2026-09-29', '2026-09-30'];
const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];

// Kabupaten Uji: titik acuan dan satu titik zona longsor tinggi (hujan 120 mm pada
// 2 Okt). Kota Kering: hanya titik acuan, hujan sedikit.
const TITIK = [
  { kode: '99.01', hazard: 'acuan', urutan: 1, kelas: 0, lat: -7, lon: 107 },
  { kode: '99.01', hazard: 'longsor', urutan: 1, kelas: 3, lat: -7.1, lon: 107.2 },
  { kode: '99.02', hazard: 'acuan', urutan: 1, kelas: 0, lat: -8, lon: 111 },
];
const RAIN = {
  '-7.000,107.000': [0, 0, 0, 10, 20, 5, 0],
  '-7.100,107.200': [10, 20, 30, 40, 120, 10, 0],
  '-8.000,111.000': [0, 0, 0, 2, 3, 1, 0],
};
// 100 titik tambahan (Kabupaten Banyak) supaya hujan diminta dalam dua permintaan:
// [Uji acuan, Uji longsor, Banyak × 98] lalu [Banyak × 2, Kota Kering].
const BANYAK = Array.from({ length: 100 }, (_, i) => ({ kode: '99.03', hazard: 'acuan', urutan: i + 1, kelas: 0, lat: -9 - i / 100, lon: 120 }));
for (const point of BANYAK) RAIN[`${point.lat.toFixed(3)},${point.lon.toFixed(3)}`] = [0, 0, 0, 1, 1, 1, 1];
const TITIK_BANYAK = [TITIK[0], TITIK[1], ...BANYAK, TITIK[2]];
const KERING = '-8.000,111.000';

const keysOf = (url) => {
  const params = new URL(url).searchParams;
  const lons = params.get('longitude').split(',');
  return params.get('latitude').split(',').map((lat, i) => `${Number(lat).toFixed(3)},${Number(lons[i]).toFixed(3)}`);
};

// meta: objek atau fungsi (nomor panggilan meta → objek). failKeys: permintaan yang
// memuat salah satu kunci ini gagal (HTTP 502). onRain: dipanggil tiap permintaan hujan.
function fakeHttp({ meta = META_00Z, failKeys = new Set(), onRain = () => {} } = {}) {
  const calls = [];
  let metaCalls = 0;
  const fetchJson = async (url) => {
    calls.push(url);
    if (url === MODEL_META_URL) return typeof meta === 'function' ? meta(metaCalls++) : meta;
    const keys = keysOf(url);
    onRain(keys);
    if (keys.some((key) => failKeys.has(key))) throw new HttpError(url, 502);
    const replies = keys.map((key) => ({ daily: { time: [...PAST, ...DAYS], precipitation_sum: RAIN[key] } }));
    return replies.length === 1 ? replies[0] : replies;
  };
  return { calls, fetchJson, rainCalls: () => calls.filter((u) => u !== MODEL_META_URL) };
}

let tmpDir;
let archive;
beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sigap-indikasi-'));
  archive = createArchive(tmpDir);
});
afterEach(() => rm(tmpDir, { recursive: true, force: true }));

// Run pertama yang boleh mengambil hujan: lebih dari SETTLE_MS setelah 00Z tersedia.
const NOW = '2026-10-01T07:30:00.000Z';
const LATER = '2026-10-01T07:45:00.000Z';
const record = (http, { titik = TITIK, now = NOW, clock } = {}) =>
  recordSigapIndikasi({ archive, http, now, data: { titikPantau: titik }, ...(clock ? { clock } : {}) });
const readCycle = (file = 'sigap-indikasi/2026/10/01/00Z.json') => archive.readJson(file);

describe('arsip indikasi SIGAP per siklus model', () => {
  test('hujan diminta dari ECMWF IFS secara eksplisit, 3 hari lalu dan 4 hari ke depan', () => {
    const url = new URL(rainBatchUrl([{ lat: -7, lon: 107 }]));
    assert.equal(url.searchParams.get('models'), 'ecmwf_ifs');
    assert.equal(url.searchParams.get('past_days'), '3');
    assert.equal(url.searchParams.get('forecast_days'), '4');
  });

  test('siklus baru direkam: level per kab/kota per hari, hujan per titik, dan jejak versinya', async () => {
    const result = await record(fakeHttp());
    assert.deepEqual(result, { items: 2, new: 1, errors: [] });

    const cycle = await readCycle();
    assert.equal(cycle.model, 'ecmwf_ifs');
    assert.equal(cycle.model_init, '2026-10-01T00:00:00.000Z');
    assert.equal(cycle.model_available, '2026-10-01T06:32:20.000Z');
    assert.equal(cycle.runs, 1);
    assert.equal(cycle.locations_missing, 0);
    assert.equal(cycle.rules_version, RULES_VERSION);
    assert.match(cycle.rules_sha256, /^[0-9a-f]{64}$/);
    assert.equal(cycle.titik_pantau.count, 3);
    assert.deepEqual(cycle.dates, DAYS);
    assert.deepEqual(cycle.hujan_kolom, ['lat', 'lon', ...PAST, ...DAYS]);

    const uji = cycle.wilayah.find((w) => w.kode === '99.01');
    // 1 Okt: akumulasi 3 hari 90 mm, belum 100 mm. 2 Okt: 120 mm di zona tinggi =
    // sangat lebat × tinggi = Siaga. 3–4 Okt: akumulasi 170 dan 130 mm = Waspada.
    assert.deepEqual(uji.longsor, [0, 2, 1, 1]);
    assert.deepEqual(uji.hujan, [0, 2, 0, 0]);
    // Tanpa titik zona banjir: Normal, bukan tanpa data.
    assert.deepEqual(uji.banjir, [0, 0, 0, 0]);
    assert.deepEqual(cycle.counts['2026-10-02'], { normal: 1, waspada: 0, siaga: 1, awas: 0, tanpa_data: 0 });

    const rows = (await archive.readText('sigap-indikasi/2026/10/01/00Z-hujan.jsonl')).trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.find((r) => r[0] === -7.1), [-7.1, 107.2, ...RAIN['-7.100,107.200']]);

    const status = await archive.readJson('sigap-indikasi/status.json');
    assert.equal(status.last_init, '2026-10-01T00:00:00.000Z');
    assert.equal(await archive.readText('sigap-indikasi/pending.json'), null);
  });

  test('siklus yang sama tidak direkam dua kali', async () => {
    await record(fakeHttp());
    const http = fakeHttp();
    const again = await record(http, { now: LATER });
    assert.match(again.skipped, /sudah direkam/);
    assert.deepEqual(http.calls, [MODEL_META_URL]);
  });

  test('jatah waktu habis: hujan dicicil dan run berikutnya hanya meminta titik yang belum ada', async () => {
    // Jam palsu: tiap permintaan hujan memakan seluruh jatah waktu run.
    let now = 0;
    const clock = () => now;
    const http = fakeHttp({ onRain: () => (now += BUDGET_MS) });
    const first = await record(http, { titik: TITIK_BANYAK, clock });
    assert.equal(first.new, 0);
    assert.equal(first.items, 100);
    assert.match(first.errors.at(-1), /100\/103 titik hujan, 3 menunggu jatah waktu run berikutnya; dilanjutkan di run berikutnya \(1\/6\)/);
    const pending = await archive.readJson('sigap-indikasi/pending.json');
    assert.equal(Object.keys(pending.hujan).length, 100);

    const http2 = fakeHttp({ onRain: () => (now += BUDGET_MS) });
    now = 10 * BUDGET_MS;
    const second = await record(http2, { titik: TITIK_BANYAK, clock, now: LATER });
    assert.equal(second.new, 1);
    assert.deepEqual(keysOf(http2.rainCalls()[0]).length, 3);
    const cycle = await readCycle();
    assert.equal(cycle.runs, 2);
    assert.equal(cycle.locations_missing, 0);
    assert.equal(cycle.first_fetched_at, NOW);
    assert.deepEqual(cycle.wilayah.find((w) => w.kode === '99.01').longsor, [0, 2, 1, 1]);
    assert.equal(await archive.readText('sigap-indikasi/pending.json'), null);
  });

  test('titik yang gagal diambil ulang di run berikutnya', async () => {
    const first = await record(fakeHttp({ failKeys: new Set([KERING]) }), { titik: TITIK_BANYAK });
    assert.equal(first.new, 0);
    assert.match(first.errors[0], /3 titik gagal diambil \(HTTP 502/);

    const second = await record(fakeHttp(), { titik: TITIK_BANYAK, now: LATER });
    assert.equal(second.new, 1);
    const cycle = await readCycle();
    assert.equal(cycle.locations_missing, 0);
    assert.deepEqual(cycle.wilayah.find((w) => w.kode === '99.02').hujan, [0, 0, 0, 0]);
  });

  test(`setelah ${MAX_RUNS} run masih ada titik gagal: siklus disimpan dengan titik tanpa hujan`, async () => {
    const http = fakeHttp({ failKeys: new Set([KERING]) });
    let result;
    for (let i = 0; i < MAX_RUNS; i++) result = await record(http, { titik: TITIK_BANYAK });
    assert.equal(result.new, 1);
    const cycle = await readCycle();
    assert.equal(cycle.runs, MAX_RUNS);
    assert.equal(cycle.locations_missing, 3);
    assert.deepEqual(cycle.wilayah.find((w) => w.kode === '99.02').hujan, [null, null, null, null]);
    assert.deepEqual(cycle.counts['2026-10-01'].tanpa_data, 1);
  });

  test('siklus baru terbit sebelum siklus lama lengkap: siklus lama disimpan apa adanya', async () => {
    await record(fakeHttp({ failKeys: new Set([KERING]) }), { titik: TITIK_BANYAK });
    const result = await record(fakeHttp({ meta: META_12Z }), { titik: TITIK_BANYAK, now: '2026-10-01T19:30:00.000Z' });
    assert.equal(result.new, 2);
    assert.match(result.errors[0], /siklus 2026-10-01T00:00:00.000Z disimpan dengan 3 titik tanpa hujan karena siklus baru terbit/);
    assert.equal((await readCycle()).locations_missing, 3);
    const late = await readCycle('sigap-indikasi/2026/10/01/12Z.json');
    assert.equal(late.model_init, '2026-10-01T12:00:00.000Z');
    assert.equal(late.locations_missing, 0);
  });

  test('model berganti saat hujan diambil: hujan run itu dibuang', async () => {
    const http = fakeHttp({ meta: (n) => (n === 0 ? META_00Z : META_12Z) });
    const result = await record(http);
    assert.equal(result.new, 0);
    assert.match(result.errors[0], /siklus model berganti/);
    assert.equal(await readCycle(), null);
    assert.equal(await archive.readText('sigap-indikasi/pending.json'), null);
  });

  test('hujan baru diambil setelah semua server Open-Meteo sempat memuat siklus', async () => {
    const early = fakeHttp();
    const result = await record(early, { now: new Date(Date.parse('2026-10-01T06:32:20Z') + SETTLE_MS - 60_000).toISOString() });
    assert.match(result.skipped, /hujan diambil mulai 2026-10-01T07:17:20/);
    assert.deepEqual(early.calls, [MODEL_META_URL]);
    assert.equal((await record(fakeHttp())).new, 1);
  });

  test('siklus 06Z dan 18Z tidak direkam; cicilan 00Z yang belum lengkap disimpan apa adanya', async () => {
    await record(fakeHttp({ failKeys: new Set([KERING]) }), { titik: TITIK_BANYAK });
    const http = fakeHttp({ meta: META_06Z });
    const result = await record(http, { titik: TITIK_BANYAK, now: '2026-10-01T13:30:00.000Z' });
    assert.equal(result.new, 1);
    assert.equal(http.rainCalls().length, 0);
    assert.equal((await readCycle()).locations_missing, 3);
    assert.equal(await readCycle('sigap-indikasi/2026/10/01/06Z.json'), null);

    const again = await record(fakeHttp({ meta: META_06Z }), { titik: TITIK_BANYAK, now: '2026-10-01T13:45:00.000Z' });
    assert.match(again.skipped, /tidak direkam \(hanya 00Z dan 12Z\)/);
  });

  test('meta.json yang mundur ke siklus lama tidak menutup cicilan siklus baru', async () => {
    // 5 Okt 2026 19:00 UTC: cicilan 12Z ditutup dengan 100 titik kosong karena
    // meta.json sesaat menyebut siklus sebelumnya.
    await record(fakeHttp({ failKeys: new Set([KERING]) }), { titik: TITIK_BANYAK });
    const stale = fakeHttp({ meta: META_18Z_LALU });
    const result = await record(stale, { titik: TITIK_BANYAK, now: LATER });
    assert.match(result.skipped, /lebih lama dari 2026-10-01T00:00:00.000Z; server Open-Meteo belum sinkron/);
    assert.equal(stale.rainCalls().length, 0);
    assert.equal(await readCycle(), null);

    // meta.json mundur di tengah run: hujan run itu dibuang, cicilan tetap.
    const flip = fakeHttp({ meta: (n) => (n === 0 ? META_00Z : META_18Z_LALU) });
    const mid = await record(flip, { titik: TITIK_BANYAK, now: LATER });
    assert.match(mid.errors[0], /siklus model berganti dari 2026-10-01T00:00:00.000Z ke 2026-09-30T18:00:00.000Z/);
    assert.equal(await readCycle(), null);
    assert.equal(Object.keys((await archive.readJson('sigap-indikasi/pending.json')).hujan).length, 100);

    const done = await record(fakeHttp(), { titik: TITIK_BANYAK, now: '2026-10-01T08:00:00.000Z' });
    assert.equal(done.new, 1);
    assert.equal((await readCycle()).locations_missing, 0);
  });

  test('tanpa daftar titik pantau, sumber dilewati', async () => {
    const result = await recordSigapIndikasi({ archive, http: fakeHttp(), now: NOW, data: {} });
    assert.match(result.skipped, /titik pantau kosong/);
  });
});
