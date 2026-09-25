import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { runOnce } from '../src/record.js';
import { createArchive } from '../src/lib/store.js';
import { RSS_URL, parseCap, parseRss, recordBmkgCap } from '../src/sources/bmkg-cap.js';
import { FEEDS, eventFilePath, extractEvents, recordBmkgGempa } from '../src/sources/bmkg-gempa.js';
import { PAGE_URL, diffLevels, parseLevels, recordMagma } from '../src/sources/magma.js';
import { REPORTS_URL } from '../src/sources/petabencana.js';

// Fixture = respons asli sumber (diambil 26 Sep 2026).
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const CAP_1_URL = 'https://www.bmkg.go.id/alerts/nowcast/id/CRU20260925007_alert.xml';
const CAP_2_URL = 'https://www.bmkg.go.id/alerts/nowcast/id/CPU20260925010_alert.xml';

const ROUTES = {
  [RSS_URL]: fixture('cap-rss.xml'),
  [CAP_1_URL]: fixture('cap-1.xml'),
  [CAP_2_URL]: fixture('cap-2.xml'),
  [FEEDS.autogempa]: fixture('autogempa.json'),
  [FEEDS.gempaterkini]: fixture('gempaterkini.json'),
  [FEEDS.gempadirasakan]: fixture('gempadirasakan.json'),
  [PAGE_URL]: fixture('magma.html'),
  [REPORTS_URL]: fixture('petabencana.json'),
};

function fakeHttp(routes = ROUTES) {
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    if (!(url in routes)) throw new Error(`URL tidak terduga: ${url}`);
    return routes[url];
  };
  return { calls, fetchText, fetchJson: async (url) => JSON.parse(await fetchText(url)) };
}

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

describe('BMKG CAP', () => {
  test('parseRss membaca identifier, URL, dan waktu terbit dalam UTC', () => {
    const items = parseRss(fixture('cap-rss.xml'));
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], {
      identifier: '2.49.0.1.360.0.2026.09.25.18.14.007',
      url: CAP_1_URL,
      title: 'Hujan Lebat disertai Petir di Riau',
      published_at: '2026-09-25T17:52:00.000Z',
    });
  });

  test('parseCap meringkas info peringatan', () => {
    const cap = parseCap(fixture('cap-1.xml'));
    assert.equal(cap.identifier, '2.49.0.1.360.0.2026.09.25.18.14.007');
    assert.equal(cap.msg_type, 'Alert');
    assert.equal(cap.event, 'Hujan Lebat dan Petir');
    assert.equal(cap.severity, 'Moderate');
    assert.equal(cap.effective, '2026-09-26T01:00:00+07:00');
    assert.equal(cap.expires, '2026-09-26T04:00:00+07:00');
    assert.deepEqual(cap.areas, ['Riau']);
    assert.equal(cap.polygon_count, 35);
  });

  test('XML tersimpan per tanggal terbit UTC dan tercatat di indeks', async () => {
    const result = await recordBmkgCap({ archive, http: fakeHttp(), now: '2026-09-25T18:05:00.000Z' });
    assert.deepEqual(result, { items: 2, new: 2, errors: [] });

    const xml = await archive.readText('bmkg-cap/2026/09/25/2.49.0.1.360.0.2026.09.25.18.14.007.xml');
    assert.equal(xml, fixture('cap-1.xml'));

    const index = (await archive.readText('bmkg-cap/indeks/2026/09.jsonl')).trim().split('\n').map(JSON.parse);
    assert.equal(index.length, 2);
    assert.equal(index[0].first_seen_at, '2026-09-25T18:05:00.000Z');
    assert.equal(index[0].url, CAP_1_URL);
  });
});

describe('BMKG gempa', () => {
  test('extractEvents menerima objek tunggal maupun array', () => {
    assert.equal(extractEvents(JSON.parse(fixture('autogempa.json'))).length, 1);
    assert.equal(extractEvents(JSON.parse(fixture('gempadirasakan.json'))).length, 15);
    assert.throws(() => extractEvents({ foo: 1 }), /Infogempa/);
  });

  test('nama file memakai waktu UTC dan hash isi', () => {
    const [event] = extractEvents(JSON.parse(fixture('autogempa.json')));
    assert.match(eventFilePath('autogempa', event), /^bmkg-gempa\/autogempa\/2026\/09\/20260925T134730Z__[0-9a-f]{12}\.json$/);
  });

  test('revisi parameter gempa disimpan sebagai file baru, bukan menimpa', async () => {
    const original = JSON.parse(fixture('autogempa.json'));
    const revised = structuredClone(original);
    revised.Infogempa.gempa.Magnitude = '4.9';

    const routesFor = (auto) => ({ ...ROUTES, [FEEDS.autogempa]: JSON.stringify(auto) });
    await recordBmkgGempa({ archive, http: fakeHttp(routesFor(original)), now: '2026-09-25T14:00:00.000Z' });
    const second = await recordBmkgGempa({ archive, http: fakeHttp(routesFor(revised)), now: '2026-09-25T14:15:00.000Z' });

    assert.equal(second.new, 1);
    const files = (await listFiles(tmpDir)).filter((f) => f.startsWith('bmkg-gempa/autogempa/'));
    assert.equal(files.length, 2);
  });
});

describe('MAGMA', () => {
  test('parseLevels membaca semua gunung api dan levelnya', () => {
    const volcanoes = parseLevels(fixture('magma.html'));
    assert.equal(volcanoes.length, 69);
    assert.deepEqual(
      volcanoes.filter((v) => v.level === 3).map((v) => v.name),
      ['Merapi', 'Semeru', 'Sinabung'],
    );
    assert.deepEqual(volcanoes.find((v) => v.name === 'Merapi'), {
      name: 'Merapi',
      region: 'Daerah Istimewa Yogyakarta dan Jawa Tengah',
      level: 3,
    });
    assert.equal(volcanoes.filter((v) => v.level === 4).length, 0);
    assert.ok(volcanoes.every((v) => !v.name.startsWith('Tidak ada')));
  });

  test('parseLevels menolak halaman yang jumlahnya tidak cocok', () => {
    // Buang satu baris gunung api; kolom "Jumlah" masih menyebut angka lama.
    const broken = fixture('magma.html').replace(/<tr>\s*<td>\s*Merapi[\s\S]*?<\/tr>/, '');
    assert.throws(() => parseLevels(broken), /Level 3: terbaca 2 gunung api, halaman menyebut 3/);
  });

  test('diffLevels melaporkan naik/turun level, gunung baru, dan yang hilang', () => {
    const changes = diffLevels(
      [{ name: 'Merapi', region: 'DIY', level: 2 }, { name: 'Lama', region: 'X', level: 1 }],
      [{ name: 'Merapi', region: 'DIY', level: 3 }, { name: 'Baru', region: 'Y', level: 1 }],
    );
    assert.deepEqual(changes, [
      { name: 'Merapi', region: 'DIY', from: 2, to: 3 },
      { name: 'Baru', region: 'Y', from: null, to: 1 },
      { name: 'Lama', region: 'X', from: 1, to: null },
    ]);
  });

  test('perubahan level tercatat di perubahan.jsonl', async () => {
    const current = parseLevels(fixture('magma.html'));
    const previous = current.map((v) => (v.name === 'Merapi' ? { ...v, level: 2 } : v));
    await archive.writeJson('magma/terkini.json', { updated_at: '2026-09-24T00:00:00.000Z', hash: 'lama', volcanoes: previous });

    const result = await recordMagma({ archive, http: fakeHttp(), now: '2026-09-25T18:05:00.000Z' });
    assert.deepEqual(result, { items: 69, new: 1, changes: 1 });

    const [line] = (await archive.readText('magma/perubahan.jsonl')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(line, {
      detected_at: '2026-09-25T18:05:00.000Z',
      name: 'Merapi',
      region: 'Daerah Istimewa Yogyakarta dan Jawa Tengah',
      from: 2,
      to: 3,
    });
  });
});

describe('runOnce', () => {
  test('run pertama mengarsipkan semua sumber dan mencatat log run', async () => {
    const results = await runOnce({ archive, http: fakeHttp(), now: '2026-09-25T18:05:00.000Z' });

    assert.equal(results['bmkg-cap'].new, 2);
    assert.equal(results['bmkg-gempa'].new, 31);
    assert.equal(results.magma.new, 1);
    assert.equal(results.petabencana.new, 3);
    assert.ok(Object.values(results).every((r) => r.ok));

    const [run] = (await archive.readText('_runs/2026/09/25.jsonl')).trim().split('\n').map(JSON.parse);
    assert.equal(run.run_at, '2026-09-25T18:05:00.000Z');
    assert.deepEqual(Object.keys(run.results), ['bmkg-cap', 'bmkg-gempa', 'magma', 'petabencana']);
  });

  test('run kedua tidak menggandakan data dan tidak mengunduh ulang XML CAP', async () => {
    await runOnce({ archive, http: fakeHttp(), now: '2026-09-25T18:05:00.000Z' });
    const filesAfterFirst = await listFiles(tmpDir);

    const http = fakeHttp();
    const results = await runOnce({ archive, http, now: '2026-09-25T18:20:00.000Z' });

    assert.ok(Object.values(results).every((r) => r.ok && r.new === 0));
    assert.ok(!http.calls.includes(CAP_1_URL) && !http.calls.includes(CAP_2_URL));
    // Hanya log run yang bertambah isinya; tidak ada file data baru.
    assert.deepEqual(await listFiles(tmpDir), filesAfterFirst);
    const runs = (await readFile(path.join(tmpDir, '_runs', '2026', '09', '25.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(runs.length, 2);
  });

  test('satu sumber gagal tidak menghentikan sumber lain', async () => {
    const { [PAGE_URL]: _, ...withoutMagma } = ROUTES;
    const results = await runOnce({ archive, http: fakeHttp(withoutMagma), now: '2026-09-25T18:05:00.000Z' });

    assert.equal(results.magma.ok, false);
    assert.match(results.magma.error, /URL tidak terduga/);
    assert.equal(results['bmkg-cap'].ok, true);
    assert.equal(results.petabencana.ok, true);
  });
});
