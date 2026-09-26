import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { depthClass, hasTsunamiPotential } from '../src/lib/classify.js';
import { extractEvents, normalizeEvent } from '../src/sources/bmkg-gempa.js';
import { extractJsonLiteral, extractVolcanoes } from '../src/sources/magma.js';
import { parseBoundarySql, toRings } from '../scripts/seed-wilayah.js';

// Fixture = respons asli sumber (diambil 26 Sep 2026).
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('BMKG gempa', () => {
  test('normalizeEvent membalik "lat,lon" BMKG dan mengubah teks menjadi angka', () => {
    const [raw] = extractEvents(JSON.parse(fixture('autogempa.json')));
    const event = normalizeEvent(raw);
    assert.equal(event.id, 'bmkg:20260925T134730Z');
    assert.equal(event.lat, -7.04);
    assert.equal(event.lon, 105.22);
    assert.equal(event.magnitude, 4.7);
    assert.equal(event.depthKm, 10);
    assert.equal(event.occurredAt, '2026-09-25T13:47:30.000Z');
    assert.equal(event.props.shakemap, 'https://data.bmkg.go.id/DataMKG/TEWS/20260925204730.mmi.jpg');
  });

  test('field yang tidak ada di feed tidak ikut ke props', () => {
    // gempadirasakan tidak punya Potensi/Shakemap; key kosong tidak boleh menimpa data feed lain.
    const [raw] = extractEvents(JSON.parse(fixture('gempadirasakan.json')));
    const { props } = normalizeEvent(raw);
    assert.ok(props.dirasakan);
    assert.ok(!('potensi' in props) && !('shakemap' in props));
  });

  test('data tanpa koordinat valid ditolak', () => {
    assert.throws(
      () => normalizeEvent({ Coordinates: 'x,y', Magnitude: '5', Kedalaman: '10 km', DateTime: '2026-09-25T00:00:00Z' }),
      /tidak lengkap/,
    );
  });
});

describe('klasifikasi', () => {
  test('kelas kedalaman gempa', () => {
    assert.equal(depthClass(59.9), 'dangkal');
    assert.equal(depthClass(60), 'menengah');
    assert.equal(depthClass(300), 'menengah');
    assert.equal(depthClass(301), 'dalam');
  });

  test('potensi tsunami dari teks BMKG', () => {
    assert.equal(hasTsunamiPotential('Berpotensi tsunami'), true);
    assert.equal(hasTsunamiPotential('Tidak berpotensi tsunami'), false);
    assert.equal(hasTsunamiPotential('Gempa ini dirasakan untuk diteruskan pada masyarakat'), false);
    assert.equal(hasTsunamiPotential(undefined), false);
  });
});

describe('MAGMA', () => {
  test('extractVolcanoes membaca koordinat dan level dari halaman utama', () => {
    const volcanoes = extractVolcanoes(fixture('magma-home.html'));
    assert.equal(volcanoes.length, 69);
    assert.deepEqual(
      volcanoes.filter((v) => v.level === 3).map((v) => v.nama).sort(),
      ['Merapi', 'Semeru', 'Sinabung'],
    );
    assert.deepEqual(volcanoes.find((v) => v.kode === 'AGU'), {
      kode: 'AGU', nama: 'Agung', kabupaten: 'Karangasem', provinsi: 'Bali', elevasiM: 3142, level: 1, lat: -8.342, lon: 115.508,
    });
  });

  test('extractJsonLiteral tidak tertipu kurung di dalam string', () => {
    const html = 'var data = [{"teks":"a ] b } \\" c"}, [1]]; var lain = [];';
    assert.deepEqual(JSON.parse(extractJsonLiteral(html, 'data')), [{ teks: 'a ] b } " c' }, [1]]);
  });

  test('halaman yang berubah format ditolak', () => {
    assert.throws(() => extractVolcanoes('<html>tanpa data</html>'), /tidak ditemukan/);
    assert.throws(() => extractVolcanoes('var markersGunungApi = [];'), /hanya berisi 0/);
  });
});

describe('batas wilayah', () => {
  test('parseBoundarySql menerima spasi setelah koma dan tanda kutip ganda', () => {
    const sql = `('63','Kalimantan Selatan',-3.48, 114.83,'[[[-4.9,115.6],[-4.8,115.7],[-4.7,115.6]]]'),
      ('82.72','Kota Tidore Kepulauan',0.6,127.4,'[[[0.1,127.1],[0.2,127.2],[0.3,127.1]]]'),
      ('99.01','Pulau O''Brien',1,1,'[[[1,1],[1,2],[2,2]]]')`;
    const rows = parseBoundarySql(sql);
    assert.deepEqual(rows.map((r) => r.kode), ['63', '82.72', '99.01']);
    assert.equal(rows[2].nama, "Pulau O'Brien");
  });

  test('toRings membalik [lat, lng], menutup cincin, dan membuang cincin kembar', () => {
    const ring = [[-6, 106], [-6, 107], [-7, 107]];
    const rings = toRings([[[ring, ring]], [ring.slice(0, 2)]]);
    assert.deepEqual(rings, [[[106, -6], [107, -6], [107, -7], [106, -6]]]);
  });
});
