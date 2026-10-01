import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hazardClass, rainCategory, rainHazardIndications, warningLevel } from '../src/lib/warning-rules.js';
import { regionStatus } from '../src/risk/profile.js';
import { recommendations } from '../src/risk/recommendations.js';
import { matchesWordStart, rankResults } from '../src/routes/geocode.js';
import { parseIdentifyValue } from '../src/sources/inarisk.js';
import { toPlace } from '../src/sources/nominatim.js';
import { parseForecast } from '../src/sources/open-meteo.js';

const day = (precipitationMm, date = '2026-09-26') => ({ date, precipitationMm, probabilityPct: 80 });

describe('aturan peringatan (baseline v0)', () => {
  test('kelas indeks bahaya BNPB: sepertiga dengan batas atas inklusif', () => {
    assert.equal(hazardClass(null), null);
    assert.equal(hazardClass(0), null);
    // Indeks longsor InaRISK = zona kerentanan PVMBG: 1/3 rendah, 2/3 menengah, 1 tinggi.
    assert.equal(hazardClass(0.333333).id, 'rendah');
    assert.equal(hazardClass(1 / 3).id, 'rendah');
    assert.equal(hazardClass(0.3335).id, 'sedang');
    assert.equal(hazardClass(0.666).id, 'sedang');
    assert.equal(hazardClass(0.666667).id, 'sedang');
    assert.equal(hazardClass(2 / 3).id, 'sedang');
    assert.equal(hazardClass(0.6668).id, 'tinggi');
    assert.equal(hazardClass(1).id, 'tinggi');
  });

  test('kategori hujan harian BMKG', () => {
    assert.equal(rainCategory(0.4), null);
    assert.equal(rainCategory(0.5).id, 'ringan');
    assert.equal(rainCategory(20).id, 'sedang');
    assert.equal(rainCategory(50).id, 'lebat');
    assert.equal(rainCategory(100).id, 'sangat_lebat');
    assert.equal(rainCategory(150).id, 'ekstrem');
  });

  test('matriks hujan × bahaya sesuai plan', () => {
    assert.equal(warningLevel('sedang', 'tinggi'), 0);
    assert.equal(warningLevel('lebat', 'rendah'), 0);
    assert.equal(warningLevel('lebat', 'sedang'), 1);
    assert.equal(warningLevel('sangat_lebat', 'tinggi'), 2);
    assert.equal(warningLevel('ekstrem', 'tinggi'), 3);
    assert.equal(warningLevel(undefined, 'tinggi'), 0);
  });

  test('hujan tertinggi dalam prakiraan menentukan indikasi banjir', () => {
    const [banjir] = rainHazardIndications({ banjir: { index: 0.8 }, longsor: { index: null } }, [day(12), day(160), day(3)]);
    assert.equal(banjir.hazard, 'banjir');
    assert.equal(banjir.label, 'Awas');
    assert.match(banjir.reason, /160 mm\/hari \(hujan ekstrem\).*tinggi \(0,8\)/);
  });

  test('akumulasi hujan 3 hari menaikkan indikasi longsor walau hujan harian tidak lebat', () => {
    const indications = rainHazardIndications({ banjir: { index: 0.5 }, longsor: { index: 0.5 } }, [day(40), day(35), day(30)]);
    const byHazard = Object.fromEntries(indications.map((i) => [i.hazard, i]));
    assert.equal(byHazard.banjir.label, 'Normal');
    assert.equal(byHazard.longsor.label, 'Waspada');
    assert.match(byHazard.longsor.reason, /akumulasi hujan 3 hari 105 mm/);
  });

  test('lokasi di luar zona bahaya selalu Normal', () => {
    const [banjir] = rainHazardIndications({ banjir: { index: null } }, [day(200)]);
    assert.equal(banjir.label, 'Normal');
    assert.match(banjir.reason, /di luar zona bahaya/);
  });
});

describe('rekomendasi', () => {
  test('hanya bahaya sedang/tinggi, sesar dekat, dan gunung api aktif yang dekat', () => {
    const tips = recommendations({
      hazards: [
        { id: 'gempa', class: { id: 'tinggi' } },
        { id: 'banjir', class: { id: 'rendah' } },
        { id: 'longsor', class: null },
      ],
      indications: [{ hazard: 'banjir', level: 1, label: 'Waspada' }],
      fault: { nama: 'Lembang Fault', distance_km: 9.9 },
      volcanoes: [
        { nama: 'Merapi', level: 3, level_label: 'Siaga', distance_km: 25 },
        { nama: 'Merbabu', level: 1, level_label: 'Normal', distance_km: 20 },
      ],
    });
    assert.ok(tips.some((t) => t.startsWith('Indikasi waspada banjir')));
    assert.ok(tips.some((t) => t.startsWith('Gempa bumi:')));
    assert.ok(!tips.some((t) => t.startsWith('Banjir:')));
    assert.ok(tips.some((t) => t.includes('9,9 km dari Sesar Lembang (sesar aktif)')));
    assert.ok(tips.some((t) => t.startsWith('Gunung Merapi berstatus Siaga')));
    assert.ok(!tips.some((t) => t.includes('Merbabu')));
    assert.match(tips.at(-1), /112/);
  });
});

describe('parser sumber luar', () => {
  test('identify InaRISK: angka, NoData, dan respons rusak', () => {
    assert.equal(parseIdentifyValue({ value: '0.777778' }), 0.777778);
    assert.equal(parseIdentifyValue({ value: 'NoData' }), null);
    assert.throws(() => parseIdentifyValue({ error: { code: 500 } }), /tidak dikenal/);
  });

  test('Open-Meteo: elevasi dan hujan harian', () => {
    const forecast = parseForecast({
      elevation: 715,
      daily: { time: ['2026-09-26', '2026-09-27'], precipitation_sum: [2.7, 9], precipitation_probability_max: [100, 98] },
    });
    assert.equal(forecast.elevationM, 715);
    assert.deepEqual(forecast.days[1], { date: '2026-09-27', precipitationMm: 9, probabilityPct: 98 });
    assert.throws(() => parseForecast({ reason: 'error' }), /tidak dikenal/);
  });

  test('Nominatim: bounding box [selatan, utara, barat, timur] menjadi batas Leaflet', () => {
    const place = toPlace({
      display_name: 'Cibaduyut, Bojongloa Kidul, Kota Bandung, Jawa Barat, Indonesia',
      name: 'Cibaduyut',
      lat: '-6.9531381',
      lon: '107.5933414',
      addresstype: 'suburb',
      boundingbox: ['-6.9574807', '-6.9499704', '107.5899834', '107.5997136'],
    });
    assert.equal(place.name, 'Cibaduyut');
    assert.deepEqual(place.bounds, [[-6.9574807, 107.5899834], [-6.9499704, 107.5997136]]);
  });
});

describe('urutan hasil pencarian', () => {
  const wilayah = (name) => ({ source: 'wilayah', name });
  const osm = (name) => ({ source: 'osm', name });

  test('nama wilayah yang hanya cocok di tengah kata turun ke bawah hasil OSM', () => {
    assert.equal(matchesWordStart('Kota Palembang', 'Lembang'), false);
    assert.equal(matchesWordStart('Kabupaten Garut', 'garut'), true);
    const results = rankResults('Lembang', [wilayah('Kota Palembang')], [osm('Lembang'), osm('Lembang')]);
    assert.deepEqual(results.map((r) => `${r.source}:${r.name}`), ['osm:Lembang', 'osm:Lembang', 'wilayah:Kota Palembang']);
  });

  test('wilayah yang cocok di awal kata tetap di atas, paling banyak empat', () => {
    const names = ['Kota Administrasi Jakarta Timur', 'Kota Administrasi Jakarta Pusat', 'Kota Administrasi Jakarta Utara', 'Kota Administrasi Jakarta Barat', 'Kota Administrasi Jakarta Selatan'];
    const results = rankResults('Jakarta', names.map(wilayah), [osm('Daerah Khusus Ibukota Jakarta')]);
    assert.deepEqual(results.map((r) => r.source), ['wilayah', 'wilayah', 'wilayah', 'wilayah', 'osm']);
    // Tempat OSM yang namanya sama dengan wilayah tidak diulang.
    assert.deepEqual(rankResults('Garut', [wilayah('Kabupaten Garut')], [osm('kabupaten garut'), osm('Garut')]).map((r) => r.name), ['Kabupaten Garut', 'Garut']);
  });
});

describe('status lokasi cek risiko', () => {
  const place = (distanceKm) => ({ kode: '32.17', nama: 'Kabupaten Bandung Barat', provinsi: 'Jawa Barat', distance_km: distanceKm });

  test('di dalam kab/kota, di pesisir (≤ 1 km), di perairan, atau di negara lain', () => {
    assert.equal(regionStatus(place(0), 1257), 'indonesia');
    assert.equal(regionStatus(place(0.4), 3), 'pesisir');
    assert.equal(regionStatus(place(12), 0), 'perairan');
    // Kuala Lumpur: daratan (55 m) ±90 km dari kab/kota terdekat.
    assert.equal(regionStatus(place(90), 55), 'luar_indonesia');
    assert.equal(regionStatus(place(90), null), 'luar_batas');
    assert.equal(regionStatus(null, 10), 'luar_batas');
  });

  test('di negara lain tidak ada saran nomor darurat Indonesia', () => {
    const tips = recommendations({ hazards: [], indications: [], fault: null, volcanoes: [], status: 'luar_indonesia' });
    assert.equal(tips.length, 1);
    assert.match(tips[0], /di luar wilayah Indonesia/);
  });
});
