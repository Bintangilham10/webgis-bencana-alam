import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hazardClassByValue, heavyRainIndication, outlookIndications, rainHazardIndications } from '../src/lib/warning-rules.js';
import { rainPoint, regionDailyOutlook, regionOutlook, summarizeDays } from '../src/risk/outlook.js';
import { fetchRainPoints, rainBatchUrl } from '../src/sources/open-meteo.js';

const DATES = ['2026-09-29', '2026-09-30', '2026-10-01'];
const PAST_DATES = ['2026-09-26', '2026-09-27', '2026-09-28'];
const series = (values, dates = DATES) => values.map((precipitationMm, i) => ({ date: dates[i], precipitationMm }));
const rain = (forecast, past = [0, 0, 0]) => ({ days: series(forecast), pastDays: series(past, PAST_DATES) });

describe('aturan v0.1: hujan lebat dan akumulasi bergulir', () => {
  test('indikasi hujan lebat dari kategori hujan harian tertinggi', () => {
    const lebat = heavyRainIndication(series([12, 72, 3]));
    assert.equal(lebat.level, 1);
    assert.equal(lebat.label, 'Waspada');
    assert.equal(lebat.peakDate, '2026-09-30');
    assert.equal(lebat.reason, 'hujan tertinggi 72 mm/hari (hujan lebat)');
    assert.equal(heavyRainIndication(series([45, 0, 0])).level, 0);
    assert.equal(heavyRainIndication(series([100, 0, 0])).level, 2);
    assert.equal(heavyRainIndication(series([0, 160, 0])).label, 'Awas');
    assert.equal(heavyRainIndication(series([null, null, null])), null);
  });

  test('akumulasi 3 hari ikut menghitung hujan beberapa hari terakhir, hanya untuk longsor', () => {
    const hazards = { banjir: { class: hazardClassByValue(3) }, longsor: { class: hazardClassByValue(3) } };
    // Hari pertama prakiraan: 40 + 20 (dua hari terakhir) + 45 = 105 mm.
    const wet = rainHazardIndications(hazards, series([45, 5, 0]), series([50, 40, 20], PAST_DATES));
    const byHazard = Object.fromEntries(wet.map((i) => [i.hazard, i]));
    assert.equal(byHazard.longsor.level, 1);
    assert.equal(byHazard.longsor.peakDate, '2026-09-29');
    assert.match(byHazard.longsor.reason, /akumulasi hujan 3 hari 105 mm.*zona bahaya tinggi \(InaRISK\)/);
    assert.equal(byHazard.banjir.level, 0);

    // Tanpa hujan hari-hari terakhir, jendela terbasah hanya 50 mm.
    const dry = rainHazardIndications(hazards, series([45, 5, 0]));
    assert.equal(dry.find((i) => i.hazard === 'longsor').level, 0);
  });

  test('kelas dari raster (1–3) dan di luar zona (0)', () => {
    assert.equal(hazardClassByValue(1).id, 'rendah');
    assert.equal(hazardClassByValue(3).id, 'tinggi');
    assert.equal(hazardClassByValue(0), null);
  });

  test('cek risiko titik memakai tiga indikasi yang sama', () => {
    const indications = outlookIndications({ banjir: { index: 0.8 }, longsor: { index: null } }, series([10, 120, 0]));
    assert.deepEqual(
      indications.map((i) => [i.hazard, i.level]),
      [['hujan', 2], ['banjir', 2], ['longsor', 0]],
    );
  });
});

describe('indikasi per kab/kota', () => {
  test('hujan diminta di koordinat 3 desimal, sama dengan cek risiko', () => {
    assert.deepEqual(rainPoint(-6.9, 107.1), { key: '-6.900,107.100', lat: -6.9, lon: 107.1 });
    assert.deepEqual(rainPoint(-7.382549, 106.65251), { key: '-7.383,106.653', lat: -7.383, lon: 106.653 });
  });

  // Titik acuan, satu titik zona banjir tinggi, dan dua titik zona longsor.
  const points = [
    { hazard: 'acuan', kelas: 0, lat: -7.0, lon: 107.0, rain: rain([10, 5, 0]) },
    { hazard: 'banjir', kelas: 3, lat: -6.9, lon: 107.1, rain: rain([20, 120, 0]) },
    { hazard: 'longsor', kelas: 2, lat: -7.2, lon: 107.3, rain: rain([60, 10, 0]) },
    { hazard: 'longsor', kelas: 3, lat: -7.4, lon: 107.2, rain: rain([30, 10, 0]) },
  ];
  const rainAt = (point) => point.rain;
  const byHazard = (outlook) => Object.fromEntries(outlook.map((o) => [o.hazard, o]));

  test('level kab/kota = level tertinggi dari titik-titiknya, beserta titik dan tanggalnya', () => {
    const outlook = byHazard(regionOutlook(points, rainAt));
    assert.equal(outlook.hujan.level, 2);
    assert.deepEqual([outlook.hujan.lat, outlook.hujan.lon], [-6.9, 107.1]);
    assert.equal(outlook.banjir.level, 2);
    assert.equal(outlook.banjir.peakDate, '2026-09-30');
    // Hujan lebat di zona sedang (Waspada) mengalahkan hujan sedang di zona tinggi (Normal).
    assert.equal(outlook.longsor.level, 1);
    assert.deepEqual([outlook.longsor.lat, outlook.longsor.lon], [-7.2, 107.3]);
    assert.match(outlook.longsor.reason, /zona bahaya sedang \(InaRISK\)/);
  });

  test('level sama: titik dengan hujan tertinggi yang dipilih', () => {
    const tie = [
      { hazard: 'longsor', kelas: 2, lat: -7.2, lon: 107.3, rain: rain([60, 0, 0]) },
      { hazard: 'longsor', kelas: 3, lat: -7.4, lon: 107.2, rain: rain([0, 90, 0]) },
    ];
    const outlook = byHazard(regionOutlook(tie, rainAt));
    assert.equal(outlook.longsor.level, 1);
    assert.equal(outlook.longsor.lat, -7.4);
  });

  test('tanpa zona bahaya: Normal dengan alasan; tanpa hujan: tidak ada data', () => {
    const [acuan] = points;
    const onlyReference = byHazard(regionOutlook([acuan], rainAt));
    assert.equal(onlyReference.hujan.level, 0);
    assert.equal(onlyReference.banjir.level, 0);
    assert.match(onlyReference.banjir.reason, /tidak ada zona bahaya banjir InaRISK/);
    assert.match(onlyReference.longsor.reason, /tanah longsor/);

    const noRain = regionOutlook(points, () => null);
    assert.ok(noRain.every((o) => o.level === null && /gagal dimuat/.test(o.reason)));
  });

  test('level per hari: hari yang sudah lewat tidak ikut menentukan jendela berikutnya', () => {
    const daily = regionDailyOutlook(points, rainAt, DATES);
    assert.equal(daily.length, DATES.length * 3);
    const on = (date, hazard) => daily.find((d) => d.date === date && d.hazard === hazard);
    assert.equal(on('2026-09-29', 'longsor').level, 1);
    assert.equal(on('2026-09-30', 'banjir').level, 2);
    assert.equal(on('2026-09-30', 'banjir').rainMm, 120);
    assert.equal(on('2026-09-30', 'banjir').reason, 'hujan 120 mm/hari (hujan sangat lebat); zona bahaya tinggi (InaRISK)');
    assert.equal(on('2026-10-01', 'hujan').level, 0);

    // Jendela 29 Sep–1 Okt: puncak banjir 30 Sep. Jendela mulai 1 Okt: Normal.
    const all = Object.fromEntries(summarizeDays(daily, DATES).map((s) => [s.hazard, s]));
    assert.deepEqual([all.banjir.level, all.banjir.peakDate], [2, '2026-09-30']);
    const later = Object.fromEntries(summarizeDays(daily, ['2026-10-01']).map((s) => [s.hazard, s]));
    assert.deepEqual([later.hujan.level, later.banjir.level, later.longsor.level], [0, 0, 0]);
    assert.equal(later.banjir.peakDate, null);
  });

  test('akumulasi longsor per hari memakai hujan hari-hari sebelumnya', () => {
    const wet = [{ hazard: 'longsor', kelas: 3, lat: -7.4, lon: 107.2, rain: rain([30, 40, 0], [0, 10, 20]) }];
    const daily = regionDailyOutlook(wet, rainAt, DATES);
    const longsor = (date) => daily.find((d) => d.date === date && d.hazard === 'longsor');
    // 10 + 20 + 30 = 60 mm pada 29 Sep; 20 + 30 + 40 = 90 mm pada 30 Sep: belum 100 mm.
    assert.equal(longsor('2026-09-30').level, 0);
    const wetter = regionDailyOutlook([{ ...wet[0], rain: rain([30, 75, 0], [0, 10, 20]) }], rainAt, DATES);
    const day2 = wetter.find((d) => d.date === '2026-09-30' && d.hazard === 'longsor');
    assert.equal(day2.level, 1);
    assert.match(day2.reason, /^hujan 75 mm\/hari \(hujan lebat\)/);
    const day3 = wetter.find((d) => d.date === '2026-10-01' && d.hazard === 'longsor');
    assert.equal(day3.level, 1);
    // 1 Okt kering, tetapi 30 + 75 + 0 = 105 mm dalam 3 hari: setara hujan lebat untuk longsor.
    assert.match(day3.reason, /^akumulasi hujan 3 hari 105 mm/);
  });
});

describe('hujan untuk banyak lokasi (Open-Meteo)', () => {
  const cells = Array.from({ length: 5 }, (_, i) => ({ key: `c${i}`, lat: -7 + i * 0.25, lon: 107 }));
  // Balasan Open-Meteo: satu objek per lokasi, urutannya sama dengan permintaan.
  const reply = (url) => {
    const count = new URL(url).searchParams.get('latitude').split(',').length;
    const location = { elevation: 10, daily: { time: [...PAST_DATES, ...DATES], precipitation_sum: [1, 2, 3, 40, 50, 60] } };
    return count === 1 ? location : Array.from({ length: count }, () => location);
  };

  test('URL memuat semua lokasi, 3 hari lalu, dan 4 hari prakiraan', () => {
    const url = new URL(rainBatchUrl(cells.slice(0, 2)));
    assert.equal(url.searchParams.get('latitude'), '-7,-6.75');
    assert.equal(url.searchParams.get('past_days'), '3');
    assert.equal(url.searchParams.get('forecast_days'), '4');
    assert.equal(url.searchParams.get('timezone'), 'Asia/Jakarta');
  });

  test('lokasi dikirim per batch dengan jeda', async () => {
    const pauses = [];
    const { rain: result, failed } = await fetchRainPoints(cells, {
      batchSize: 2,
      pauseMs: 12_000,
      sleep: async (ms) => pauses.push(ms),
      clock: () => 0,
      getJson: async (url) => reply(url),
    });
    assert.equal(failed, 0);
    assert.equal(result.size, 5);
    assert.deepEqual(pauses, [12_000, 12_000]);
    assert.deepEqual(result.get('c4').pastDays.map((d) => d.precipitationMm), [1, 2, 3]);
    assert.deepEqual(result.get('c4').days.map((d) => d.precipitationMm), [40, 50, 60]);
  });

  test('kuota per menit habis: tunggu satu menit lalu coba lagi', async () => {
    const pauses = [];
    let calls = 0;
    const { rain: result, failed } = await fetchRainPoints(cells.slice(0, 2), {
      sleep: async (ms) => pauses.push(ms),
      getJson: async (url) => {
        if (calls++ === 0) throw Object.assign(new Error('HTTP 429'), { status: 429 });
        return reply(url);
      },
    });
    assert.equal(failed, 0);
    assert.equal(result.size, 2);
    assert.deepEqual(pauses, [65_000]);
  });

  test('batch gagal dihitung; tiga kegagalan berturut-turut menghentikan permintaan', async () => {
    let calls = 0;
    const { rain: result, failed, error } = await fetchRainPoints(cells, {
      batchSize: 1,
      sleep: async () => {},
      getJson: async () => {
        calls++;
        throw new Error('HTTP 502');
      },
    });
    assert.equal(calls, 3);
    assert.equal(failed, 5);
    assert.equal(result.size, 0);
    assert.equal(error, 'HTTP 502');
  });

  test('balasan yang sudah lambat tidak ditambah jeda; tenggat menghentikan batch baru', async () => {
    let now = 0;
    const pauses = [];
    const { rain: result, notStarted } = await fetchRainPoints(cells, {
      batchSize: 2,
      pauseMs: 12_000,
      deadline: 30_000,
      clock: () => now,
      sleep: async (ms) => {
        pauses.push(ms);
        now += ms;
      },
      // Tiap balasan butuh 20 detik.
      getJson: async (url) => {
        now += 20_000;
        return reply(url);
      },
    });
    assert.deepEqual(pauses, []);
    assert.equal(result.size, 4);
    assert.equal(notStarted, 1);
  });

  test('jumlah lokasi di balasan harus sama dengan yang diminta', async () => {
    const { failed, error } = await fetchRainPoints(cells.slice(0, 3), { sleep: async () => {}, getJson: async () => [reply('https://x/?latitude=1')] });
    assert.equal(failed, 3);
    assert.match(error, /mengirim 1 lokasi, diminta 3/);
  });
});
