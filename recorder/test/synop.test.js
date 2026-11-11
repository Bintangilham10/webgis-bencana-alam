import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createArchive } from '../src/lib/store.js';
import {
  decodeRainGroup,
  decodeReport,
  indonesianReports,
  observationTime,
  reportedRain,
  splitBulletins,
  weatherLabel,
} from '../src/lib/synop.js';
import { DIR_URL, fetchReports, filesSince, parseListing, recordSynop } from '../src/sources/synop.js';

// Fixture = berkas asli gerbang NOAA/NWS (11 Nov 2026), dipangkas ke beberapa
// stasiun dan disimpan dengan akhir baris LF (aslinya CR CR LF).
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const FILES = {
  'sn.0240.txt': fixture('synop-sn.0240.txt'),
  'sn.0253.txt': fixture('synop-sn.0253.txt'),
  'sn.0083.txt': fixture('synop-sn.0083.txt'),
};
const report = (file, wmo, now) => decodeReport(indonesianReports(FILES[file], now).find((r) => r.wmo === wmo).raw);

describe('sandi SYNOP', () => {
  test('kelompok hujan 6RRRtR: mm, lama periode, dan hujan tak terukur', () => {
    assert.deepEqual(decodeRainGroup('60214'), { mm: 21, hours: 24, trace: false });
    assert.deepEqual(decodeRainGroup('60721'), { mm: 72, hours: 6, trace: false });
    assert.deepEqual(decodeRainGroup('69977'), { mm: 0.7, hours: 3, trace: false });
    assert.deepEqual(decodeRainGroup('69904'), { mm: 0, hours: 24, trace: true });
    assert.equal(decodeRainGroup('60210'), null);
    assert.equal(decodeRainGroup('6///4'), null);
  });

  test('buletin dipisah dengan akhir baris asli CR CR LF dan pemisah yang menempel pada "="', () => {
    const original = FILES['sn.0240.txt'].replaceAll('\n', '\r\r\n').replace('=\r\r\n####018002183####\r\r\n', '=####018002183####\n');
    const bulletins = splitBulletins(original);
    assert.deepEqual(bulletins.map((b) => [b.ttaaii, b.center, b.day, b.hour]), [
      ['SMID02', 'WIIX', 11, 0],
      ['SMAU01', 'AMMC', 11, 0],
    ]);
    assert.equal(indonesianReports(original, '2026-11-11T00:20:00Z').length, 6);
  });

  test('hanya buletin Indonesia; laporan NIL dilewati; laporan multibaris disatukan', () => {
    const reports = indonesianReports(FILES['sn.0240.txt'], '2026-11-11T00:20:00Z');
    assert.deepEqual(reports.map((r) => r.wmo), ['97014', '97086', '97096', '97230', '97560', '97724']);
    assert.ok(reports.every((r) => r.observed_at === '2026-11-11T00:00:00.000Z' && r.bulletin === 'SMID02 WIIX 110000'));
    assert.equal(
      reports[4].raw,
      '97560 11460 72101 10293 20261 30111 40126 53016 60064 71792 83969 333 20252 50410 55053 55508 51715 56000 57901 57801 58012 81914 82815 85361 87180 80980 80862',
    );
  });

  test('laporan 00 UTC: hujan 24 jam, suhu, suhu minimum, dan cuaca', () => {
    const now = '2026-11-11T00:20:00Z';
    const biak = report('sn.0240.txt', '97560', now);
    assert.deepEqual(biak.rain, { mm: 6, hours: 24, trace: false });
    assert.equal(biak.weather, 17);
    assert.equal(biak.tempC, 29.3);
    assert.equal(biak.tempMinC, 25.2);

    // iR = 0: hujan 24 jam di seksi 1 dan 3 jam terakhir di seksi 3.
    const denpasar = report('sn.0240.txt', '97230', now);
    assert.deepEqual(denpasar.rain, { mm: 22, hours: 24, trace: false });
    assert.deepEqual(denpasar.rain3, { mm: 0.7, hours: 3, trace: false });

    // "333" di ujung baris pertama.
    const ambon = report('sn.0240.txt', '97724', now);
    assert.deepEqual(ambon.rain, { mm: 2, hours: 24, trace: false });
    assert.equal(ambon.tempMinC, 24.7);
  });

  test('stasiun tanpa hujan (iR = 3) dihitung 0 mm untuk periode baku jamnya', () => {
    const luwuk = report('sn.0240.txt', '97086', '2026-11-11T00:20:00Z');
    assert.equal(luwuk.rain, null);
    assert.equal(luwuk.noSignificantWeather, true);
    assert.deepEqual(reportedRain(luwuk, 0), { mm: 0, hours: 24, trace: false });
    const medan = report('sn.0083.txt', '96035', '2026-11-11T12:20:00Z');
    assert.deepEqual(reportedRain(medan, 12), { mm: 0, hours: 6, trace: false });
  });

  test('laporan 12 UTC: hujan 6 jam, suhu maksimum, dan badai petir', () => {
    const bengkulu = report('sn.0083.txt', '96253', '2026-11-11T12:20:00Z');
    assert.deepEqual(reportedRain(bengkulu, 12), { mm: 72, hours: 6, trace: false });
    assert.deepEqual(bengkulu.rain3, { mm: 72, hours: 3, trace: false });
    assert.equal(bengkulu.tempMaxC, 32.8);
    assert.equal(weatherLabel(bengkulu.weather), 'Hujan setelah badai petir');
  });

  test('laporan jam antara tanpa pengukuran hujan (iR = 4) tidak dianggap 0 mm', () => {
    const medan = report('sn.0253.txt', '96035', '2026-11-11T01:25:00Z');
    assert.equal(medan.precipIndicator, 4);
    assert.equal(reportedRain(medan, 1), null);
    assert.equal(medan.tempC, 25.6);
  });

  test('kelompok radiasi sesudah penanda 55508 tidak terbaca sebagai suhu atau hujan', () => {
    const decoded = decodeReport('97014 12560 41002 10287 333 55041 55508 20968 20236 60017');
    assert.equal(decoded.tempMinC, 23.6);
    assert.deepEqual(decoded.rain3, { mm: 1, hours: 3, trace: false });
  });

  test('teks cuaca hanya untuk hujan, badai, dan jarak pandang', () => {
    assert.equal(weatherLabel(95), 'Badai petir');
    assert.equal(weatherLabel(63), 'Hujan sedang');
    assert.equal(weatherLabel(2), null);
    assert.equal(weatherLabel(null), null);
  });

  test('bulan dan tahun pengamatan diambil dari waktu berkas', () => {
    assert.equal(observationTime(11, 0, '2026-11-11T00:20:00Z'), '2026-11-11T00:00:00.000Z');
    // Laporan 31 Oktober yang baru masuk 1 November.
    assert.equal(observationTime(31, 18, '2026-11-01T00:10:00Z'), '2026-10-31T18:00:00.000Z');
    // Tanggal yang terlalu lama atau di depan waktu berkas = salah ketik.
    assert.equal(observationTime(20, 0, '2026-11-11T00:20:00Z'), null);
    assert.equal(observationTime(12, 6, '2026-11-11T00:20:00Z'), null);
  });
});

describe('gerbang NOAA', () => {
  test('daftar berkas diurutkan menurut waktu diubah (UTC)', () => {
    assert.deepEqual(parseListing(fixture('synop-daftar.html')), [
      { name: 'sn.0240.txt', modified_at: '2026-11-11T00:20:00.000Z' },
      { name: 'sn.0253.txt', modified_at: '2026-11-11T01:25:00.000Z' },
      { name: 'sn.0083.txt', modified_at: '2026-11-11T12:20:00.000Z' },
    ]);
  });

  test('berkas terakhir yang sudah dibaca ikut dibaca lagi', () => {
    const listing = parseListing(fixture('synop-daftar.html'));
    assert.deepEqual(filesSince(listing, '2026-11-11T01:25:00.000Z').map((f) => f.name), ['sn.0253.txt', 'sn.0083.txt']);
    assert.equal(filesSince(listing, null).length, 3);
  });
});

describe('perekam SYNOP', () => {
  let tmpDir;
  let archive;
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sigap-synop-'));
    archive = createArchive(tmpDir);
  });
  afterEach(() => rm(tmpDir, { recursive: true, force: true }));

  function fakeHttp(files = FILES, { fail = [] } = {}) {
    const calls = [];
    return {
      calls,
      fetchText: async (url) => {
        calls.push(url);
        if (url === DIR_URL) return fixture('synop-daftar.html');
        const name = url.slice(DIR_URL.length);
        if (fail.includes(name)) throw new Error('HTTP 503');
        if (!(name in files)) throw new Error(`URL tidak terduga: ${url}`);
        return files[name];
      },
    };
  }
  const lines = async (relPath) => (await archive.readText(relPath)).trim().split('\n').map((line) => JSON.parse(line));

  test('run pertama membaca semua berkas; run berikutnya hanya berkas terakhir', async () => {
    const http = fakeHttp();
    const first = await recordSynop({ archive, http, now: '2026-11-11T12:30:00.000Z' });
    assert.deepEqual(first, { items: 11, new: 11, files: 3, errors: [] });

    const saved = await lines('synop/2026/11/11.jsonl');
    assert.equal(saved.length, 11);
    assert.deepEqual(saved.find((line) => line.wmo === '96253'), {
      wmo: '96253',
      observed_at: '2026-11-11T12:00:00.000Z',
      bulletin: 'SMID01 WIIX 111200',
      raw: '96253 01444 80403 10231 20221 30082 40101 51022 60721 79196 82972 333 10328 56000 57900 57800 58004 60727 81915 81820 83460',
      file: 'sn.0083.txt',
      file_modified_at: '2026-11-11T12:20:00.000Z',
      first_seen_at: '2026-11-11T12:30:00.000Z',
    });
    assert.deepEqual(await archive.readJson('synop/status.json'), {
      last_file_at: '2026-11-11T12:20:00.000Z',
      checked_at: '2026-11-11T12:30:00.000Z',
    });

    http.calls.length = 0;
    const second = await recordSynop({ archive, http, now: '2026-11-11T12:45:00.000Z' });
    assert.deepEqual(second, { items: 3, new: 0, files: 1, errors: [] });
    assert.deepEqual(http.calls, [DIR_URL, `${DIR_URL}sn.0083.txt`]);
  });

  test('laporan koreksi untuk stasiun dan jam yang sama ditambahkan, bukan menimpa', async () => {
    await recordSynop({ archive, http: fakeHttp(), now: '2026-11-11T12:30:00.000Z' });
    const corrected = { ...FILES, 'sn.0083.txt': FILES['sn.0083.txt'].replace('60721 79196', '60751 79196') };
    const result = await recordSynop({ archive, http: fakeHttp(corrected), now: '2026-11-11T12:45:00.000Z' });
    assert.equal(result.new, 1);
    const bengkulu = (await lines('synop/2026/11/11.jsonl')).filter((line) => line.wmo === '96253');
    assert.deepEqual(bengkulu.map((line) => decodeReport(line.raw).rain.mm), [72, 75]);
  });

  test('berkas yang gagal dicatat dan dicoba lagi di run berikutnya', async () => {
    const result = await fetchReports({ fetchText: fakeHttp(FILES, { fail: ['sn.0253.txt'] }).fetchText });
    assert.deepEqual(result.errors, ['sn.0253.txt: HTTP 503']);
    // Laporan berkas lain tetap terambil, tetapi batas hanya maju sampai sebelum berkas yang gagal.
    assert.equal(result.reports.length, 9);
    assert.equal(result.latest, '2026-11-11T00:20:00.000Z');
  });
});
