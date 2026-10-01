import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { HttpError } from '../src/lib/http.js';
import { MODEL_META_URL, rainBatchUrl } from '../src/lib/open-meteo-hujan.js';
import { createArchive } from '../src/lib/store.js';
import { RULES_VERSION } from '../src/lib/warning-rules.js';
import { recordSigapIndikasi } from '../src/sources/sigap-indikasi.js';

// Siklus ECMWF 00Z 1 Okt 2026, tersedia 06:32 UTC (nilai asli meta.json Open-Meteo).
const META = { last_run_initialisation_time: 1790812800, last_run_availability_time: 1790836340 };
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

function fakeHttp({ failKeys = new Set() } = {}) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (url === MODEL_META_URL) return META;
    const params = new URL(url).searchParams;
    const lats = params.get('latitude').split(',');
    const lons = params.get('longitude').split(',');
    const replies = lats.map((lat, i) => {
      const key = `${Number(lat).toFixed(3)},${Number(lons[i]).toFixed(3)}`;
      if (failKeys.has(key)) throw new HttpError(url, 502);
      return { latitude: Number(lat), longitude: Number(lons[i]), daily: { time: [...PAST, ...DAYS], precipitation_sum: RAIN[key] } };
    });
    return replies.length === 1 ? replies[0] : replies;
  };
  return { calls, fetchJson };
}

let tmpDir;
let archive;
beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sigap-indikasi-'));
  archive = createArchive(tmpDir);
});
afterEach(() => rm(tmpDir, { recursive: true, force: true }));

const NOW = '2026-10-01T06:45:00.000Z';
const run = (http, now = NOW) => recordSigapIndikasi({ archive, http, now, data: { titikPantau: TITIK } });

describe('arsip indikasi SIGAP per siklus model', () => {
  test('hujan diminta dari ECMWF IFS secara eksplisit, 3 hari lalu dan 4 hari ke depan', () => {
    const url = new URL(rainBatchUrl([{ lat: -7, lon: 107 }]));
    assert.equal(url.searchParams.get('models'), 'ecmwf_ifs');
    assert.equal(url.searchParams.get('past_days'), '3');
    assert.equal(url.searchParams.get('forecast_days'), '4');
  });

  test('siklus baru direkam: level per kab/kota per hari, hujan per titik, dan jejak versinya', async () => {
    const result = await run(fakeHttp());
    assert.deepEqual(result, { items: 2, new: 1, errors: [] });

    const record = await archive.readJson('sigap-indikasi/2026/10/01/00Z.json');
    assert.equal(record.model, 'ecmwf_ifs');
    assert.equal(record.model_init, '2026-10-01T00:00:00.000Z');
    assert.equal(record.model_available, '2026-10-01T06:32:20.000Z');
    assert.equal(record.rules_version, RULES_VERSION);
    assert.match(record.rules_sha256, /^[0-9a-f]{64}$/);
    assert.equal(record.titik_pantau.count, 3);
    assert.deepEqual(record.dates, DAYS);
    assert.deepEqual(record.hujan_kolom, ['lat', 'lon', ...PAST, ...DAYS]);

    const uji = record.wilayah.find((w) => w.kode === '99.01');
    // 1 Okt: akumulasi 3 hari 90 mm, belum 100 mm. 2 Okt: 120 mm di zona tinggi =
    // sangat lebat × tinggi = Siaga. 3–4 Okt: akumulasi 170 dan 130 mm = Waspada.
    assert.deepEqual(uji.longsor, [0, 2, 1, 1]);
    assert.deepEqual(uji.hujan, [0, 2, 0, 0]);
    // Tanpa titik zona banjir: Normal, bukan tanpa data.
    assert.deepEqual(uji.banjir, [0, 0, 0, 0]);
    assert.deepEqual(record.counts['2026-10-02'], { normal: 1, waspada: 0, siaga: 1, awas: 0, tanpa_data: 0 });

    const rows = (await archive.readText('sigap-indikasi/2026/10/01/00Z-hujan.jsonl')).trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.find((r) => r[0] === -7.1), [-7.1, 107.2, ...RAIN['-7.100,107.200']]);

    const status = await archive.readJson('sigap-indikasi/status.json');
    assert.equal(status.last_init, '2026-10-01T00:00:00.000Z');
  });

  test('siklus yang sama tidak direkam dua kali', async () => {
    await run(fakeHttp());
    const http = fakeHttp();
    const again = await run(http, '2026-10-01T07:00:00.000Z');
    assert.match(again.skipped, /sudah direkam/);
    assert.deepEqual(http.calls, [MODEL_META_URL]);
  });

  test('titik yang gagal membuat siklus diulang; percobaan ketiga disimpan dengan jumlah gagalnya', async () => {
    // 103 lokasi = dua permintaan (100 + 3); permintaan kedua (berisi Kota Kering) gagal.
    const extra = Array.from({ length: 100 }, (_, i) => ({ kode: '99.03', hazard: 'acuan', urutan: i + 1, kelas: 0, lat: -9 - i / 100, lon: 120 }));
    for (const point of extra) RAIN[`${point.lat.toFixed(3)},${point.lon.toFixed(3)}`] = [0, 0, 0, 1, 1, 1, 1];
    const [kering, ...uji] = [TITIK[2], TITIK[0], TITIK[1]];
    const titik = [...uji, ...extra, kering];
    const http = fakeHttp({ failKeys: new Set(['-8.000,111.000']) });
    const run = (_, now = NOW) => recordSigapIndikasi({ archive, http, now, data: { titikPantau: titik } });
    const first = await run(http);
    assert.equal(first.new, 0);
    assert.match(first.errors[0], /diulang di run berikutnya \(1\/3\)/);
    assert.equal(await archive.readText('sigap-indikasi/2026/10/01/00Z.json'), null);

    await run(http, '2026-10-01T07:00:00.000Z');
    const third = await run(http, '2026-10-01T07:15:00.000Z');
    assert.equal(third.new, 1);
    const record = await archive.readJson('sigap-indikasi/2026/10/01/00Z.json');
    assert.equal(record.locations, 103);
    assert.equal(record.locations_failed, 3);
    assert.equal(record.attempts, 3);
    assert.deepEqual(record.wilayah.find((w) => w.kode === '99.02').hujan, [null, null, null, null]);
  });

  test('tanpa daftar titik pantau, sumber dilewati', async () => {
    const result = await recordSigapIndikasi({ archive, http: fakeHttp(), now: NOW, data: {} });
    assert.match(result.skipped, /titik pantau kosong/);
  });
});
