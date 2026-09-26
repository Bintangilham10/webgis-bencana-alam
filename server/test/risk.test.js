import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hazardClass, rainCategory, rainHazardIndications, warningLevel } from '../src/lib/warning-rules.js';
import { recommendations } from '../src/risk/recommendations.js';
import { parseIdentifyValue } from '../src/sources/inarisk.js';
import { toPlace } from '../src/sources/nominatim.js';
import { parseForecast } from '../src/sources/open-meteo.js';

const day = (precipitationMm, date = '2026-09-26') => ({ date, precipitationMm, probabilityPct: 80 });

describe('aturan peringatan (baseline v0)', () => {
  test('kelas indeks bahaya BNPB memakai nilai yang dibulatkan 3 desimal', () => {
    assert.equal(hazardClass(null), null);
    assert.equal(hazardClass(0), null);
    assert.equal(hazardClass(0.333333).id, 'rendah');
    assert.equal(hazardClass(0.3335).id, 'sedang');
    assert.equal(hazardClass(0.666).id, 'sedang');
    assert.equal(hazardClass(0.666667).id, 'tinggi');
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
