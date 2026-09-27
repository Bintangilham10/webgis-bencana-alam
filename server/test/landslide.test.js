import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { occurredAt } from '../scripts/seed-landslides.js';
import { memoize } from '../src/lib/cache.js';
import { createGazetteer, fetchDasarian } from '../src/lib/recorder.js';
import { slopeClass } from '../src/lib/warning-rules.js';
import { buildRiskProfile } from '../src/risk/profile.js';
import { codeLevels, dasarianRange, levelFor } from '../src/sources/bmkg-cews.js';
import { parseForecast, slopeDegrees, slopeStencil } from '../src/sources/open-meteo.js';
import { monthOf, parseFeatureInfoText } from '../src/sources/pvmbg.js';

// Fixture = respons asli sumber, sama dengan fixture perekam (diambil 27 Sep 2026).
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const wilayah = JSON.parse(readFileSync(new URL('../../recorder/data/wilayah.json', import.meta.url), 'utf8'));

describe('PVMBG prakiraan gerakan tanah', () => {
  test('potensi bulan ini dan ZKGT dari GetFeatureInfo', () => {
    assert.deepEqual(
      parseFeatureInfoText(fixture('pvmbg-prakiraan-garut.json')),
      { potensi: 'Menengah', zkgt: 'Menengah', zona: '003', tahun_zkgt: 2016, wilayah_zkgt: 'Jawa Barat' },
    );
    assert.equal(parseFeatureInfoText('{"type":"FeatureCollection","features":[]}'), null);
  });

  test('halaman blokir firewall dan layer rusak tidak terbaca sebagai data', () => {
    assert.throws(() => parseFeatureInfoText('<html><head><title>Request Rejected</title></head></html>'), /firewall/);
    assert.throws(() => parseFeatureInfoText('<?xml version="1.0"?><ServiceExceptionReport/>'), /rusak/);
  });

  test('bulan prakiraan mengikuti tanggal WIB', () => {
    assert.deepEqual(monthOf('2026-09-30T16:59:00Z'), { year: 2026, month: 9 });
    assert.deepEqual(monthOf('2026-09-30T17:00:00Z'), { year: 2026, month: 10 });
  });
});

describe('BMKG CEWS', () => {
  // Fixture = balasan asli per indeks legenda (0 Aman … 3 Awas), dasarian III Sep 2026.
  const responses = JSON.parse(fixture('cews-2026-09-3.json'));
  const fakeHttp = { postForm: async (url, fields) => JSON.stringify(responses[fields.legendindex]) };

  test('nama kab/kota tiap level dicocokkan ke kode Kepmendagri', async () => {
    const levels = await fetchDasarian(fakeHttp, { year: 2026, month: 9, num: 3 }, async () => {});
    const { byCode, unmatched } = codeLevels(levels, createGazetteer(wilayah));
    assert.equal(byCode['13.06'], 1); // Agam: Waspada
    assert.equal(byCode['13.71'], 1); // Kota Padang: Waspada
    assert.equal(byCode['32.05'], 0); // Garut: Aman
    assert.equal(Object.values(byCode).filter((l) => l === 1).length, 10);
    assert.ok(unmatched.every((name) => !/AGAM|PADANG/.test(name)));
  });

  test('rentang tanggal dasarian, termasuk akhir Februari kabisat', () => {
    assert.deepEqual(dasarianRange({ year: 2026, month: 9, num: 3 }), { start: '2026-09-21', end: '2026-09-30' });
    assert.deepEqual(dasarianRange({ year: 2024, month: 2, num: 3 }), { start: '2024-02-21', end: '2024-02-29' });
    assert.deepEqual(dasarianRange({ year: 2026, month: 10, num: 2 }), { start: '2026-10-11', end: '2026-10-20' });
  });

  test('kab/kota tak tercantum = Aman; produk belum terbit = tidak diketahui', () => {
    const warnings = { published: true, by_code: { '13.06': 1 } };
    assert.equal(levelFor(warnings, '13.06'), 1);
    assert.equal(levelFor(warnings, '32.05'), 0);
    assert.equal(levelFor({ published: false, by_code: {} }, '13.06'), null);
    assert.equal(levelFor(warnings, null), null);
  });
});

describe('Open-Meteo: hujan anteseden dan lereng', () => {
  test('hari lalu dipisah dari hari prakiraan', () => {
    const forecast = parseForecast(
      {
        elevation: 709,
        daily: {
          time: ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'],
          precipitation_sum: [0, 4.1, 3, 4.9],
          precipitation_probability_max: [null, null, null, 100],
        },
      },
      3,
    );
    assert.deepEqual(forecast.pastDays.map((d) => d.precipitationMm), [0, 4.1, 3]);
    assert.deepEqual(forecast.days, [{ date: '2026-09-27', precipitationMm: 4.9, probabilityPct: 100 }]);
  });

  test('kemiringan dari elevasi utara, selatan, timur, barat', () => {
    // Naik 180 m sejauh 180 m ke utara = 45°.
    assert.ok(Math.abs(slopeDegrees([190, 10, 100, 100]) - 45) < 1e-9);
    assert.equal(slopeDegrees([50, 50, 50, 50]), 0);
    assert.throws(() => slopeDegrees([50, null, 50, 50]), /tidak lengkap/);
  });

  test('titik stensil berjarak ±90 m, bujur dikoreksi lintang', () => {
    const [north, , east] = slopeStencil(-7, 110);
    assert.ok(Math.abs((north.lat + 7) * 111_320 - 90) < 1e-6);
    assert.ok(east.lon - 110 > 90 / 111_320);
  });

  test('kelas lereng Van Zuidam', () => {
    assert.equal(slopeClass(1.9).id, 'datar');
    assert.equal(slopeClass(16).id, 'curam');
    assert.equal(slopeClass(60).id, 'terjal');
    assert.equal(slopeClass(null), null);
  });
});

describe('profil risiko: bagian tanah longsor', () => {
  const base = {
    lat: -7.275,
    lon: 109.67,
    place: { kode: '33.04', nama: 'Kabupaten Banjarnegara', provinsi: 'Jawa Tengah' },
    hazardIndices: {},
    forecast: {
      elevationM: 900,
      pastDays: [{ date: '2026-09-24', precipitationMm: 40 }, { date: '2026-09-25', precipitationMm: 12.5 }, { date: '2026-09-26', precipitationMm: null }],
      days: [],
    },
    fault: null,
    volcanoes: [],
    quakes: { count: 0 },
  };
  const history = { radius_km: 5, count: 3, nearest: { tanggal: '2021-02-10', distance_km: 1.2 }, latest: { tanggal: '2023-01-05', distance_km: 4 } };

  test('produk resmi, hujan anteseden, ensemble, lereng, dan riwayat digabung', () => {
    const profile = buildRiskProfile({
      ...base,
      landslide: {
        potential: { month: '2026-09', current: true, potensi: 'Tinggi', zkgt: 'Tinggi' },
        rainWarning: { dasarian: { year: 2026, month: 9, num: 3, start: '2026-09-21', end: '2026-09-30' }, published: true, level: 2 },
        ensemble: { model: 'ecmwf_ifs025', days: [{ date: '2026-09-27', n: 51, median: 30, p90: 80, p50: 0.25, p100: 0.02 }] },
        slope: { degrees: 18.4, stepM: 90 },
        history,
      },
    });
    const { landslide } = profile;
    assert.equal(landslide.potential.potensi, 'Tinggi');
    assert.equal(landslide.rain_warning.label, 'Siaga');
    assert.equal(landslide.antecedent_rain.total_mm, 52.5);
    assert.deepEqual(landslide.ensemble.days[0], { date: '2026-09-27', members: 51, median_mm: 30, p90_mm: 80, prob_50mm: 0.25, prob_100mm: 0.02 });
    assert.equal(landslide.slope.class.id, 'curam');
    assert.equal(landslide.history.count, 3);
    assert.ok(profile.recommendations.some((t) => t.startsWith('Prakiraan PVMBG September 2026: potensi gerakan tanah tinggi')));
    assert.ok(profile.recommendations.some((t) => t.includes('level siaga untuk Kabupaten Banjarnegara (2026-09-21 s.d. 2026-09-30)')));
  });

  test('sumber yang gagal hanya mengisi error pada bagiannya', () => {
    const profile = buildRiskProfile({
      ...base,
      landslide: {
        potential: { error: 'permintaan diblokir firewall situs ESDM' },
        rainWarning: { error: 'HTTP 503' },
        ensemble: { error: 'timeout' },
        slope: { error: 'timeout' },
        history: { radius_km: 5, count: 0, nearest: null, latest: null },
      },
    });
    assert.deepEqual(profile.landslide.potential, { error: 'permintaan diblokir firewall situs ESDM' });
    assert.deepEqual(profile.landslide.rain_warning, { error: 'HTTP 503' });
    assert.equal(profile.landslide.antecedent_rain.total_mm, 52.5);
    assert.ok(!profile.recommendations.some((t) => t.startsWith('Prakiraan PVMBG') || t.startsWith('BMKG:')));
  });
});

describe('cache', () => {
  test('permintaan serentak untuk kunci yang sama memanggil sumber sekali', async () => {
    let calls = 0;
    const load = memoize(async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return calls;
    }, 60_000);
    const results = await Promise.all([load('a'), load('a'), load('a')]);
    assert.deepEqual(results, [1, 1, 1]);
    assert.equal(calls, 1);
  });

  test('hasil gagal tidak disimpan', async () => {
    let calls = 0;
    const load = memoize(async () => {
      calls++;
      if (calls === 1) throw new Error('gagal');
      return 'ok';
    }, 60_000);
    await assert.rejects(load('a'), /gagal/);
    assert.equal(await load('a'), 'ok');
  });
});

describe('seed riwayat longsor', () => {
  test('laporan tanpa jam dicatat 00.00 WIB', () => {
    assert.equal(occurredAt({ tanggal: '2021-02-10', waktu_utc: null }), '2021-02-10T00:00:00+07:00');
    assert.equal(occurredAt({ tanggal: '2023-02-23', waktu_utc: '2023-02-23T16:00:00+00:00' }), '2023-02-23T16:00:00+00:00');
  });
});
