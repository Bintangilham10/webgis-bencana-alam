import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { SOURCES, runOnce } from '../src/record.js';
import { HttpError } from '../src/lib/http.js';
import { createArchive } from '../src/lib/store.js';
import { dasarianOf, nextDasarian, wibDate } from '../src/lib/time.js';
import { createGazetteer, loadWilayah, nameKey } from '../src/lib/wilayah.js';
import { classify, parseRss, recordBeritaLongsor } from '../src/sources/berita-longsor.js';
import { AREA_URL, LEVELS, parseAreaCoverage, recordBmkgCews } from '../src/sources/bmkg-cews.js';
import { QUERY_URL, extractEvents, recordBnpbMingguan } from '../src/sources/bnpb-mingguan.js';
import { recordOpenMeteoEns, summarizeLocation } from '../src/sources/open-meteo-ens.js';
import { REPORTS_URL, diffReports, flattenReports, recordPvmbgLaporan } from '../src/sources/pvmbg-laporan.js';
import { WMS_URL, featureInfoUrl, parseFeatureInfo, recordPvmbgPrakiraan } from '../src/sources/pvmbg-prakiraan.js';

// Fixture = respons asli sumber (diambil 27 Sep 2026; geometri PVMBG dan jumlah
// berita dipangkas supaya kecil).
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const CEWS = JSON.parse(fixture('cews-2026-09-3.json'));
const ENSEMBLE = JSON.parse(fixture('open-meteo-ens.json'));

// Gazeter memakai daftar 514 kab/kota asli; sumber berbasis titik memakai dua titik saja.
const WILAYAH = loadWilayah();
const GAZETTEER = createGazetteer(WILAYAH);
const POINTS = [
  { kode: '32.05', nama: 'Kabupaten Garut', tingkat: 'kabupaten', provinsi: 'Jawa Barat', lat: -7.2297, lon: 107.9322 },
  { kode: '13.06', nama: 'Kabupaten Agam', tingkat: 'kabupaten', provinsi: 'Sumatera Barat', lat: -0.3199, lon: 100.306 },
];
const DATA = { wilayah: POINTS, gazetteer: GAZETTEER, cewsBackfillFrom: null };
const noPause = async () => {};

// Rute GET berupa pasangan [pencocok, respons]; pencocok bisa string atau fungsi,
// respons bisa teks, fungsi, atau Error yang dilempar.
function fakeHttp({ get = [], post } = {}) {
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    for (const [match, respond] of get) {
      if (typeof match === 'string' ? url === match : match(url)) {
        const value = typeof respond === 'function' ? respond(url) : respond;
        if (value instanceof Error) throw value;
        return value;
      }
    }
    throw new Error(`URL tidak terduga: ${url}`);
  };
  const postForm = async (url, fields) => {
    calls.push(`POST ${url} ${new URLSearchParams(fields)}`);
    if (!post) throw new Error(`POST tidak terduga: ${url}`);
    return post(url, fields);
  };
  return { calls, fetchText, fetchJson: async (url, options) => JSON.parse(await fetchText(url, options)), postForm };
}

// CEWS: fixture untuk Dasarian III September 2026, kosong untuk dasarian lain.
const cewsPost = (url, fields) => {
  assert.equal(url, AREA_URL);
  const published = fields.date1 === '2026-09-01' && fields.num1 === '3';
  return JSON.stringify(published ? CEWS[fields.legendindex] : []);
};

const isPvmbg = (month) => (url) => url.startsWith(WMS_URL) && url.includes(`prakiraan_${month}&`);
const notFound = (url) => new HttpError(url, 404);
const ensembleFor = (url) => {
  const count = new URL(url).searchParams.get('latitude').split(',').length;
  return JSON.stringify(Array.from({ length: count }, (_, i) => ENSEMBLE[i % ENSEMBLE.length]));
};

async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'));
}

let tmpDir;
let archive;
beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sigap-arsip-'));
  archive = createArchive(tmpDir);
});
afterEach(() => rm(tmpDir, { recursive: true, force: true }));

describe('waktu WIB dan dasarian', () => {
  test('tanggal WIB bisa berbeda dari tanggal UTC', () => {
    assert.equal(wibDate('2026-09-25T18:05:00.000Z'), '2026-09-26');
    assert.deepEqual(dasarianOf('2026-09-26'), { year: 2026, month: 9, num: 3 });
    assert.deepEqual(dasarianOf('2026-09-10'), { year: 2026, month: 9, num: 1 });
  });

  test('dasarian berikutnya melewati batas bulan dan tahun', () => {
    assert.deepEqual(nextDasarian({ year: 2026, month: 9, num: 3 }), { year: 2026, month: 10, num: 1 });
    assert.deepEqual(nextDasarian({ year: 2026, month: 12, num: 3 }), { year: 2027, month: 1, num: 1 });
  });
});

describe('gazeter wilayah', () => {
  test('nama dengan ejaan berbeda dianggap sama', () => {
    assert.equal(nameKey('GUNUNG KIDUL'), nameKey('Kabupaten Gunungkidul'));
    assert.equal(nameKey('SIAU TAGULANDANG BIARO'), nameKey('Kabupaten Kep. Siau Tagulandang Biaro'));
    assert.equal(nameKey('KOTA JAKARTA BARAT'), nameKey('Kota Administrasi Jakarta Barat'));
    assert.equal(nameKey('TOBA SAMOSIR'), nameKey('Kabupaten Toba'));
    assert.notEqual(nameKey('BOGOR'), nameKey('KOTA BOGOR'));
  });

  test('semua kab/kota CEWS cocok ke kode, kecuali "KOTA TUBUH AIR" yang bukan kab/kota', () => {
    const entries = LEVELS.flatMap((_, i) => parseAreaCoverage(CEWS[i]));
    const unmatched = entries.filter((e) => !GAZETTEER.match(e.kab_kota, e.provinsi));
    assert.deepEqual(unmatched.map((e) => e.kab_kota), ['KOTA TUBUH AIR']);
    assert.equal(GAZETTEER.match('KOTAMOBAGU', 'SULAWESI UTARA').kode, '71.74');
    // Arsip CEWS 2022 memakai ejaan dan nama lama.
    assert.equal(GAZETTEER.match('SIDOARDJO', 'Jawa Timur').kode, '35.15');
    assert.equal(GAZETTEER.match('MAMUJU UTARA', 'Sulawesi Barat').kode, '76.01');
    assert.equal(GAZETTEER.match('Kota Padang Sidempuan', 'Sumatera Utara').kode, '12.77');
    assert.equal(GAZETTEER.match('KEPULAUAN SERIBU (Administratif)', 'Daerah Khusus Ibukota Jakarta Raya').kode, '31.01');
    assert.equal(GAZETTEER.match('DANAU', 'GORONTALO'), null);
    assert.equal(GAZETTEER.match('KOTA SOLOK', 'SUMATERA BARAT').kode, '13.72');
    assert.equal(GAZETTEER.match('SOLOK', 'SUMATERA BARAT').kode, '13.02');
  });

  test('nama di teks: nama terpanjang menang, awalan menaikkan keyakinan', () => {
    const names = (text) => GAZETTEER.findInText(text).kabKota.map((k) => `${k.kode}:${k.keyakinan}`);
    assert.deepEqual(names('Longsor di Kabupaten Bandung Barat'), ['32.17:tinggi']);
    assert.deepEqual(names('Bupati Solok tinjau lokasi'), ['13.02:tinggi']);
    assert.deepEqual(names('Longsor Salawu Tasikmalaya').sort(), ['32.06:rendah', '32.78:rendah']);
    assert.deepEqual(names('Batu besar menutup jalan'), []);
    assert.deepEqual(names('Longsor di Kota Batu'), ['35.79:tinggi']);
  });
});

describe('BMKG CEWS', () => {
  test('daftar wilayah per level tersimpan dengan kode Kepmendagri', async () => {
    const http = fakeHttp({ post: cewsPost });
    const result = await recordBmkgCews({ archive, http, now: '2026-09-25T18:05:00.000Z', data: DATA, pause: noPause });
    // Dasarian berjalan tersimpan; dasarian berikutnya belum terbit.
    assert.deepEqual(result, { items: 1, new: 1, errors: [] });

    const [file] = (await listFiles(tmpDir)).filter((f) => f.startsWith('bmkg-cews/2026/09/'));
    assert.match(file, /^bmkg-cews\/2026\/09\/dasarian-3__[0-9a-f]{12}\.json$/);
    const record = JSON.parse(await archive.readText(file));
    assert.deepEqual(record.dasarian, { year: 2026, month: 9, num: 3 });
    assert.equal(record.counts.waspada, 10);
    assert.equal(record.counts.siaga + record.counts.awas, 0);
    assert.ok(record.levels.waspada.some((e) => e.kab_kota === 'AGAM' && e.kode === '13.06'));
  });

  test('tidak memeriksa ulang sebelum 6 jam', async () => {
    await recordBmkgCews({ archive, http: fakeHttp({ post: cewsPost }), now: '2026-09-25T18:05:00.000Z', data: DATA, pause: noPause });
    const http = fakeHttp({ post: cewsPost });
    await recordBmkgCews({ archive, http, now: '2026-09-25T20:05:00.000Z', data: DATA, pause: noPause });
    assert.equal(http.calls.length, 0);
  });

  test('backfill berjalan bertahap sampai dasarian berjalan lalu berhenti', async () => {
    const data = { ...DATA, cewsBackfillFrom: { year: 2026, month: 9, num: 1 } };
    const post = (url, fields) => JSON.stringify(CEWS[fields.legendindex]);
    await recordBmkgCews({ archive, http: fakeHttp({ post }), now: '2026-09-25T18:05:00.000Z', data, pause: noPause });

    const files = (await listFiles(tmpDir)).filter((f) => f.startsWith('bmkg-cews/2026/'));
    assert.deepEqual(files.map((f) => f.replace(/__.*/, '')).sort(), [
      'bmkg-cews/2026/09/dasarian-1',
      'bmkg-cews/2026/09/dasarian-2',
      'bmkg-cews/2026/09/dasarian-3',
      'bmkg-cews/2026/10/dasarian-1',
    ]);
    const status = await archive.readJson('bmkg-cews/status.json');
    assert.equal(status.backfill_next, null);
    assert.ok(status.backfill_done_at);
  });
});

describe('PVMBG prakiraan bulanan', () => {
  test('GetFeatureInfo dibaca tanpa geometri', () => {
    assert.deepEqual(parseFeatureInfo(JSON.parse(fixture('pvmbg-prakiraan-garut.json'))), {
      potensi: 'Menengah',
      zkgt: 'Menengah',
      zona: '003',
      tahun_zkgt: 2016,
      wilayah_zkgt: 'Jawa Barat',
    });
    assert.equal(parseFeatureInfo({ features: [] }), null);
  });

  test('potensi bulan berjalan direkam per titik; bulan depan yang belum terbit dilewati', async () => {
    const http = fakeHttp({ get: [[isPvmbg('2026_9'), fixture('pvmbg-prakiraan-garut.json')], [isPvmbg('2026_10'), notFound]] });
    const result = await recordPvmbgPrakiraan({ archive, http, now: '2026-09-25T18:05:00.000Z', data: DATA, pause: noPause });
    assert.deepEqual(result, { items: 2, new: 2, errors: [] });

    const lines = (await archive.readText('pvmbg-prakiraan/2026/09.jsonl')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map((l) => [l.kode, l.potensi]), [['32.05', 'Menengah'], ['13.06', 'Menengah']]);
    const status = await archive.readJson('pvmbg-prakiraan/status.json');
    assert.ok(status.months['2026-09'].completed_at);
    assert.equal(status.months['2026-10'], undefined);
  });

  test('melanjutkan dari titik yang belum direkam', async () => {
    await archive.appendLine('pvmbg-prakiraan/2026/09.jsonl', { kode: '32.05', potensi: 'Menengah' });
    const http = fakeHttp({ get: [[isPvmbg('2026_9'), fixture('pvmbg-prakiraan-garut.json')], [isPvmbg('2026_10'), notFound]] });
    await recordPvmbgPrakiraan({ archive, http, now: '2026-09-25T18:05:00.000Z', data: DATA, pause: noPause });
    const pointCalls = http.calls.filter((u) => u.includes('prakiraan_2026_9&') && u !== featureInfoUrl('pmbgi:prakiraan_2026_9', { lat: -7.275, lon: 109.67 }));
    assert.equal(pointCalls.length, 1);
    assert.equal(pointCalls[0], featureInfoUrl('pmbgi:prakiraan_2026_9', POINTS[1]));
  });
});

describe('PVMBG laporan lapangan', () => {
  const reports = fixture('pvmbg-laporan.json');

  test('laporan per tahun diratakan', () => {
    const flat = flattenReports(JSON.parse(reports));
    assert.equal(flat.length, 6);
    assert.deepEqual([...new Set(flat.map((r) => r.group))], ['2022', '2023', '2024']);
  });

  test('snapshot pertama, lalu hanya perubahan yang dicatat', async () => {
    const first = await recordPvmbgLaporan({ archive, http: fakeHttp({ get: [[REPORTS_URL, `﻿${reports}`]] }), now: '2026-09-27T01:00:00.000Z' });
    assert.deepEqual(first, { items: 6, new: 6 });
    assert.ok(await archive.exists('pvmbg-laporan/snapshot/2026-09-27.json'));

    const skipped = await recordPvmbgLaporan({ archive, http: fakeHttp(), now: '2026-09-30T01:00:00.000Z' });
    assert.equal(skipped.skipped, 'sudah diperiksa minggu ini');

    const json = JSON.parse(reports);
    json['2024'][0].landslide_type = 'Longsoran';
    json['2024'].push({ ...json['2024'][1], id: 99999 });
    json['2022'].shift();
    const later = await recordPvmbgLaporan({ archive, http: fakeHttp({ get: [[REPORTS_URL, JSON.stringify(json)]] }), now: '2026-10-05T01:00:00.000Z' });
    assert.equal(later.new, 1);

    const changes = (await archive.readText('pvmbg-laporan/perubahan.jsonl')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(changes.map((c) => c.jenis).sort(), ['baru', 'berubah', 'hilang']);
  });

  test('diffReports membandingkan hash per id', () => {
    assert.deepEqual(diffReports({}, [{ id: 1 }]).map((c) => c.jenis), ['baru']);
    assert.deepEqual(diffReports({ 2: 'x' }, []).map((c) => c.jenis), ['hilang']);
  });
});

describe('Open-Meteo ensemble', () => {
  test('ringkasan harian dari 51 anggota ensemble', () => {
    const days = summarizeLocation(ENSEMBLE[0]);
    assert.equal(days.length, 3);
    for (const d of days) {
      assert.equal(d.n, 51);
      assert.ok(d.median <= d.p90 && d.p90 <= d.max);
      for (const key of ['p20', 'p50', 'p100']) assert.ok(d[key] >= 0 && d[key] <= 1);
      assert.ok(d.p20 >= d.p50 && d.p50 >= d.p100);
    }
  });

  test('menunggu run pagi, merekam sekali sehari', async () => {
    const early = await recordOpenMeteoEns({ archive, http: fakeHttp(), now: '2026-09-27T03:00:00.000Z', data: DATA, pause: noPause });
    assert.match(early.skipped, /menunggu/);

    const http = fakeHttp({ get: [[(u) => u.startsWith('https://ensemble-api.open-meteo.com/'), ensembleFor]] });
    const result = await recordOpenMeteoEns({ archive, http, now: '2026-09-27T09:00:00.000Z', data: DATA, pause: noPause });
    assert.deepEqual(result, { items: 2, new: 2, errors: [] });
    const lines = (await archive.readText('open-meteo-ens/2026/09/27.jsonl')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map((l) => l.kode), ['32.05', '13.06']);
    assert.equal(lines[0].days.length, 3);

    const again = await recordOpenMeteoEns({ archive, http: fakeHttp(), now: '2026-09-27T12:00:00.000Z', data: DATA, pause: noPause });
    assert.equal(again.skipped, 'sudah direkam hari ini');
  });

  test('titik banyak dicicil maksimal 100 per run supaya tidak melewati batas per menit', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ kode: `99.${String(i).padStart(3, '0')}`, lat: -7 - i / 1000, lon: 110 }));
    const data = { ...DATA, wilayah: many };
    const http = fakeHttp({ get: [[(u) => u.startsWith('https://ensemble-api.open-meteo.com/'), ensembleFor]] });
    const first = await recordOpenMeteoEns({ archive, http, now: '2026-09-27T09:00:00.000Z', data, pause: noPause });
    assert.equal(first.new, 100);
    assert.equal((await archive.readJson('open-meteo-ens/status.json')).completed_at, undefined);

    const second = await recordOpenMeteoEns({ archive, http, now: '2026-09-27T09:15:00.000Z', data, pause: noPause });
    assert.equal(second.new, 50);
    assert.ok((await archive.readJson('open-meteo-ens/status.json')).completed_at);
    assert.equal(http.calls.length, 3);
  });

  test('kuota habis (429): titik yang sudah terekam disimpan, sisanya lanjut run berikutnya', async () => {
    const http = fakeHttp({ get: [[(u) => u.startsWith('https://ensemble-api.open-meteo.com/'), (url) => new HttpError(url, 429)]] });
    await assert.rejects(recordOpenMeteoEns({ archive, http, now: '2026-09-27T09:00:00.000Z', data: DATA, pause: noPause }), /429/);
    const status = await archive.readJson('open-meteo-ens/status.json');
    assert.equal(status.done, 0);
    assert.equal(status.completed_at, undefined);
  });
});

describe('BNPB kejadian mingguan', () => {
  test('setiap kejadian tersimpan sekali; diperiksa harian', async () => {
    assert.equal(extractEvents(JSON.parse(fixture('bnpb-mingguan.json'))).length, 6);
    const first = await recordBnpbMingguan({ archive, http: fakeHttp({ get: [[QUERY_URL, fixture('bnpb-mingguan.json')]] }), now: '2026-09-27T01:00:00.000Z' });
    assert.deepEqual(first, { items: 6, new: 6 });
    const files = (await listFiles(tmpDir)).filter((f) => f.startsWith('bnpb-mingguan/2026/0'));
    assert.equal(files.length, 6);

    const second = await recordBnpbMingguan({ archive, http: fakeHttp(), now: '2026-09-27T10:00:00.000Z' });
    assert.equal(second.skipped, 'sudah diperiksa hari ini');
  });

  test('error ArcGIS tidak dianggap data kosong', () => {
    assert.throws(() => extractEvents({ error: { code: 500, message: '' } }), /ArcGIS error 500/);
  });
});

describe('berita longsor', () => {
  const items = parseRss(fixture('berita-longsor.xml'));

  test('RSS dibaca: judul, sumber, waktu UTC', () => {
    assert.equal(items.length, 9);
    const agam = items.find((i) => i.title.includes('Kelok 44 Agam'));
    assert.equal(agam.source, 'detikcom');
    assert.equal(agam.published_at, '2026-09-25T12:19:05.000Z');
  });

  test('berita luar negeri, kejadian, dan imbauan dibedakan', () => {
    const byTitle = (text) => classify(items.find((i) => i.title.includes(text)), GAZETTEER);
    assert.equal(byTitle('Thailand').luar_negeri, true);
    assert.deepEqual(byTitle('Kelok 44 Agam'), {
      luar_negeri: false,
      indonesia: true,
      jenis: 'kejadian',
      kab_kota: [{ kode: '13.06', nama: 'Kabupaten Agam', keyakinan: 'rendah' }],
      provinsi: [],
    });
    assert.equal(byTitle('BPBD Cianjur').jenis, 'imbauan');
    assert.deepEqual(byTitle('Bupati Solok').kab_kota.map((k) => k.kode), ['13.02']);
  });

  test('dua kueri digabung tanpa duplikat; berita tanpa kata longsor dilewati', async () => {
    const http = fakeHttp({ get: [[(u) => u.startsWith('https://news.google.com/rss/search'), fixture('berita-longsor.xml')]] });
    const result = await recordBeritaLongsor({ archive, http, now: '2026-09-27T01:00:00.000Z', data: DATA, pause: noPause });
    assert.deepEqual(result, { items: 8, new: 8, errors: [] });
    const again = await recordBeritaLongsor({ archive, http, now: '2026-09-27T03:00:00.000Z', data: DATA, pause: noPause });
    assert.equal(again.skipped, 'belum 6 jam');
  });
});

describe('runOnce dengan semua sumber', () => {
  test('sepuluh sumber berjalan dan tercatat di log run', async () => {
    const CORE_ROUTES = {
      'https://www.bmkg.go.id/alerts/nowcast/id': '<rss><channel></channel></rss>',
      'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json': fixture('autogempa.json'),
      'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json': fixture('gempaterkini.json'),
      'https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json': fixture('gempadirasakan.json'),
      'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas': fixture('magma.html'),
      'https://api.petabencana.id/reports?geoformat=geojson&timeperiod=604800': fixture('petabencana.json'),
    };
    const http = fakeHttp({
      post: cewsPost,
      get: [
        ...Object.entries(CORE_ROUTES),
        [isPvmbg('2026_9'), fixture('pvmbg-prakiraan-garut.json')],
        [isPvmbg('2026_10'), notFound],
        [REPORTS_URL, fixture('pvmbg-laporan.json')],
        [(u) => u.startsWith('https://ensemble-api.open-meteo.com/'), ensembleFor],
        [QUERY_URL, fixture('bnpb-mingguan.json')],
        [(u) => u.startsWith('https://news.google.com/rss/search'), fixture('berita-longsor.xml')],
      ],
    });
    const results = await runOnce({ archive, http, now: '2026-09-27T09:00:00.000Z', data: DATA, pause: noPause });

    assert.deepEqual(Object.keys(results), Object.keys(SOURCES));
    for (const [name, r] of Object.entries(results)) assert.ok(r.ok, `${name}: ${r.error}`);
    assert.equal(results['bmkg-cews'].new, 1);
    assert.equal(results['pvmbg-prakiraan'].new, 2);
    assert.equal(results['open-meteo-ens'].new, 2);
    assert.equal(results['berita-longsor'].new, 8);
  });
});
