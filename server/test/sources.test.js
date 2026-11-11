import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { depthClass, hasTsunamiPotential } from '../src/lib/classify.js';
import { extractEvents, normalizeEvent } from '../src/sources/bmkg-gempa.js';
import { createHazardIdentifier, PROBE_MS } from '../src/sources/inarisk.js';
import { extractJsonLiteral, extractVolcanoes } from '../src/sources/magma.js';
import { extractEvents as extractUsgsEvents, fetchUsgsDetail, normalizeEvent as normalizeUsgsEvent } from '../src/sources/usgs-gempa.js';
import { fetchEmscEarthquakes, queryUrl as emscQueryUrl } from '../src/sources/emsc-gempa.js';
import { fetchGdacsEvents } from '../src/sources/gdacs.js';
import { buildRiverForecast, returnPeriodLevel, returnPeriodThresholds } from '../src/sources/glofas.js';
import { extractEvents as extractGfzEvents, fetchGfzEarthquakes, mechanismType, queryUrl as gfzQueryUrl } from '../src/sources/gfz-gempa.js';
import {
  buildSeries,
  chooseSensor,
  despike,
  detide,
  fetchStations as fetchSeaStations,
  indonesianStations,
  latestSampleMs,
  levelSensors,
  seriesUrl,
  STATIONS as SEA_STATIONS,
} from '../src/sources/ioc-sealevel.js';
import { fetchMetar, metarUrl, wxLabel } from '../src/sources/metar.js';
import { accumulatedRain, dailyTotals, latestMainHour, sixHourAmounts, STATIONS, toRow } from '../src/sources/synop.js';
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

// Fixture USGS = feed 2.5_week asli (18 Okt 2026), dipangkas menjadi dua gempa di
// kawasan Indonesia dan satu di Karibia.
describe('USGS gempa', () => {
  const feed = () => JSON.parse(fixture('usgs-2.5_week.json'));

  test('hanya gempa di kawasan Indonesia yang diambil, termasuk yang di bawah M4,5', () => {
    assert.deepEqual(extractUsgsEvents(feed()).map((e) => [e.id, e.magnitude]), [
      ['usgs:us6000u34e', 5.2],
      ['usgs:us6000u2rv', 4.4],
    ]);
  });

  test('koordinat [lon, lat, kedalaman] GeoJSON, waktu milidetik, dan jenis magnitudo', () => {
    const [event] = extractUsgsEvents(feed());
    assert.equal(event.source, 'usgs');
    assert.equal(event.lon, 120.2734);
    assert.equal(event.lat, -8.1449);
    assert.equal(event.depthKm, 10);
    assert.equal(event.occurredAt, '2026-10-18T08:00:06.054Z');
    assert.equal(event.props.wilayah, '55 km NNW of Ruteng, Indonesia');
    assert.equal(event.props.mag_type, 'mb');
    assert.equal(event.props.status, 'reviewed');
    // Penanda tsunami USGS bukan peringatan, jadi tidak disimpan.
    assert.ok(!('tsunami' in event.props));
  });

  test('gempa yang punya PAGER atau ground failure ditandai untuk diambil detailnya', () => {
    const detail = JSON.parse(fixture('usgs-detail-us7000st95.json'));
    const event = normalizeUsgsEvent(detail);
    assert.equal(event.code, 'us7000st95');
    assert.equal(event.revision, detail.properties.updated);
    assert.equal(event.hasDetail, true);
    // Gempa di fixture feed hanya punya origin, phase-data, dan dyfi.
    assert.ok(extractUsgsEvents(feed()).every((e) => !e.hasDetail));
  });

  // Fixture detail = gempa M6,7 dekat Palu, 16 Jun 2026 (dipangkas ke PAGER dan
  // ground failure), dan alerts.json PAGER-nya.
  test('detail: PAGER dengan level korban jiwa dan kerugian, ground failure longsor dan likuefaksi', async () => {
    const urls = [];
    const getJson = async (url) => {
      urls.push(url);
      return JSON.parse(fixture(url.endsWith('alerts.json') ? 'usgs-pager-alerts-us7000st95.json' : 'usgs-detail-us7000st95.json'));
    };
    const { pager, ground_failure: gf } = await fetchUsgsDetail('us7000st95', { getJson });
    assert.match(urls[0], /fdsnws\/event\/1\/query\?eventid=us7000st95&format=geojson$/);
    assert.match(urls[1], /losspager.*alerts\.json$/);

    assert.deepEqual({ ...pager, onepager_url: undefined }, {
      alert: 'yellow', max_mmi: 8, reviewed: false, fatality: 'yellow', economic: 'yellow', onepager_url: undefined,
    });
    assert.match(pager.onepager_url, /onepager\.pdf$/);

    assert.equal(gf.landslide.alert, 'orange');
    assert.equal(gf.landslide.area_km2, 18);
    assert.equal(gf.landslide.population, 310);
    assert.match(gf.landslide.overlay_url, /jessee_2018\.png$/);
    assert.deepEqual(gf.landslide.bounds, [[-3.2677083333330907, 118.01562499999999], [1.0510416666666638, 122.35104166666271]]);
    assert.equal(gf.liquefaction.alert, 'orange');
    assert.equal(gf.liquefaction.area_km2, 91);
    assert.equal(gf.liquefaction.population, 39000);
    assert.match(gf.liquefaction.overlay_url, /zhu_2017_general\.png$/);
    assert.deepEqual(gf.focus, [[-1.5229166666666676, 119.86041666666665], [-0.7729166666666676, 120.60208333333331]]);
    assert.equal(gf.rupture_warning, true);
  });

  test('detail: alerts.json PAGER gagal tidak menggagalkan detail; gempa tanpa produk = null', async () => {
    const getJson = async (url) => {
      if (url.endsWith('alerts.json')) throw new Error('HTTP 503');
      return JSON.parse(fixture('usgs-detail-us7000st95.json'));
    };
    const { pager } = await fetchUsgsDetail('us7000st95', { getJson });
    assert.equal(pager.alert, 'yellow');
    assert.equal(pager.fatality, null);

    const bare = await fetchUsgsDetail('us0', { getJson: async () => ({ properties: { products: { origin: [{}] } } }) });
    assert.deepEqual(bare, { pager: null, ground_failure: null });
    await assert.rejects(() => fetchUsgsDetail('us0', { getJson: async () => ({}) }), /format detail USGS/);
  });

  test('gempa tanpa magnitudo dilewati; respons lain ditolak', () => {
    const noMagnitude = { id: 'us0', geometry: { coordinates: [120, -8, 10] }, properties: { mag: null, time: 1 } };
    assert.deepEqual(extractUsgsEvents({ features: [noMagnitude] }), []);
    assert.throws(() => extractUsgsEvents({ error: 'maintenance' }), /format tidak dikenal/);
  });
});

// Fixture EMSC, GDACS, dan GloFAS = respons asli (19 Okt 2026), dipangkas.
describe('EMSC gempa', () => {
  test('kedalaman positif dari properties, lembaga penentu, dan tautan EMSC', async () => {
    const { events } = await fetchEmscEarthquakes({ getJson: async () => JSON.parse(fixture('emsc-indonesia.json')) });
    assert.deepEqual(events.map((e) => [e.id, e.props.auth, e.magnitude]), [
      ['emsc:20261019_0000205', 'BMKG', 3.3],
      ['emsc:20261019_0000165', 'EMSC', 4.8],
      ['emsc:20261019_0000069', 'MMD', 2.3],
    ]);
    const [bmkg] = events;
    assert.equal(bmkg.source, 'emsc');
    assert.equal(bmkg.depthKm, 10);
    assert.equal(bmkg.lat, -8.27);
    assert.equal(bmkg.lon, 120.63);
    assert.equal(bmkg.occurredAt, '2026-10-19T14:25:32.000Z');
    assert.equal(bmkg.props.wilayah, 'FLORES REGION, INDONESIA');
    assert.match(bmkg.props.url, /eventdetails\.html\?unid=20261019_0000205$/);
  });

  test('rentang waktu: 1 hari rutin, 8 hari untuk mengisi celah; kawasan sama dengan USGS', () => {
    const now = Date.parse('2026-10-19T12:00:00Z');
    assert.match(emscQueryUrl({ feed: 'day', now }), /starttime=2026-10-18T12%3A00%3A00/);
    assert.match(emscQueryUrl({ feed: 'week', now }), /starttime=2026-10-11T12%3A00%3A00/);
    assert.match(emscQueryUrl({ now }), /minlat=-12&maxlat=7&minlon=94&maxlon=142/);
  });

  test('balasan tanpa gempa (HTTP 204) = daftar kosong; format lain ditolak', async () => {
    assert.deepEqual((await fetchEmscEarthquakes({ getJson: async () => ({ features: [] }) })).events, []);
    await assert.rejects(() => fetchEmscEarthquakes({ getJson: async () => ({}) }), /format EMSC/);
  });
});

describe('GDACS', () => {
  const real = () => JSON.parse(fixture('gdacs-indonesia.json')).features;
  const greenQuake = { ...real()[1], properties: { ...real()[1].properties, eventid: 9, alertlevel: 'Green' } };

  test('Oranye/Merah setahun ditambah Hijau 7 hari kecuali gempa, terbaru dulu', async () => {
    const urls = [];
    const getJson = async (url) => {
      urls.push(url);
      const [volcano, quake, fire] = real();
      return { features: url.includes('alertlevel=Orange%3BRed') ? [volcano, quake] : [fire, greenQuake] };
    };
    const events = await fetchGdacsEvents({ now: new Date('2026-10-19T12:00:00Z'), getJson });
    assert.ok(urls.every((u) => u.includes('country=Indonesia')));
    assert.ok(urls.some((u) => u.includes('fromdate=2025-10-19') && u.includes('alertlevel=Orange%3BRed')));
    assert.ok(urls.some((u) => u.includes('fromdate=2026-10-12') && u.includes('alertlevel=Green')));
    assert.deepEqual(events.map((e) => [e.id, e.level]), [
      ['WF-1032893', 'green'],
      ['VO-1000148', 'orange'],
      ['EQ-1558059', 'red'],
    ]);
    const quake = events.find((e) => e.type === 'EQ');
    assert.equal(quake.type_label, 'Gempa bumi');
    assert.equal(quake.from, '2026-08-14T21:58:21.000Z');
    assert.equal(quake.severity, 'Magnitude 7.7M, Depth:10km');
    assert.match(quake.report_url, /^https:\/\/www\.gdacs\.org\/report\.aspx/);
    // Ikon pin diturunkan web dari jenis dan level, bukan dari field icon GDACS.
    assert.ok(!('icon_url' in quake));
    // Erupsi tanpa keterangan keparahan.
    assert.equal(events.find((e) => e.type === 'VO').severity, null);
  });

  test('balasan tanpa isi (HTTP 204) = tidak ada kejadian; titik di luar kawasan dan "Magnitude 0" dilewati', async (t) => {
    const [volcano] = real();
    const flood = (eventid, coordinates) => ({
      ...volcano,
      geometry: { ...volcano.geometry, coordinates },
      properties: {
        ...volcano.properties, eventtype: 'FL', eventid, alertlevel: 'Red',
        severitydata: { severity: 0, severitytext: 'Magnitude 0', severityunit: '' },
      },
    });
    const urls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      urls.push(String(url));
      if (String(url).includes('alertlevel=Green')) return new Response(null, { status: 204 });
      // Banjir lintas negara Desember 2025 bertitik di Bangkok.
      return Response.json({ features: [flood(1, [101.6, -0.9]), flood(2, [100.57, 13.83])] });
    });
    const events = await fetchGdacsEvents({ now: new Date('2026-10-19T12:00:00Z') });
    assert.equal(urls.length, 2);
    assert.deepEqual(events.map((e) => [e.id, e.severity]), [['FL-1', null]]);
  });

  test('kejadian yang sama di dua halaman: versi yang paling akhir diubah', async () => {
    const [volcano] = real();
    const older = { ...volcano, properties: { ...volcano.properties, alertlevel: 'Red', datemodified: '2020-01-01T00:00:00' } };
    const events = await fetchGdacsEvents({ getJson: async (url) => ({ features: url.includes('Orange') ? [older, volcano] : [] }) });
    assert.deepEqual(events.map((e) => [e.id, e.level]), [['VO-1000148', 'orange']]);
  });
});

describe('GloFAS debit sungai', () => {
  // Debit harian sintetis: tahun ke-i (i = 1..n) berpuncak i m³/s.
  const history = (years, daysPerYear = 365) => {
    const time = [];
    const discharge = [];
    for (let y = 1; y <= years; y++) {
      for (let d = 0; d < daysPerYear; d++) {
        time.push(`${1990 + y}-01-01`);
        discharge.push(d === 0 ? y : 0.5);
      }
    }
    return { time, river_discharge: discharge };
  };

  test('ambang 2, 5, 20 tahunan dari debit maksimum tahunan; tahun tidak lengkap dilewati', () => {
    const t = returnPeriodThresholds(history(20));
    assert.equal(t.years, 20);
    assert.deepEqual([t.from_year, t.to_year], [1991, 2010]);
    assert.equal(t.rp2, 10.5);
    assert.equal(t.rp5, 16.2);
    assert.ok(Math.abs(t.rp20 - 19.05) < 0.06);
    assert.equal(returnPeriodThresholds(history(9)), null);
    assert.equal(returnPeriodThresholds(history(20, 200)), null);
    assert.deepEqual([9, 10.5, 17, 20].map((v) => returnPeriodLevel(v, t)), [0, 1, 2, 3]);
  });

  test('prakiraan: level per hari dari median, puncak, dan jarak ke sel GloFAS', () => {
    const forecast = JSON.parse(fixture('glofas-forecast-jakarta.json'));
    const river = buildRiverForecast({ lat: -6.25, lon: 106.83, forecast, thresholds: returnPeriodThresholds(history(20)) });
    assert.deepEqual(river.days.map((d) => d.median_m3s), [3.3, 3, 2.7, 3.4, 9.5, 11.3, 15]);
    assert.deepEqual(river.days.map((d) => d.level), [0, 0, 0, 0, 0, 1, 1]);
    assert.equal(river.level, 1);
    assert.deepEqual(river.peak, { date: '2026-10-25', median_m3s: 15, level: 1 });
    assert.ok(Math.abs(river.cell.distance_km - 2.8) < 0.2, `jarak ${river.cell.distance_km}`);

    const noHistory = buildRiverForecast({ lat: -6.25, lon: 106.83, forecast, thresholds: null });
    assert.equal(noHistory.thresholds, null);
    assert.equal(noHistory.level, null);
    assert.ok(noHistory.days.every((d) => d.level === null));
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
      kode: 'AGU', nama: 'Agung', kabupaten: 'Karangasem', provinsi: 'Bali', elevasiM: 3142, level: 1,
      erupsi: false, vona: false, lat: -8.342, lon: 115.508,
    });
  });

  test('extractVolcanoes membaca status erupsi dan VONA', () => {
    const volcanoes = extractVolcanoes(fixture('magma-home.html'));
    assert.deepEqual(
      volcanoes.filter((v) => v.erupsi).map((v) => v.nama).sort(),
      ['Ibu', 'Ili Lewotolok', 'Semeru'],
    );
    assert.equal(volcanoes.find((v) => v.kode === 'SMR').vona, true);
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

describe('InaRISK identify', () => {
  test('layanan yang gagal dilewati sampai pemeriksaan latar mendapat jawaban', async () => {
    const requested = [];
    let cuacaDown = true;
    const getJson = async (url) => {
      const service = url.match(/inarisk\/(\w+)\/ImageServer/)[1];
      requested.push(service);
      if (service === 'INDEKS_BAHAYA_CUACAEKSTRIM' && cuacaDown) throw new Error('HTTP 525 dari gis.bnpb.go.id');
      return { value: service === 'INDEKS_BAHAYA_BANJIR' ? 'NoData' : '0.666667' };
    };
    let probe = null;
    const identify = createHazardIdentifier({
      getJson,
      schedule: (fn, ms) => {
        assert.equal(ms, PROBE_MS);
        probe = fn;
        return { unref() {} };
      },
    });

    const first = await identify(-6.9, 107.6);
    assert.equal(requested.length, 5);
    assert.deepEqual(first.longsor, { index: 0.666667 });
    assert.deepEqual(first.banjir, { index: null });
    assert.match(first.cuaca.error, /HTTP 525/);
    assert.ok(probe, 'pemeriksaan latar dijadwalkan');

    // Selama bermasalah, cek risiko tidak meminta layanan itu, berapa lama pun jedanya.
    const second = await identify(-6.9, 107.6);
    assert.equal(requested.length, 9);
    assert.match(second.cuaca.error, /sedang bermasalah.*dicoba lagi otomatis/);
    assert.equal(second.gempa.index, 0.666667);

    // Pemeriksaan latar yang masih gagal menjadwalkan pemeriksaan berikutnya.
    let run = probe;
    probe = null;
    await run();
    assert.equal(requested.length, 10);
    assert.ok(probe, 'diperiksa lagi nanti');

    // Setelah layanan menjawab di pemeriksaan latar, cek risiko memakainya lagi.
    cuacaDown = false;
    run = probe;
    probe = null;
    await run();
    assert.equal(probe, null, 'tidak ada pemeriksaan lagi');
    const third = await identify(-6.9, 107.6);
    assert.equal(requested.length, 16);
    assert.equal(third.cuaca.index, 0.666667);
  });
});

// Hujan terukur stasiun cuaca BMKG dari laporan SYNOP (pembaca sandinya diuji di
// recorder/test/synop.test.js).
describe('Hujan terukur stasiun (SYNOP)', () => {
  const row = (iso, mm, hours, trace = false) => ({ observed_at: new Date(iso), rain_mm: mm, rain_hours: hours, rain_trace: trace });
  // Laporan jam utama satu stasiun selama dua hari: 6 jam pada 06/12/18 UTC, 24 jam pada 00 UTC.
  const rows = [
    row('2026-11-10T06:00:00Z', 5, 6),
    row('2026-11-10T12:00:00Z', 0, 6),
    row('2026-11-10T18:00:00Z', 10, 6),
    row('2026-11-11T00:00:00Z', 30, 24),
    row('2026-11-11T06:00:00Z', 2, 6),
    row('2026-11-11T12:00:00Z', 72, 6),
  ];
  const without = (iso) => rows.filter((r) => r.observed_at.toISOString() !== new Date(iso).toISOString());

  test('laporan mentah menjadi kolom tabel; laporan rusak dilewati', () => {
    const report = {
      wmo: '96253',
      observed_at: '2026-11-11T12:00:00.000Z',
      bulletin: 'SMID01 WIIX 111200',
      raw: '96253 01444 80403 10231 20221 30082 40101 51022 60721 79196 82972 333 10328 56000 57900 57800 58004 60727 81915 81820 83460',
      file_modified_at: '2026-11-11T12:20:00.000Z',
    };
    assert.deepEqual(toRow(report), {
      wmo: '96253',
      observedAt: '2026-11-11T12:00:00.000Z',
      rainMm: 72,
      rainHours: 6,
      rainTrace: false,
      weather: 91,
      tempC: 23.1,
      tempMaxC: 32.8,
      tempMinC: null,
      bulletin: 'SMID01 WIIX 111200',
      raw: report.raw,
      sourceFileAt: '2026-11-11T12:20:00.000Z',
    });
    assert.equal(toRow({ ...report, raw: '96253 rusak' }), null);
  });

  test('jendela 18–00 UTC = total 24 jam dikurangi tiga jendela sebelumnya', () => {
    const amounts = sixHourAmounts(rows);
    assert.deepEqual(amounts.get(Date.parse('2026-11-11T00:00:00Z')), { mm: 15, trace: false });
    assert.deepEqual(amounts.get(Date.parse('2026-11-11T12:00:00Z')), { mm: 72, trace: false });
    // Tanpa laporan 12 UTC kemarin, jendela itu tidak bisa dihitung.
    assert.equal(sixHourAmounts(without('2026-11-10T12:00:00Z')).has(Date.parse('2026-11-11T00:00:00Z')), false);
  });

  test('akumulasi 24 jam sampai jam utama terakhir', () => {
    assert.deepEqual(accumulatedRain(rows, new Date('2026-11-11T12:00:00Z')), { mm: 99, hours: 24, trace: false });
    // Pada 00 UTC total 24 jam dipakai langsung, walau laporan kemarin tidak lengkap.
    assert.deepEqual(accumulatedRain(without('2026-11-10T12:00:00Z'), new Date('2026-11-11T00:00:00Z')), { mm: 30, hours: 24, trace: false });
  });

  test('laporan sebelumnya hilang: akumulasi hanya selama datanya bersambung', () => {
    assert.deepEqual(accumulatedRain(without('2026-11-10T12:00:00Z'), new Date('2026-11-11T12:00:00Z')), { mm: 74, hours: 12, trace: false });
    assert.equal(accumulatedRain(rows, new Date('2026-11-11T18:00:00Z')), null);
  });

  test('hujan tak terukur tetap ditandai selama jumlahnya 0 mm', () => {
    const dry = [row('2026-11-11T06:00:00Z', 0, 6, true), row('2026-11-11T12:00:00Z', 0, 6)];
    assert.deepEqual(accumulatedRain(dry, new Date('2026-11-11T12:00:00Z')), { mm: 0, hours: 12, trace: true });
  });

  test('total harian hanya dari laporan 00 UTC', () => {
    assert.deepEqual(dailyTotals(rows), [{ until: '2026-11-11T00:00:00.000Z', mm: 30, trace: false }]);
  });

  test('jam utama terakhir menunggu laporan dari cukup banyak stasiun', () => {
    const counts = [
      { observed_at: new Date('2026-11-11T06:00:00Z'), stations: 56 },
      { observed_at: new Date('2026-11-11T12:00:00Z'), stations: 3 },
      { observed_at: new Date('2026-11-11T13:00:00Z'), stations: 55 },
    ];
    assert.equal(latestMainHour(counts).toISOString(), '2026-11-11T06:00:00.000Z');
    assert.equal(latestMainHour([counts[1]]).toISOString(), '2026-11-11T12:00:00.000Z');
    assert.equal(latestMainHour([]), null);
  });

  test('daftar stasiun WMO memuat nama, koordinat, dan kab/kota', () => {
    assert.ok(STATIONS.size >= 100);
    const jakarta = STATIONS.get('96749');
    assert.equal(jakarta.nama, 'Soekarno-Hatta');
    assert.equal(jakarta.wilayah, 'Kota Tangerang');
    assert.equal(jakarta.icao, 'WIII');
    assert.ok(Math.abs(jakarta.lat + 6.12) < 0.05 && Math.abs(jakarta.lon - 106.65) < 0.05);
  });
});

// Fixture = jawaban asli NOAA Aviation Weather Center (11 Nov 2026), tiga bandara.
describe('Cuaca bandara (METAR)', () => {
  test('sandi cuaca diterjemahkan, fenomena terpenting didahulukan', () => {
    assert.equal(wxLabel('-TSRA BR'), 'Hujan petir ringan');
    assert.equal(wxLabel('+RA'), 'Hujan lebat');
    assert.equal(wxLabel('RA'), 'Hujan');
    assert.equal(wxLabel('-SHRA'), 'Hujan lokal ringan');
    assert.equal(wxLabel('VCTS'), 'Badai petir di sekitar bandara');
    assert.equal(wxLabel('BR'), 'Kabut tipis');
    assert.equal(wxLabel(null), null);
  });

  test('laporan terbaru per bandara, dengan jam pengamatan UTC', async () => {
    const urls = [];
    const byIcao = await fetchMetar({
      getText: async (url) => {
        urls.push(url);
        return fixture('metar-indonesia.json');
      },
    });
    assert.deepEqual(urls, [metarUrl()]);
    assert.match(urls[0], /bbox=-12%2C94%2C7%2C142&format=json$/);
    assert.deepEqual([...byIcao.keys()], ['WAHS', 'WIII', 'YPXM']);
    const semarang = byIcao.get('WAHS');
    assert.equal(semarang.observed_at, '2026-11-11T14:00:00.000Z');
    assert.equal(semarang.weather, 'Hujan petir ringan');
    assert.equal(semarang.temp_c, 28);
    assert.match(semarang.raw, /^METAR WAHS 111400Z/);
    assert.equal(byIcao.get('WIII').weather, null);
  });

  test('jawaban kosong (HTTP 204) = tidak ada laporan', async () => {
    assert.equal((await fetchMetar({ getText: async () => '' })).size, 0);
  });
});

// Fixture = QuakeML asli GFZ (11 Nov 2026), dipangkas menjadi dua gempa: satu
// baru berlokasi otomatis, satu sudah bermekanisme sumber.
describe('GFZ gempa (QuakeML)', () => {
  const events = () => extractGfzEvents(fixture('gfz-quakeml.xml'));

  test('lokasi dan magnitudo pilihan; kedalaman meter menjadi km', () => {
    const [seram, halmahera] = events();
    assert.deepEqual(seram, {
      id: 'gfz:gfz2026wcqh',
      source: 'gfz',
      hazard: 'gempa',
      magnitude: 4.7,
      depthKm: 39.1,
      occurredAt: '2026-11-11T12:17:29.980Z',
      lat: -3.077,
      lon: 130.474,
      props: {
        wilayah: 'Seram, Indonesia',
        mag_type: 'mb',
        url: 'https://geofon.gfz.de/eqinfo/event.php?id=gfz2026wcqh',
        status: 'automatic',
        // Waktu GFZ pertama menerbitkan gempa: ±5 menit setelah kejadian.
        published_at: '2026-11-11T12:22:52.345Z',
      },
    });
    // Gempa bermekanisme punya dua lokasi; yang dipakai lokasi pilihan (10 km),
    // bukan lokasi hasil tensor momen (23 km).
    assert.deepEqual([halmahera.magnitude, halmahera.props.mag_type, halmahera.depthKm, halmahera.props.status], [5.2, 'Mw', 10, 'manual']);
    assert.equal(halmahera.props.published_at, '2026-11-10T15:55:10.046Z');
  });

  test('mekanisme sumber: bidang nodal, sumbu utama, dan jenis sesar', () => {
    const [seram, halmahera] = events();
    assert.ok(!('mechanism' in seram.props));
    assert.deepEqual(halmahera.props.mechanism, {
      type: 'geser',
      label: 'Sesar geser',
      planes: [{ strike: 305, dip: 77, rake: 5 }, { strike: 214, dip: 85, rake: 167 }],
      plunges: { t: 12, p: 6, n: 76 },
      double_couple: 0.49,
      reviewed: true,
      updated_at: '2026-11-11T08:22:17.532Z',
    });
  });

  test('jenis sesar menurut kemiringan sumbu T, P, dan N (Frohlich 1992)', () => {
    assert.equal(mechanismType({ t: 78, p: 11, n: 5 }), 'naik');
    assert.equal(mechanismType({ t: 8, p: 70, n: 18 }), 'turun');
    assert.equal(mechanismType({ t: 12, p: 6, n: 76 }), 'geser');
    assert.equal(mechanismType({ t: 40, p: 35, n: 30 }), 'oblik');
  });

  test('rentang 3 hari untuk sinkronisasi rutin, dengan mekanisme sumber', async () => {
    const now = Date.parse('2026-11-11T15:00:00Z');
    assert.equal(
      gfzQueryUrl({ now }),
      'https://geofon.gfz.de/fdsnws/event/1/query?minlatitude=-12&maxlatitude=7&minlongitude=94&maxlongitude=142&starttime=2026-11-08T15%3A00%3A00&includefocalmechanism=true',
    );
    const urls = [];
    const { events: fetched } = await fetchGfzEarthquakes({
      feed: 'week',
      now,
      getText: async (url) => {
        urls.push(url);
        return fixture('gfz-quakeml.xml');
      },
    });
    assert.match(urls[0], /starttime=2026-11-03T15%3A00%3A00/);
    assert.equal(fetched.length, 2);
  });

  test('jawaban kosong (HTTP 204) = tidak ada gempa; format lain ditolak', () => {
    assert.deepEqual(extractGfzEvents(''), []);
    assert.throws(() => extractGfzEvents('<html>Service Unavailable</html>'), /format QuakeML GFZ tidak dikenal/);
  });
});

// Fixture daftar stasiun = baris asli IOC (11 Nov 2026) untuk lima stasiun; data
// Benoa = 12 menit pertama jawaban asli. Deret panjang dibuat sintetis supaya
// hasil pemisahan pasang surut bisa dibandingkan dengan nilai yang diketahui.
describe('Muka laut (IOC Sea Level Station Monitoring Facility)', () => {
  const NOW = Date.parse('2026-11-11T15:35:00Z');
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const stamp = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

  // Pasang surut tiruan (m): M2 80 cm, K1 30 cm, M4 5 cm, muka laut rata-rata 4 m naik 1 cm/jam.
  const tide = (ms) => {
    const hours = (ms - NOW) / HOUR;
    return 4 + 0.01 * hours + 0.8 * Math.cos((2 * Math.PI * hours) / 12.4206012) + 0.3 * Math.sin((2 * Math.PI * hours) / 23.9344696) + 0.05 * Math.cos((2 * Math.PI * hours) / 6.2103006);
  };
  // Gelombang tiruan 30 cm berperiode 20 menit pada satu jam terakhir (seperti tsunami kecil).
  const wave = (ms) => (ms > NOW - HOUR ? 0.3 * Math.sin((2 * Math.PI * (ms - NOW)) / (20 * MINUTE)) : 0);
  // Deret per menit selama 15 jam untuk beberapa sensor: { sensor: (ms, indeks) => meter }.
  const rows = (sensors) => {
    const out = [];
    for (let i = 0; i < 15 * 60; i++) {
      const ms = NOW - (15 * 60 - 1 - i) * MINUTE;
      for (const [sensor, level] of Object.entries(sensors)) out.push({ slevel: level(ms, i), stime: stamp(ms), sensor });
    }
    return out;
  };

  test('daftar statis dibuat dari alat Indonesia yang pengukur muka lautnya masih mengirim data', () => {
    const list = JSON.parse(fixture('ioc-stationlist.json'));
    // Aarhus (Denmark) dan stasiun yang hanya mengirim tegangan baterai (TLBJI) tidak ikut.
    assert.deepEqual(indonesianStations(list, NOW), [
      { code: 'cili', nama: 'Cilacap', lat: -7.75, lon: 109, last_at: '2026-11-11T15:14:00.000Z' },
      { code: 'koli', nama: 'Kolinamil, Jakarta Port', lat: -6.10667, lon: 106.89083, last_at: '2026-11-11T07:32:00.000Z' },
      { code: 'sema', nama: 'Semarang', lat: -6.9479, lon: 110.42012, last_at: '2026-11-11T15:17:00.000Z' },
    ]);
    // Batas umur data: bawaan sepekan, bisa diperpanjang untuk daftar statis.
    assert.deepEqual(indonesianStations(list, NOW + 8 * 24 * HOUR), []);
    assert.equal(indonesianStations(list, NOW + 8 * 24 * HOUR, { withinMs: 30 * 24 * HOUR }).length, 3);
    assert.throws(() => indonesianStations({ error: 'x' }), /format daftar stasiun IOC tidak dikenal/);
    // Daftar statis yang dipakai aplikasi (npm run build:pasut).
    assert.ok(SEA_STATIONS.length >= 10);
    assert.ok(SEA_STATIONS.every((s) => s.code && s.nama && Number.isFinite(s.lat) && Number.isFinite(s.lon)));
  });

  test('status tiap alat dari sampel muka laut terakhirnya; alat yang gagal diperiksa berstatus tertunda', async () => {
    const stations = [
      { code: 'cili', nama: 'Cilacap', lat: -7.75, lon: 109 },
      { code: 'koli', nama: 'Kolinamil, Jakarta Port', lat: -6.10667, lon: 106.89083 },
      { code: 'sura', nama: 'Surabaya', lat: -7.2, lon: 112.74 },
    ];
    const urls = [];
    const answers = {
      // Sampel muka laut terakhir 8 menit lalu; baterai yang lebih baru tidak dihitung.
      cili: [
        { slevel: 3.9, stime: stamp(NOW - 9 * MINUTE), sensor: 'rad' },
        { slevel: 3.91, stime: stamp(NOW - 8 * MINUTE), sensor: 'rad' },
        { slevel: 0.13, stime: stamp(NOW - 2 * MINUTE), sensor: 'bat' },
      ],
      // Tidak ada sampel dalam 90 menit terakhir.
      koli: [],
    };
    const getJson = async (url) => {
      urls.push(url);
      const code = new URL(url).searchParams.get('code');
      if (!(code in answers)) throw new Error('HTTP 503');
      return answers[code];
    };
    const result = await fetchSeaStations({ now: NOW, getJson, stations });
    assert.deepEqual(result.map((s) => [s.code, s.last_at, s.active]), [
      ['cili', new Date(NOW - 8 * MINUTE).toISOString(), true],
      ['koli', null, false],
      ['sura', null, false],
    ]);
    assert.equal(result[0].url, 'https://www.ioc-sealevelmonitoring.org/station.php?code=cili');
    // Yang diminta hanya data 90 menit terakhir tiap alat, bukan daftar stasiun dunia.
    assert.equal(urls.length, 3);
    assert.match(urls[0], /query=data&code=cili&timestart=2026-11-11T14%3A05&timestop=2026-11-11T15%3A35/);
    assert.equal(latestSampleMs(answers.cili), NOW - 8 * MINUTE);
    // Semua alat gagal diperiksa = layanan IOC tidak terjangkau.
    await assert.rejects(
      fetchSeaStations({
        now: NOW,
        stations,
        getJson: async () => {
          throw new Error('HTTP 503');
        },
      }),
      /semua alat gagal diperiksa/,
    );
  });

  test('hanya sensor muka laut yang dibaca; baterai dan sakelar dilewati', () => {
    const sensors = levelSensors(JSON.parse(fixture('ioc-data-beno.json')));
    assert.deepEqual([...sensors.keys()].sort(), ['rad', 'ras']);
    assert.equal(sensors.get('ras').length, 13);
    assert.deepEqual(sensors.get('ras')[1], [Date.parse('2026-11-11T12:01:00Z'), 6.943]);
    assert.match(seriesUrl('beno', { now: NOW }), /query=data&code=beno&timestart=2026-11-11T00%3A35&timestop=2026-11-11T15%3A35&format=json$/);
  });

  test('lonjakan sesaat dibuang, perubahan bertahap tidak', () => {
    const points = Array.from({ length: 30 }, (_, i) => [i * MINUTE, 4 + 0.01 * i]);
    points[10][1] = 9.99;
    points[20][1] = 0;
    const clean = despike(points);
    assert.equal(clean.length, 28);
    assert.ok(clean.every(([, level]) => level > 3.9 && level < 4.4));
  });

  test('pasang surut dipisahkan: yang tersisa hanya gelombang di luar pasang surut', () => {
    const calm = buildSeries(rows({ rad: tide }), { now: NOW });
    assert.equal(calm.points, 12 * 60);
    assert.equal(calm.minutes.at(-1), 12 * 60 - 1);
    assert.equal(calm.until, '2026-11-11T15:35:00.000Z');
    // Laut tenang: residu di bawah 1 cm sepanjang 12 jam.
    assert.ok(Math.max(...calm.residual_cm.map(Math.abs)) < 1, `residu ${Math.max(...calm.residual_cm.map(Math.abs))}`);
    assert.ok(Math.max(...calm.level_cm) - Math.min(...calm.level_cm) > 120);

    const disturbed = buildSeries(rows({ rad: (ms) => tide(ms) + wave(ms) }), { now: NOW });
    // Gelombang 30 cm terbaca 25–35 cm, dan hanya pada jam terakhir.
    assert.ok(disturbed.latest.residual_peak_cm > 25 && disturbed.latest.residual_peak_cm < 35, `puncak ${disturbed.latest.residual_peak_cm}`);
    const before = disturbed.residual_cm.slice(0, 10 * 60);
    assert.ok(Math.max(...before.map(Math.abs)) < 6, `sebelum gelombang ${Math.max(...before.map(Math.abs))}`);
    assert.equal(disturbed.latest.age_min, 0);
  });

  test('sensor yang paling jelas mengikuti pasang surut yang dipakai', () => {
    const json = rows({
      // Radar dengan lonjakan dan derau besar.
      rad: (ms, i) => tide(ms) + (i % 97 === 0 ? 3 : 0) + 0.12 * Math.sin(i * 1.7),
      // Sensor yang hampir tidak bergerak.
      pr2: (ms, i) => 1 + 0.02 * Math.sin(i / 40),
      prs: tide,
      bat: () => 0.13,
    });
    const chosen = chooseSensor(json);
    assert.equal(chosen.sensor, 'prs');
    const series = buildSeries(json, { now: NOW + 7 * MINUTE });
    assert.deepEqual([series.sensor, series.sensor_kind, series.spikes_removed, series.latest.age_min], ['prs', 'tekanan air', 0, 7]);
  });

  test('data kurang dari 70%: deret tetap ada, tanpa pemisahan pasang surut', () => {
    const sparse = rows({ rad: tide }).filter((_, i) => i % 2 === 0);
    assert.equal(detide(levelSensors(sparse).get('rad')), null);
    const series = buildSeries(sparse, { now: NOW });
    assert.equal(series.residual_cm, null);
    assert.equal(series.latest.residual_peak_cm, null);
    assert.ok(series.level_cm.length > 300);
    // Tanpa data sama sekali.
    assert.deepEqual(buildSeries([], { now: NOW }).latest, null);
  });
});
