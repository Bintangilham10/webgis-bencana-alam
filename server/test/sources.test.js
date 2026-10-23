import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { depthClass, hasTsunamiPotential } from '../src/lib/classify.js';
import { extractEvents, normalizeEvent } from '../src/sources/bmkg-gempa.js';
import { createHazardIdentifier, OUTAGE_MS } from '../src/sources/inarisk.js';
import { extractJsonLiteral, extractVolcanoes } from '../src/sources/magma.js';
import { extractEvents as extractUsgsEvents, fetchUsgsDetail, normalizeEvent as normalizeUsgsEvent } from '../src/sources/usgs-gempa.js';
import { fetchEmscEarthquakes, queryUrl as emscQueryUrl } from '../src/sources/emsc-gempa.js';
import { fetchGdacsEvents } from '../src/sources/gdacs.js';
import { buildRiverForecast, returnPeriodLevel, returnPeriodThresholds } from '../src/sources/glofas.js';
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
  test('layanan yang gagal dilewati sementara supaya cek risiko tidak ikut menunggu', async () => {
    let clock = 0;
    const requested = [];
    const getJson = async (url) => {
      const service = url.match(/inarisk\/(\w+)\/ImageServer/)[1];
      requested.push(service);
      if (service === 'INDEKS_BAHAYA_CUACAEKSTRIM') throw new Error('HTTP 525 dari gis.bnpb.go.id');
      return { value: service === 'INDEKS_BAHAYA_BANJIR' ? 'NoData' : '0.666667' };
    };
    const identify = createHazardIdentifier({ getJson, now: () => clock });

    const first = await identify(-6.9, 107.6);
    assert.equal(requested.length, 5);
    assert.deepEqual(first.longsor, { index: 0.666667 });
    assert.deepEqual(first.banjir, { index: null });
    assert.match(first.cuaca.error, /HTTP 525/);

    // Dalam 5 menit, layanan yang gagal tidak diminta lagi.
    clock = OUTAGE_MS - 1;
    const second = await identify(-6.9, 107.6);
    assert.equal(requested.length, 9);
    assert.match(second.cuaca.error, /sedang bermasalah.*dicoba lagi otomatis/);
    assert.equal(second.gempa.index, 0.666667);

    // Setelahnya dicoba lagi.
    clock = OUTAGE_MS;
    await identify(-6.9, 107.6);
    assert.equal(requested.length, 14);
  });
});
