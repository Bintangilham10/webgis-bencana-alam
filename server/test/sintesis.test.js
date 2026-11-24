import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { agreement, capLevel, combine, countKey, quakeRule, volcanoLevel } from '../src/risk/sintesis.js';

const NONE = { hujan: null, banjir: null, longsor: null };

describe('status sintesis per kab/kota', () => {
  test('status = level tertinggi dari kelompok hujan, gempa, dan gunung api', () => {
    const r = combine({ cews: 2, cap: 1, gempa: 0, gunungapi: 0 }, NONE);
    assert.equal(r.status, 2);
    assert.equal(r.state, 'pasti');
    assert.equal(r.hidromet, 2);
    assert.deepEqual(r.drivers, ['cews']);
    assert.equal(r.sekarang, 1);
    assert.equal(r.prakiraan, 2);
  });

  test('penentu yang sama tinggi diurutkan dari yang paling mendesak', () => {
    const r = combine({ cews: 1, cap: 1, gempa: 1, gunungapi: 0 }, NONE);
    assert.deepEqual(r.drivers, ['cap', 'gempa', 'cews']);
  });

  test('sumber tanpa data tidak pernah dianggap aman', () => {
    // Semua yang ada Normal, tetapi gempa tanpa data: belum pasti.
    assert.equal(combine({ cews: 0, cap: 0, gempa: null, gunungapi: 0 }, NONE).state, 'belum_pasti');
    // CEWS belum terbit walau CAP ada: Normal belum pasti, dan prakiraan tidak diketahui.
    const noCews = combine({ cews: null, cap: 0, gempa: 0, gunungapi: 0 }, NONE);
    assert.equal(noCews.state, 'belum_pasti');
    assert.equal(noCews.prakiraan, null);
    assert.equal(noCews.sekarang, 0);
    // CAP basi: horizon sekarang tidak pasti.
    assert.equal(combine({ cews: 0, cap: null, gempa: 0, gunungapi: 0 }, NONE).sekarang, null);
    // Level di atas Normal tetap pasti walau ada sumber lain yang hilang.
    const r = combine({ cews: null, cap: null, gempa: 1, gunungapi: 0 }, NONE);
    assert.equal(r.status, 1);
    assert.equal(r.state, 'pasti');
    assert.equal(r.minimal, true);
    const none = combine({ cews: null, cap: null, gempa: null, gunungapi: null }, NONE);
    assert.equal(none.state, 'tanpa_data');
    assert.equal(none.status, null);
    assert.equal(countKey(none), 'belum_pasti');
  });

  test('indikasi SIGAP ditampilkan di samping status, hanya masuk ke gabungan', () => {
    const r = combine({ cews: 0, cap: 0, gempa: 0, gunungapi: 0 }, { hujan: 1, banjir: 0, longsor: 2 });
    assert.equal(r.status, 0);
    assert.equal(r.indikasi, 2);
    assert.equal(r.gabungan, 2);
    // Horizon prakiraan hanya dari CEWS resmi.
    assert.equal(r.prakiraan, 0);
    assert.equal(countKey(r), 'normal');
  });
});

describe('aturan komponen', () => {
  test('tingkat keparahan CAP', () => {
    assert.equal(capLevel('Moderate'), 1);
    assert.equal(capLevel('Severe'), 2);
    assert.equal(capLevel('Extreme'), 3);
    assert.equal(capLevel('Unknown'), 1);
  });

  test('gempa: magnitudo, potensi tsunami, dan gempa kecil yang dirasakan', () => {
    assert.equal(quakeRule({ magnitude: 7.1 }).level, 3);
    assert.equal(quakeRule({ magnitude: 5.6, potensi: 'Berpotensi tsunami' }).level, 3);
    assert.equal(quakeRule({ magnitude: 5.6, potensi: 'Tidak berpotensi tsunami' }).radiusKm, 50);
    assert.equal(quakeRule({ magnitude: 6.2 }).level, 2);
    assert.equal(quakeRule({ magnitude: 3.4, dirasakan: 'II Bandung' }).radiusKm, 25);
    assert.equal(quakeRule({ magnitude: 4.2 }), null);
    assert.equal(quakeRule({ magnitude: 4.2, dirasakan: '-' }), null);
    assert.equal(quakeRule({ magnitude: 4.2, potensi: 'Gempa ini dirasakan untuk diteruskan pada masyarakat' }).radiusKm, 25);
  });

  test('gunung api: level MAGMA dikurangi satu', () => {
    assert.equal(volcanoLevel(1), 0);
    assert.equal(volcanoLevel(3), 2);
    assert.equal(volcanoLevel(4), 3);
  });
});

describe('kesepakatan indikasi SIGAP dan CEWS', () => {
  test('tabel 2×2 dan Cohen kappa, kab/kota tanpa data tidak dihitung', () => {
    const pairs = [
      ...Array(20).fill([1, 1]),
      ...Array(10).fill([1, 0]),
      ...Array(5).fill([0, 2]),
      ...Array(65).fill([0, 0]),
      [null, 1],
      [2, null],
    ];
    const k = agreement(pairs);
    assert.deepEqual([k.both, k.onlyA, k.onlyB, k.neither, k.n], [20, 10, 5, 65, 100]);
    // po = 0,85; pe = 0,3·0,25 + 0,7·0,75 = 0,6 → κ = 0,625
    assert.equal(k.kappa, 0.63);
    assert.equal(agreement([[null, 1]]).kappa, null);
  });
});
