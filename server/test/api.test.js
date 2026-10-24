import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

// Test integrasi memakai database terpisah supaya data pengembangan tidak
// tersentuh. Buat sekali: docker compose exec db createdb -U sigap sigap_test
// lalu jalankan dengan TEST_DATABASE_URL=postgres://sigap:sigap@localhost:5433/sigap_test
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe('API (integrasi database)', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL tidak diset' }, () => {
  let pool;
  let withTransaction;
  let server;
  let baseUrl;
  let syncEarthquakes;
  let syncVolcanoes;

  // Layanan luar diganti versi palsu; jumlah panggilan dicatat untuk menguji cache.
  const calls = { identify: 0, places: 0, river: 0 };
  // Debit historis sintetis untuk ambang GloFAS: tahun ke-i berpuncak 2i m³/s
  // (ambang 2 tahunan 21, 5 tahunan ±32, 20 tahunan ±38).
  const riverHistory = { time: [], river_discharge: [] };
  for (let y = 1; y <= 20; y++) {
    for (let d = 0; d < 365; d++) {
      riverHistory.time.push(`${1990 + y}-06-01`);
      riverHistory.river_discharge.push(d === 0 ? 2 * y : 1);
    }
  }
  let placesShouldFail = false;
  // Router menyimpan referensi fungsi saat dibuat, jadi hasil palsu diatur lewat variabel ini.
  let placesOverride = null;
  // Tanggal "hari ini" (WIB) untuk jendela indikasi SIGAP.
  let outlookToday = '2026-09-29';
  // Layanan rute palsu (Valhalla, OSRM) dan paparan zona bahaya, diatur per test.
  let routeFakes = {};
  const services = {
    outlook: { today: () => outlookToday },
    route: {
      valhalla: (...args) => routeFakes.valhalla(...args),
      osrm: (...args) => routeFakes.osrm(...args),
      exposure: (...args) => routeFakes.exposure(...args),
      exclusions: (...args) => routeFakes.exclusions(...args),
      // Tanpa nilai palsu: asal dan tujuan di luar zona tinggi.
      zones: async (points) => (routeFakes.zones ? routeFakes.zones(points) : points.map(() => [])),
    },
    risk: {
      identify: async () => {
        calls.identify++;
        return {
          gempa: { index: 0.9 },
          cuaca: { index: 0.2 },
          banjir: { index: 0.7 },
          longsor: { index: null },
          gunungapi: { index: null, error: 'timeout' },
        };
      },
      forecast: async () => ({
        elevationM: 120,
        pastDays: [
          { date: '2026-09-23', precipitationMm: 20 },
          { date: '2026-09-24', precipitationMm: 15 },
          { date: '2026-09-25', precipitationMm: 5 },
        ],
        days: [
          { date: '2026-09-26', precipitationMm: 60, probabilityPct: 90 },
          { date: '2026-09-27', precipitationMm: 10, probabilityPct: 60 },
          { date: '2026-09-28', precipitationMm: 5, probabilityPct: 40 },
        ],
      }),
      potential: async () => ({ month: '2026-09', current: true, potensi: 'Tinggi', zkgt: 'Tinggi' }),
      slope: async () => ({ degrees: 20.3, stepM: 90 }),
      ensemble: async () => {
        throw new Error('Open-Meteo 429');
      },
    },
    rainNow: async () => ({ layer: 'IMERG_Precipitation_Rate_30min', time: '2026-09-27T11:30:00Z', tile_url: 'https://contoh/{z}/{y}/{x}.png' }),
    gdacs: {
      fetchEvents: async () => [
        {
          id: 'FL-1', type: 'FL', type_label: 'Banjir', level: 'orange', name: null,
          from: '2026-10-01T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z', current: false, severity: null,
          countries: ['Indonesia'], origin: 'GLOFAS', report_url: null, modified: '2026-10-05T00:00:00.000Z',
          lon: 106.8, lat: -6.2,
        },
      ],
    },
    river: {
      forecast: async () => {
        calls.river++;
        return {
          latitude: -6.225,
          longitude: 106.825,
          daily: {
            time: ['2026-10-19', '2026-10-20'],
            river_discharge_median: [5, 30],
            river_discharge_p25: [4, 20],
            river_discharge_p75: [6, 40],
            river_discharge_max: [8, 60],
          },
        };
      },
      history: async () => ({ daily: riverHistory }),
    },
    cloudsNow: async () => ({ layer: 'Himawari_AHI_Band13_Clean_Infrared', time: '2026-10-18T16:30:00Z', tile_url: 'https://contoh/awan/{z}/{y}/{x}.png' }),
    // CEWS palsu: Kabupaten Uji berstatus Siaga pada dasarian III September 2026.
    rainWarnings: async () => ({
      dasarian: { year: 2026, month: 9, num: 3, start: '2026-09-21', end: '2026-09-30' },
      published: true,
      counts: { aman: 1, waspada: 0, siaga: 1, awas: 0 },
      by_code: { '99.01': 2 },
      unmatched: [],
      fetched_at: '2026-09-27T00:00:00.000Z',
    }),
    geocode: {
      searchPlaces: async (q) => {
        calls.places++;
        if (placesShouldFail) throw new Error('Nominatim down');
        if (placesOverride) return placesOverride;
        return [{ source: 'osm', name: `OSM ${q}`, label: `OSM ${q}`, type: 'suburb', lat: -7, lon: 107, bounds: [[-7.1, 106.9], [-6.9, 107.1]] }];
      },
    },
  };

  before(async () => {
    // config.js membaca DATABASE_URL saat di-import, jadi harus diset dulu.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ({ pool, withTransaction } = await import('../src/db.js'));
    const { migrate } = await import('../db/migrate.js');
    await migrate();
    await pool.query(
      'TRUNCATE events, volcanoes, sync_logs, faults, wilayah, wilayah_bahaya, titik_pantau, bahaya_raster, indikasi_run, indikasi_wilayah, indikasi_hari, glofas_thresholds, cap_alerts, cap_alert_wilayah, notifications, facilities',
    );
    ({ syncEarthquakes } = await import('../src/jobs/sync-earthquakes.js'));
    ({ syncVolcanoes } = await import('../src/jobs/sync-volcanoes.js'));

    const { createApp } = await import('../src/app.js');
    server = createApp({ services }).listen(0);
    baseUrl = `http://localhost:${server.address().port}/api`;
  });

  after(async () => {
    server?.close();
    await pool?.end();
  });

  const getJson = async (path) => {
    const res = await fetch(baseUrl + path);
    return { status: res.status, body: await res.json() };
  };

  const quake = (overrides = {}) => ({
    id: 'bmkg:20260925T134730Z', source: 'bmkg', hazard: 'gempa', magnitude: 4.7, depthKm: 10,
    occurredAt: new Date().toISOString(), lat: -7.04, lon: 105.22,
    props: { wilayah: '58 km barat daya Sumur', potensi: 'Tidak berpotensi tsunami' },
    ...overrides,
  });

  test('gempa tersimpan dan tampil sebagai GeoJSON [lon, lat]', async () => {
    await syncEarthquakes({ fetchEvents: async () => ({ events: [quake()], errors: [] }) });
    const { status, body } = await getJson('/earthquakes');
    assert.equal(status, 200);
    assert.equal(body.features.length, 1);
    assert.deepEqual(body.features[0].geometry.coordinates, [105.22, -7.04]);
    assert.equal(body.features[0].properties.depth_class, 'dangkal');
    assert.equal(body.features[0].properties.tsunami, false);
  });

  test('revisi BMKG memperbarui baris dan menggabungkan field dari feed lain', async () => {
    const before = (await pool.query("SELECT updated_at FROM events WHERE id = 'bmkg:20260925T134730Z'")).rows[0];
    await syncEarthquakes({
      fetchEvents: async () => ({ events: [quake({ magnitude: 4.9, props: { dirasakan: 'III Sumur' } })], errors: [] }),
    });
    const { rows } = await pool.query("SELECT magnitude, props, updated_at FROM events WHERE id = 'bmkg:20260925T134730Z'");
    assert.equal(rows[0].magnitude, 4.9);
    assert.equal(rows[0].props.potensi, 'Tidak berpotensi tsunami');
    assert.equal(rows[0].props.dirasakan, 'III Sumur');
    assert.ok(rows[0].updated_at > before.updated_at);
  });

  test('sinkronisasi ulang tanpa perubahan tidak menyentuh updated_at', async () => {
    const read = async () => (await pool.query("SELECT updated_at FROM events WHERE id = 'bmkg:20260925T134730Z'")).rows[0];
    const before = await read();
    await syncEarthquakes({
      fetchEvents: async () => ({ events: [quake({ magnitude: 4.9, props: { dirasakan: 'III Sumur' } })], errors: [] }),
    });
    assert.deepEqual(await read(), before);
  });

  test('gempa USGS tampil terpisah dari BMKG, dengan pasangan gempa yang sama di katalog lain', async () => {
    const { syncUsgsEarthquakes } = await import('../src/jobs/sync-earthquakes.js');
    const { runJob } = await import('../src/jobs/scheduler.js');
    const at = Date.now() - 3_600_000;
    const iso = (ms) => new Date(ms).toISOString();
    await syncEarthquakes({
      fetchEvents: async () => ({
        events: [quake({ id: 'bmkg:uji-ruteng', magnitude: 5.3, occurredAt: iso(at), lat: -8.14, lon: 120.29, props: { wilayah: '60 km TimurLaut LABUANBAJO' } })],
        errors: [],
      }),
    });
    const usgs = (overrides) => ({
      source: 'usgs', hazard: 'gempa', magnitude: 5.2, depthKm: 10, lat: -8.1449, lon: 120.2734,
      props: { wilayah: '55 km NNW of Ruteng, Indonesia', mag_type: 'mb', status: 'reviewed' },
      ...overrides,
    });
    const feeds = [];
    const fetchEvents = async ({ feed }) => {
      feeds.push(feed);
      return {
        events: [
          usgs({ id: 'usgs:uji-ruteng', occurredAt: iso(at - 2_000) }),
          // Dua menit lebih awal: gempa lain, bukan pasangan gempa BMKG.
          usgs({ id: 'usgs:uji-sebelum', magnitude: 4.6, occurredAt: iso(at - 120_000) }),
          // Dekat titik uji cek risiko; tidak boleh ikut dihitung di sana.
          usgs({ id: 'usgs:uji-dekat-titik', magnitude: 6.1, occurredAt: iso(at), lat: -7.05, lon: 107.05 }),
        ],
        errors: [],
      };
    };
    // Belum pernah sinkron: feed mingguan; setelah ada sinkronisasi sukses: feed harian.
    await runJob({ source: 'usgs-gempa', run: () => syncUsgsEarthquakes({ fetchEvents }) });
    await syncUsgsEarthquakes({ fetchEvents });
    assert.deepEqual(feeds, ['week', 'day']);

    const { body } = await getJson('/earthquakes?source=usgs');
    assert.equal(body.meta.source, 'usgs');
    assert.ok(body.meta.synced_at);
    assert.match(body.attribution, /USGS/);
    const usgsById = Object.fromEntries(body.features.map((f) => [f.properties.id, f.properties]));
    assert.deepEqual(Object.keys(usgsById).sort(), ['usgs:uji-dekat-titik', 'usgs:uji-ruteng', 'usgs:uji-sebelum']);
    const ruteng = usgsById['usgs:uji-ruteng'];
    assert.equal(ruteng.source, 'USGS');
    assert.equal(ruteng.mag_type, 'mb');
    assert.equal(ruteng.bmkg.id, 'bmkg:uji-ruteng');
    assert.equal(ruteng.bmkg.magnitude, 5.3);
    assert.equal(ruteng.bmkg.time_diff_s, 2);
    assert.ok(ruteng.bmkg.distance_km < 5, `jarak ${ruteng.bmkg.distance_km}`);
    assert.equal(usgsById['usgs:uji-sebelum'].bmkg, null);

    // Tampilan BMKG tetap hanya gempa BMKG; pasangannya dari USGS ikut dikirim.
    const { body: bmkg } = await getJson('/earthquakes');
    assert.ok(bmkg.features.every((f) => f.properties.source === 'BMKG'));
    const { distance_km: distanceKm, ...pair } = bmkg.features.find((f) => f.properties.id === 'bmkg:uji-ruteng').properties.usgs;
    assert.deepEqual(pair, { id: 'usgs:uji-ruteng', magnitude: 5.2, mag_type: 'mb', url: null, pager_alert: null, time_diff_s: -2 });
    assert.equal(distanceKm, ruteng.bmkg.distance_km);
  });

  test('detail PAGER dan ground failure USGS disimpan, dikirim API, dan diambil ulang hanya bila gempa direvisi', async () => {
    const { syncUsgsEarthquakes } = await import('../src/jobs/sync-earthquakes.js');
    const at = Date.now() - 2 * 3_600_000;
    const palu = (revision) => ({
      id: 'usgs:uji-palu', source: 'usgs', hazard: 'gempa', magnitude: 6.7, depthKm: 10,
      occurredAt: new Date(at).toISOString(), lat: -1.15, lon: 120.23,
      props: { wilayah: '40 km SE of Palu, Indonesia', alert: 'yellow' },
      code: 'uji-palu', revision, hasDetail: true,
    });
    const detail = {
      pager: { alert: 'yellow', max_mmi: 8, reviewed: false, onepager_url: 'https://contoh/onepager.pdf', fatality: 'yellow', economic: 'green' },
      ground_failure: {
        landslide: { alert: 'orange', area_km2: 18, population: 310, overlay_url: 'https://contoh/ls.png', bounds: [[-3.27, 118.02], [1.05, 122.35]] },
        liquefaction: { alert: 'orange', area_km2: 91, population: 39000, overlay_url: 'https://contoh/lq.png', bounds: [[-3.27, 118.02], [1.05, 122.35]] },
        focus: [[-1.52, 119.86], [-0.77, 120.6]],
        rupture_warning: true,
      },
    };
    const requested = [];
    const fetchDetail = async (code) => {
      requested.push(code);
      return detail;
    };
    let now = Date.now();
    const sync = (revision) =>
      syncUsgsEarthquakes({ fetchEvents: async () => ({ events: [palu(revision)], errors: [] }), fetchDetail, now });

    await sync(1000);
    const { body } = await getJson('/earthquakes?source=usgs');
    const props = body.features.find((f) => f.properties.id === 'usgs:uji-palu').properties;
    assert.deepEqual(props.pager, detail.pager);
    assert.deepEqual(props.ground_failure, detail.ground_failure);
    assert.ok(!('detail_revision' in props));

    // Tanpa revisi: tidak diambil lagi. Revisi dalam 10 menit: menunggu. Setelahnya: diambil.
    await sync(1000);
    await sync(2000);
    assert.deepEqual(requested, ['uji-palu']);
    now += 11 * 60_000;
    await sync(2000);
    assert.deepEqual(requested, ['uji-palu', 'uji-palu']);

    // Detail gagal: gempanya tetap tersimpan, kegagalan dicatat di pesan sinkronisasi.
    now += 11 * 60_000;
    const failed = await syncUsgsEarthquakes({
      fetchEvents: async () => ({ events: [palu(3000)], errors: [] }),
      fetchDetail: async () => {
        throw new Error('HTTP 503');
      },
      now,
    });
    assert.equal(failed.items, 1);
    assert.match(failed.message, /detail uji-palu: HTTP 503/);
  });

  test('gempa EMSC tampil terpisah, dengan lembaga penentu dan pasangannya di feed BMKG', async () => {
    const { syncEmscEarthquakes } = await import('../src/jobs/sync-earthquakes.js');
    const at = Date.now() - 30 * 60_000;
    const iso = (ms) => new Date(ms).toISOString();
    await syncEarthquakes({
      fetchEvents: async () => ({
        events: [quake({ id: 'bmkg:uji-flores', magnitude: 5.1, occurredAt: iso(at), lat: -8.27, lon: 120.63, props: { wilayah: 'Laut Flores' } })],
        errors: [],
      }),
    });
    const emsc = (id, magnitude, ms, props) => ({
      id, source: 'emsc', hazard: 'gempa', magnitude, depthKm: 10, occurredAt: iso(ms), lat: -8.3, lon: 120.6,
      props: { wilayah: 'FLORES REGION, INDONESIA', mag_type: 'm', ...props },
    });
    const feeds = [];
    await syncEmscEarthquakes({
      fetchEvents: async ({ feed }) => {
        feeds.push(feed);
        return {
          events: [
            emsc('emsc:uji-sama', 5.1, at + 1_000, { auth: 'BMKG' }),
            // Gempa kecil yang tidak ada di feed publik BMKG.
            emsc('emsc:uji-kecil', 2.4, at - 600_000, { auth: 'BMKG' }),
          ],
          errors: [],
        };
      },
    });
    assert.deepEqual(feeds, ['week']);

    const { body } = await getJson('/earthquakes?source=emsc');
    assert.equal(body.meta.source, 'emsc');
    assert.match(body.attribution, /EMSC/);
    const byId = Object.fromEntries(body.features.map((f) => [f.properties.id, f.properties]));
    assert.deepEqual(Object.keys(byId).sort(), ['emsc:uji-kecil', 'emsc:uji-sama']);
    assert.equal(byId['emsc:uji-sama'].auth, 'BMKG');
    assert.equal(byId['emsc:uji-sama'].bmkg.id, 'bmkg:uji-flores');
    assert.equal(byId['emsc:uji-kecil'].bmkg, null);
    // Tampilan BMKG tidak berubah: EMSC tidak ikut.
    const { body: bmkg } = await getJson('/earthquakes');
    assert.ok(bmkg.features.every((f) => f.properties.source === 'BMKG'));
    assert.equal((await getJson('/earthquakes?source=jma')).status, 400);
  });

  test('peringatan GDACS dikirim sebagai GeoJSON [lon, lat]', async () => {
    const { status, body } = await getJson('/gdacs');
    assert.equal(status, 200);
    assert.match(body.attribution, /GDACS/);
    assert.equal(body.meta.alert_days, 365);
    assert.deepEqual(body.features[0].geometry.coordinates, [106.8, -6.2]);
    assert.equal(body.features[0].properties.level, 'orange');
    assert.ok(!('lon' in body.features[0].properties));
  });

  test('debit sungai GloFAS: level dari ambang sel, cache per ±1 km, koordinat di luar kawasan ditolak', async () => {
    const { status, body } = await getJson('/river?lat=-6.25&lon=106.83');
    assert.equal(status, 200);
    assert.equal(body.thresholds.rp2, 21);
    assert.deepEqual([body.thresholds.from_year, body.thresholds.to_year], [1991, 2010]);
    assert.deepEqual(body.days.map((d) => d.level), [0, 1]);
    assert.equal(body.level, 1);
    assert.equal(body.level_max, 3);
    assert.deepEqual(body.peak, { date: '2026-10-20', median_m3s: 30, level: 1 });
    await getJson('/river?lat=-6.251&lon=106.832');
    assert.equal(calls.river, 1);
    assert.equal((await getJson('/river?lat=50&lon=10')).status, 400);
  });

  test('ambang GloFAS disimpan per sel, jadi server yang baru dimulai tidak meminta riwayat lagi', async () => {
    const { rows } = await pool.query('SELECT lat, lon, years, from_year, to_year, rp2 FROM glofas_thresholds');
    assert.deepEqual(rows, [{ lat: -6.225, lon: 106.825, years: 20, from_year: 1991, to_year: 2010, rp2: 21 }]);

    const express = (await import('express')).default;
    const { createRiverRouter } = await import('../src/routes/river.js');
    const history = async () => {
      throw new Error('riwayat tidak boleh diminta lagi');
    };
    const fresh = express().use('/api', createRiverRouter({ forecast: services.river.forecast, history })).listen(0);
    try {
      const res = await fetch(`http://localhost:${fresh.address().port}/api/river?lat=-6.25&lon=106.83`);
      assert.equal((await res.json()).thresholds.rp2, 21);
    } finally {
      fresh.close();
    }
  });

  test('perubahan level gunung api mengisi level_changed_at', async () => {
    const merapi = (level) => [{ kode: 'MER', nama: 'Merapi', kabupaten: 'Sleman', provinsi: 'DIY', elevasiM: 2968, level, lat: -7.542, lon: 110.442 }];
    await syncVolcanoes({ fetchVolcanoes: async () => merapi(2) });
    let { body } = await getJson('/volcanoes');
    assert.equal(body.features[0].properties.level_changed_at, null);

    await syncVolcanoes({ fetchVolcanoes: async () => merapi(3) });
    ({ body } = await getJson('/volcanoes'));
    assert.equal(body.features[0].properties.level, 3);
    assert.equal(body.features[0].properties.level_label, 'Siaga');
    assert.ok(body.features[0].properties.level_changed_at);
  });

  test('status erupsi dan VONA disimpan dan dikirim API', async () => {
    const semeru = (erupsi) => [
      { kode: 'SMR', nama: 'Semeru', kabupaten: 'Lumajang', provinsi: 'Jawa Timur', elevasiM: 3676, level: 3, erupsi, vona: erupsi, lat: -8.108, lon: 112.92 },
    ];
    await syncVolcanoes({ fetchVolcanoes: async () => semeru(true) });
    let { body } = await getJson('/volcanoes');
    let props = body.features.find((f) => f.properties.kode === 'SMR').properties;
    assert.equal(props.erupsi, true);
    assert.equal(props.vona, true);

    await syncVolcanoes({ fetchVolcanoes: async () => semeru(false) });
    ({ body } = await getJson('/volcanoes'));
    props = body.features.find((f) => f.properties.kode === 'SMR').properties;
    assert.equal(props.erupsi, false);
    assert.equal(props.vona, false);
  });

  test('parameter tidak valid dan endpoint tak dikenal dijawab dengan jelas', async () => {
    assert.equal((await getJson('/wilayah?tingkat=desa')).status, 400);
    assert.equal((await getJson('/earthquakes?source=jma')).status, 400);
    assert.equal((await getJson('/tidak-ada')).status, 404);
  });

  describe('cek risiko dan pencarian', () => {
    // Wilayah, sesar, dan gunung api buatan dengan jarak yang bisa dihitung:
    // titik uji (-7.0, 107.0) berjarak 0,2° lintang (±22,1 km) dari sesar
    // dan 0,3° lintang (±33,2 km) dari gunung api.
    before(async () => {
      const square = (w, s, e, n) =>
        `ST_Multi(ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326))`;
      await pool.query(`
        INSERT INTO wilayah (kode, nama, tingkat, induk_kode, titik, geom) VALUES
          ('99', 'Provinsi Uji', 'provinsi', NULL, ST_SetSRID(ST_MakePoint(107, -7), 4326), ${square(106, -8, 108, -6)}),
          ('99.01', 'Kabupaten Uji', 'kabupaten', '99', ST_SetSRID(ST_MakePoint(107, -7), 4326), ${square(106.5, -7.5, 107.5, -6.5)});
        INSERT INTO faults (id, nama, segmen, region, tipe, mmax, slip_rate_mm_per_year, panjang_km, geom) VALUES
          (1, 'Uji Fault', 'Uji', 'Java', 'SS-LL90', 6.6, 3.45, 22,
           ST_Multi(ST_SetSRID(ST_MakeLine(ST_MakePoint(106.9, -6.8), ST_MakePoint(107.1, -6.8)), 4326)));`);
      await syncVolcanoes({
        fetchVolcanoes: async () => [
          { kode: 'UJI', nama: 'Uji', kabupaten: null, provinsi: null, elevasiM: 2000, level: 2, lat: -7.3, lon: 107 },
        ],
      });
      await syncEarthquakes({
        fetchEvents: async () => ({
          events: [{ ...quake({ id: 'bmkg:20260926T000000Z', magnitude: 5.2 }), lat: -7.05, lon: 107.05 }],
          errors: [],
        }),
      });
      // Dua kejadian longsor buatan: ±1,1 km dan ±11 km dari titik uji.
      const { seedLandslides } = await import('../scripts/seed-landslides.js');
      await seedLandslides(new URL('./fixtures/landslides-uji.geojson', import.meta.url));
    });

    test('profil risiko menggabungkan InaRISK, cuaca, dan analisis kedekatan', async () => {
      const { status, body } = await getJson('/risk?lat=-7&lon=107');
      assert.equal(status, 200);
      assert.deepEqual(body.location.wilayah, { kode: '99.01', nama: 'Kabupaten Uji', provinsi: 'Provinsi Uji' });
      assert.equal(body.location.status, 'indonesia');
      assert.equal(body.location.wilayah_terdekat, null);
      assert.equal(body.location.elevation_m, 120);

      const hazards = Object.fromEntries(body.hazards.map((h) => [h.id, h]));
      assert.equal(hazards.gempa.class.id, 'tinggi');
      assert.equal(hazards.longsor.class, null);
      assert.equal(hazards.gunungapi.error, 'timeout');

      const banjir = body.indications.find((i) => i.hazard === 'banjir');
      assert.equal(banjir.label, 'Waspada');

      assert.ok(Math.abs(body.nearest_fault.distance_km - 22.1) < 0.3, `jarak sesar ${body.nearest_fault.distance_km}`);
      assert.deepEqual(body.nearest_fault.closest_point, [107, -6.8]);
      assert.ok(Math.abs(body.nearest_volcanoes[0].distance_km - 33.2) < 0.3);
      assert.equal(body.nearest_volcanoes[0].level_label, 'Waspada');
      // Gempa uji pertama (Selat Sunda, ±196 km) berada di luar radius 100 km, dan
      // gempa USGS M6,1 di dekat titik ini tidak dihitung (hanya BMKG).
      assert.equal(body.recent_quakes.count, 1);
      assert.equal(body.recent_quakes.strongest.magnitude, 5.2);
      assert.ok(body.recommendations.some((t) => t.startsWith('Indikasi waspada banjir')));
    });

    test('bagian tanah longsor: produk resmi, lereng, riwayat, dan sumber yang gagal', async () => {
      const { body } = await getJson('/risk?lat=-7&lon=107');
      const { landslide } = body;
      assert.equal(landslide.potential.potensi, 'Tinggi');
      assert.equal(landslide.rain_warning.level, 2);
      assert.equal(landslide.rain_warning.label, 'Siaga');
      assert.equal(landslide.antecedent_rain.total_mm, 40);
      assert.equal(landslide.slope.class.id, 'curam');
      assert.deepEqual(landslide.ensemble, { error: 'Open-Meteo 429' });
      assert.equal(landslide.history.count, 1);
      assert.equal(landslide.history.nearest.tanggal, '2021-02-10');
      assert.equal(landslide.history.nearest.presisi_tanggal, 'hari');
      assert.ok(Math.abs(landslide.history.nearest.distance_km - 1.1) < 0.1);
      assert.ok(body.recommendations.some((t) => t.includes('level siaga untuk Kabupaten Uji')));
    });

    test('layer peringatan hujan hanya berisi kab/kota Waspada ke atas', async () => {
      const { status, body } = await getJson('/rain-warnings');
      assert.equal(status, 200);
      assert.equal(body.dasarian.num, 3);
      assert.equal(body.features.length, 1);
      assert.deepEqual(body.features[0].properties, { kode: '99.01', nama: 'Kabupaten Uji', level: 2, level_label: 'Siaga' });
      assert.match(body.features[0].geometry.type, /Polygon$/);
    });

    test('ringkasan peringatan hujan tanpa geometri, dengan provinsi dan batas untuk zoom', async () => {
      const { status, body } = await getJson('/rain-warnings/summary');
      assert.equal(status, 200);
      assert.deepEqual(body.regions, [
        { kode: '99.01', nama: 'Kabupaten Uji', provinsi: 'Provinsi Uji', level: 2, level_label: 'Siaga', bounds: [[-7.5, 106.5], [-6.5, 107.5]] },
      ]);
      assert.equal(body.dasarian.end, '2026-09-30');
    });

    test('waktu hujan satelit terbaru diteruskan dari layanan GIBS', async () => {
      const { status, body } = await getJson('/rain-now');
      assert.equal(status, 200);
      assert.equal(body.time, '2026-09-27T11:30:00Z');
    });

    test('waktu citra awan Himawari-9 terbaru diteruskan dari layanan GIBS', async () => {
      const { status, body } = await getJson('/clouds-now');
      assert.equal(status, 200);
      assert.equal(body.layer, 'Himawari_AHI_Band13_Clean_Infrared');
      assert.equal(body.time, '2026-10-18T16:30:00Z');
    });

    test('riwayat longsor tampil sebagai GeoJSON [lon, lat]', async () => {
      const { status, body } = await getJson('/landslides');
      assert.equal(status, 200);
      assert.equal(body.features.length, 2);
      assert.deepEqual(body.features[0].geometry.coordinates, [107.01, -7]);
      assert.equal(body.features[0].properties.tipe, 'Longsoran');
      assert.equal(body.features[0].properties.jam_diketahui, false);
      assert.equal(body.features[1].properties.jam_diketahui, true);
      assert.equal(new Date(body.features[1].properties.occurred_at).toISOString(), '2023-02-23T16:00:00.000Z');
      assert.match(body.attribution, /PVMBG/);
    });

    test('titik yang sama (dibulatkan 3 desimal) dilayani dari cache', async () => {
      const before = calls.identify;
      await getJson('/risk?lat=-7.0001&lon=107.0002');
      assert.equal(calls.identify, before);
    });

    test('titik di luar wilayah administrasi tetap dilayani, dengan kab/kota terdekat dan statusnya', async () => {
      // Elevasi palsu 120 m: daratan ±222 km dari Kabupaten Uji = di luar Indonesia.
      const { status, body } = await getJson('/risk?lat=-9.5&lon=107');
      assert.equal(status, 200);
      assert.equal(body.location.wilayah, null);
      assert.equal(body.location.status, 'luar_indonesia');
      assert.equal(body.location.wilayah_terdekat.kode, '99.01');
      assert.ok(Math.abs(body.location.wilayah_terdekat.distance_km - 221.3) < 1, `jarak ${body.location.wilayah_terdekat.distance_km}`);
      assert.deepEqual(body.indications, []);
      assert.equal(body.landslide.rain_warning.level, null);
      assert.match(body.recommendations[0], /di luar wilayah Indonesia/);
    });

    test('titik di pesisir (≤ 1 km dari batas) memakai kab/kota terdekat', async () => {
      // 0,005° (±550 m) di luar sisi timur Kabupaten Uji.
      const { body } = await getJson('/risk?lat=-7&lon=107.505');
      assert.equal(body.location.status, 'pesisir');
      assert.deepEqual(body.location.wilayah, { kode: '99.01', nama: 'Kabupaten Uji', provinsi: 'Provinsi Uji' });
      assert.equal(body.landslide.rain_warning.level, 2);
    });

    test('pencarian mendahulukan nama wilayah lalu hasil OpenStreetMap', async () => {
      const { status, body } = await getJson('/geocode?q=uji');
      assert.equal(status, 200);
      assert.deepEqual(body.results.map((r) => r.source), ['wilayah', 'wilayah', 'osm']);
      // Nama dengan kata kunci lebih awal diurutkan lebih dulu.
      assert.deepEqual(body.results.slice(0, 2).map((r) => r.name), ['Provinsi Uji', 'Kabupaten Uji']);
      assert.deepEqual(body.results[1].bounds, [[-7.5, 106.5], [-6.5, 107.5]]);
    });

    test('hasil OSM yang namanya sama dengan wilayah tidak ditampilkan dua kali', async () => {
      placesOverride = [
        { source: 'osm', name: 'Kabupaten Uji', label: 'Kabupaten Uji, Indonesia', type: 'county', lat: -7, lon: 107, bounds: [[-7.5, 106.5], [-6.5, 107.5]] },
      ];
      try {
        const { body } = await getJson('/geocode?q=kabupaten uji');
        assert.deepEqual(body.results.map((r) => r.source), ['wilayah']);
      } finally {
        placesOverride = null;
      }
    });

    test('karakter wildcard SQL diperlakukan sebagai teks biasa', async () => {
      const { status, body } = await getJson(`/geocode?q=${encodeURIComponent('%_')}`);
      assert.equal(status, 200);
      assert.ok(body.results.every((r) => r.source === 'osm'));
    });

    test('Nominatim gagal: hasil wilayah tetap ada dengan peringatan', async () => {
      placesShouldFail = true;
      const { body } = await getJson('/geocode?q=kabupaten');
      placesShouldFail = false;
      assert.deepEqual(body.results.map((r) => r.name), ['Kabupaten Uji']);
      assert.match(body.warning, /tidak tersedia/);
    });

    test('kata kunci terlalu pendek ditolak', async () => {
      assert.equal((await getJson('/geocode?q=a')).status, 400);
    });
  });

  describe('indikasi SIGAP 3 hari per kab/kota', () => {
    let bahaya;
    let runIndikasi;

    // Kabupaten Raster (0,5° × 0,5°) punya raster longsor dan banjir buatan;
    // Kota Kering tidak punya zona bahaya. Kabupaten Uji (dari blok sebelumnya)
    // dipakai sebagai kab/kota yang hujannya gagal dimuat.
    before(async () => {
      bahaya = await import('../scripts/seed-bahaya.js');
      ({ runIndikasi } = await import('../src/jobs/indikasi.js'));
      const square = (w, s, e, n) => `ST_Multi(ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326))`;
      await pool.query(`
        INSERT INTO wilayah (kode, nama, tingkat, induk_kode, titik, geom) VALUES
          ('98', 'Provinsi Dua', 'provinsi', NULL, ST_SetSRID(ST_MakePoint(110.5, -7.5), 4326), ${square(109.5, -8.5, 111.5, -6.5)}),
          ('98.01', 'Kabupaten Raster', 'kabupaten', '98', ST_SetSRID(ST_MakePoint(110.25, -7.25), 4326), ${square(110, -7.5, 110.5, -7)}),
          ('98.02', 'Kota Kering', 'kota', '98', ST_SetSRID(ST_MakePoint(111.2, -7.9), 4326), ${square(111, -8, 111.4, -7.8)});`);

      // Raster longsor 100 × 100 piksel 0,005° (kiri atas 110,0; −7,0):
      // tinggi 10 × 10 di sel −29:440, sedang 20 × 5 di sel −30:441, rendah 5 × 10
      // di sel −29:441, dan 2 piksel rendah di sel −30:440 (terlalu kecil).
      await pool.query(`
        INSERT INTO bahaya_raster (hazard, rast)
        SELECT 'longsor', ST_SetValues(ST_SetValues(ST_SetValues(ST_SetValues(
          ST_AddBand(ST_MakeEmptyRaster(100, 100, 110, -7, 0.005, -0.005, 0, 0, 4326), '8BUI'::text, 0, 0),
          1, 1, 1, 10, 10, 3), 1, 61, 61, 20, 5, 2), 1, 71, 11, 5, 10, 1), 1, 11, 81, 2, 1, 1)`);
    });

    const rain = (forecast) => ({
      pastDays: ['2026-09-26', '2026-09-27', '2026-09-28'].map((date) => ({ date, precipitationMm: 0 })),
      days: ['2026-09-29', '2026-09-30', '2026-10-01'].map((date, i) => ({ date, precipitationMm: forecast[i] })),
    });

    test('GeoTIFF dimuat sebagai petak; petak yang seluruhnya NoData dibuang', async () => {
      const tiff = await withTransaction(async (client) => {
        await client.query("SET LOCAL postgis.gdal_enabled_drivers = 'GTiff'");
        const { rows } = await client.query(`
          SELECT ST_AsGDALRaster(ST_SetValues(
            ST_AddBand(ST_MakeEmptyRaster(600, 300, 110, -7, 0.005, -0.005, 0, 0, 4326), '8BUI'::text, 0, 0),
            1, 1, 1, 10, 10, 2), 'GTiff') AS tiff`);
        return rows[0].tiff;
      });
      bahaya.assertGeoTiff(tiff);
      await bahaya.loadRaster('banjir', tiff);
      // 600 × 300 piksel = 6 petak 256 × 256; hanya petak kiri atas yang berisi data.
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM bahaya_raster WHERE hazard = 'banjir'");
      assert.equal(rows[0].n, 1);
    });

    test('statistik zona dan kandidat titik pantau dari raster kelas', async () => {
      const { stats, cells } = await bahaya.zoneSummary('98.01', 'longsor', { lat: -7.25 });
      // Satu piksel 0,005° di lintang 7,25° ≈ 0,3073 km².
      assert.deepEqual(stats, { kode: '98.01', hazard: 'longsor', rendah_km2: 16, sedang_km2: 30.7, tinggi_km2: 30.7 });
      assert.deepEqual(
        cells.map((c) => [c.urutan, c.kelas, c.piksel, c.candidates.length]),
        [[1, 3, 100, 16], [2, 2, 100, 16], [3, 1, 50, 16]],
      );
      // Kandidat dibulatkan 3 desimal (koordinat cek risiko) dan tetap di dalam blok kelasnya.
      for (const { lon, lat } of cells[0].candidates) {
        assert.equal(lon, Math.round(lon * 1000) / 1000);
        assert.ok(lon >= 110 && lon <= 110.05 && lat <= -7 && lat >= -7.05, `${lon},${lat} di dalam blok kelas tinggi`);
      }
    });

    test('kelas titik pantau diambil dari nilai asli 100 m di kandidatnya', () => {
      const cell = { kelas: 3, candidates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
      const pick = (classes) => bahaya.pickPoint(cell, (c) => classes[c.id]);
      assert.deepEqual(pick({ a: 3, b: 3, c: 3 }), { id: 'a', kelas: 3 });
      assert.deepEqual(pick({ a: 0, b: 3, c: 3 }), { id: 'b', kelas: 3 });
      assert.deepEqual(pick({ a: 1, b: 2, c: 0 }), { id: 'b', kelas: 2 });
      assert.equal(pick({ a: 0, b: 0, c: 0 }), null);
      // Kandidat yang dibulatkan ke luar kab/kotanya dilewati.
      assert.deepEqual(bahaya.pickPoint(cell, () => 3, (c) => c.id !== 'a'), { id: 'b', kelas: 3 });
      assert.equal(bahaya.parseSample(''), null);
      assert.equal(bahaya.parseSample('NoData'), null);
      assert.equal(bahaya.parseSample('0.777777791'), 0.777777791);
    });

    test('run indikasi disimpan dan disajikan per kab/kota', async () => {
      assert.equal((await getJson('/outlook')).status, 404);

      // Nilai asli palsu: blok longsor tinggi dan sedang memang berzona, blok
      // rendah ternyata di luar zona (dibuang); kandidat banjir pertama di luar
      // zona, kandidat berikutnya sedang.
      const inBlock = (p, [w, e, n, s]) => p.lon >= w && p.lon <= e && p.lat <= n && p.lat >= s;
      const banjir = (await bahaya.zoneSummary('98.01', 'banjir', { lat: -7.25 })).cells[0];
      const sample = async (hazard, points) =>
        points.map((p) => {
          if (hazard === 'banjir') return p.lon === banjir.candidates[0].lon && p.lat === banjir.candidates[0].lat ? null : 0.5;
          if (inBlock(p, [110, 110.05, -7, -7.05])) return 0.8;
          if (inBlock(p, [110.3, 110.4, -7.3, -7.325])) return 0.5;
          return null;
        });
      const { stats, points } = await bahaya.computeZones({ sample });
      await bahaya.saveZones(stats, points);
      const { rows: saved } = await pool.query(
        'SELECT hazard, kelas, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM titik_pantau WHERE hazard <> $1 ORDER BY hazard, urutan',
        ['acuan'],
      );
      assert.deepEqual(saved.map((r) => [r.hazard, r.kelas]), [['banjir', 2], ['longsor', 3], ['longsor', 2]]);
      assert.deepEqual([saved[0].lon, saved[0].lat], [banjir.candidates[1].lon, banjir.candidates[1].lat]);

      // Hujan sangat lebat di blok zona longsor tinggi dan banjir sedang, hujan
      // lebat di titik acuan Kota Kering, dan hujan Kabupaten Uji gagal dimuat.
      const result = await runIndikasi({
        fetchRain: async (locations) => ({
          rain: new Map(
            locations
              .filter((l) => l.key !== '-7.000,107.000')
              .map((l) => [l.key, rain(inBlock(l, [110, 110.05, -7, -7.05]) ? [30, 120, 10] : l.key === '-7.900,111.200' ? [60, 0, 0] : [5, 5, 5])]),
          ),
          failed: 1,
          error: 'HTTP 502',
        }),
      });
      assert.equal(result.items, 3);
      assert.match(result.message, /^1 dari 6 titik hujan gagal dimuat: HTTP 502$/);

      const { status, body } = await getJson('/outlook');
      assert.equal(status, 200);
      assert.equal(body.run.rules_version, 'v0.2');
      assert.equal(body.run.forecast_from, '2026-09-29');
      assert.equal(body.run.forecast_to, '2026-10-01');
      assert.deepEqual(body.window, { from: '2026-09-29', to: '2026-10-01', expired: false });
      assert.equal(body.run.locations, 6);
      assert.equal(body.run.locations_failed, 1);
      assert.deepEqual(body.counts.tertinggi, { normal: 0, waspada: 1, siaga: 1, awas: 0, tanpa_data: 1 });
      assert.deepEqual(body.counts.banjir, { normal: 1, waspada: 1, siaga: 0, awas: 0, tanpa_data: 1 });

      const region = (kode) => body.regions.find((r) => r.kode === kode);
      const raster = region('98.01');
      assert.equal(raster.provinsi, 'Provinsi Dua');
      assert.deepEqual(raster.bounds, [[-7.5, 110], [-7, 110.5]]);
      assert.equal(raster.label, 'Siaga');
      assert.equal(raster.hazards.longsor.level, 2);
      assert.equal(raster.hazards.longsor.peak_date, '2026-09-30');
      assert.match(raster.hazards.longsor.reason, /120 mm\/hari.*zona bahaya tinggi \(InaRISK\)/);
      assert.ok(raster.hazards.longsor.lon < 110.05 && raster.hazards.longsor.lat > -7.05);
      assert.equal(raster.hazards.banjir.level, 1);
      assert.equal(raster.hazards.hujan.level, 2);

      const kering = region('98.02');
      assert.deepEqual([kering.hazards.hujan.level, kering.hazards.banjir.level, kering.hazards.longsor.level], [1, 0, 0]);
      assert.match(kering.hazards.banjir.reason, /tidak ada zona bahaya banjir/);
      assert.equal(kering.hazards.banjir.lat, null);

      const gagal = region('99.01');
      assert.equal(gagal.level, null);
      assert.match(gagal.hazards.hujan.reason, /gagal dimuat/);
    });

    test('jendela peta mulai hari ini: hari yang sudah lewat tidak ikut, run yang terlalu lama kedaluwarsa', async () => {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM indikasi_hari');
      assert.equal(rows[0].n, 3 * 3 * 3, '3 kab/kota × 3 bahaya × 3 hari');

      outlookToday = '2026-09-30';
      let { body } = await getJson('/outlook');
      assert.deepEqual(body.window, { from: '2026-09-30', to: '2026-10-01', expired: false });
      let raster = body.regions.find((r) => r.kode === '98.01');
      assert.equal(raster.hazards.longsor.level, 2, 'puncak 30 Sep masih di dalam jendela');
      assert.equal(raster.hazards.longsor.peak_date, '2026-09-30');
      assert.match(raster.hazards.longsor.reason, /^hujan 120 mm\/hari/);

      // 1 Okt: hujan 120 mm tanggal 30 Sep sudah lewat, jadi hujan lebat dan banjir
      // Normal; longsor tetap Waspada karena akumulasi 3 hari (30 + 120 + 10 mm) masih
      // dihitung. Kota Kering (hujan lebat 29 Sep) kembali Normal.
      outlookToday = '2026-10-01';
      ({ body } = await getJson('/outlook'));
      raster = body.regions.find((r) => r.kode === '98.01');
      assert.deepEqual([raster.hazards.hujan.level, raster.hazards.banjir.level], [0, 0]);
      assert.deepEqual([raster.hazards.longsor.level, raster.hazards.longsor.peak_date], [1, '2026-10-01']);
      assert.match(raster.hazards.longsor.reason, /^akumulasi hujan 3 hari 160 mm/);
      assert.deepEqual(body.counts.tertinggi, { normal: 1, waspada: 1, siaga: 0, awas: 0, tanpa_data: 1 });

      outlookToday = '2026-10-05';
      ({ body } = await getJson('/outlook'));
      assert.deepEqual(body.window, { from: null, to: null, expired: true });
      assert.ok(body.regions.every((r) => r.level === null && /sudah lewat/.test(r.hazards.hujan.reason)));
      outlookToday = '2026-09-29';
    });

    test('run baru langsung menggantikan hasil sebelumnya', async () => {
      const previous = (await getJson('/outlook')).body.run.id;
      await runIndikasi({ fetchRain: async (locations) => ({ rain: new Map(locations.map((l) => [l.key, rain([0, 0, 0])])), failed: 0, error: null }) });
      const { body } = await getJson('/outlook');
      assert.ok(body.run.id > previous);
      assert.deepEqual(body.counts.tertinggi, { normal: 3, waspada: 0, siaga: 0, awas: 0, tanpa_data: 0 });
    });

    test('penjadwal melewati run bila run sukses terakhir masih segar', async () => {
      const { isFresh } = await import('../src/jobs/scheduler.js');
      const { recordSync } = await import('../src/sync-logs.js');
      const job = { source: 'indikasi-sigap', intervalMs: 6 * 60 * 60_000, skipIfFresh: true };
      const log = (ok) => recordSync({ source: job.source, ok, items: ok ? 3 : null, message: null, startedAt: new Date(), durationMs: 1 });
      assert.equal(await isFresh(job), false);
      await log(false);
      assert.equal(await isFresh(job), false, 'run gagal tidak dihitung');
      await log(true);
      assert.equal(await isFresh(job), true);
      assert.equal(await isFresh({ ...job, skipIfFresh: false }), false);
    });
  });

  describe('peringatan cuaca BMKG, notifikasi, evakuasi, dan rute aman', () => {
    let notifications;
    let parseCap;
    let syncCapAlerts;
    let notifyQuakes;
    let notifyVolcanoes;
    let syncFacilities;

    // Kota Hujan dan Kabupaten Tetangga bersebelahan di bujur 121.
    before(async () => {
      notifications = await import('../src/notifications.js');
      ({ parseCap } = await import('../src/sources/bmkg-cap.js'));
      ({ syncCapAlerts } = await import('../src/jobs/sync-cap.js'));
      ({ notifyQuakes, notifyVolcanoes } = await import('../src/jobs/notify.js'));
      ({ syncFacilities } = await import('../src/jobs/sync-facilities.js'));
      const square = (w, s, e, n) => `ST_Multi(ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326))`;
      await pool.query(`
        INSERT INTO wilayah (kode, nama, tingkat, induk_kode, titik, geom) VALUES
          ('97', 'Provinsi Cuaca', 'provinsi', NULL, ST_SetSRID(ST_MakePoint(121, -5.5), 4326), ${square(120, -6, 122, -5)}),
          ('97.01', 'Kota Hujan', 'kota', '97', ST_SetSRID(ST_MakePoint(120.5, -5.5), 4326), ${square(120, -6, 121, -5)}),
          ('97.02', 'Kabupaten Tetangga', 'kabupaten', '97', ST_SetSRID(ST_MakePoint(121.5, -5.5), 4326), ${square(121, -6, 122, -5)});`);
    });

    // XML CAP buatan dengan waktu relatif terhadap sekarang, dalam WITA.
    const capXml = ({ identifier, msgType = 'Alert', references = '', polygons }) => {
      const wita = (ms) => `${new Date(ms + 8 * 3_600_000).toISOString().slice(0, 19)}+08:00`;
      const now = Date.now();
      return `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
        <identifier>${identifier}</identifier><sent>${wita(now - 600_000)}</sent><status>Actual</status><msgType>${msgType}</msgType>
        ${references ? `<references>${references}</references>` : ''}
        <info><event>Hujan Lebat dan Petir</event><urgency>Immediate</urgency><severity>Moderate</severity><certainty>Observed</certainty>
          <effective>${wita(now - 300_000)}</effective><expires>${wita(now + 2 * 3_600_000)}</expires>
          <headline>Hujan Lebat disertai Petir di Provinsi Cuaca</headline><description>Uji</description>
          <area><areaDesc>Provinsi Cuaca</areaDesc>${polygons.map((p) => `<polygon>${p}</polygon>`).join('')}</area>
        </info></alert>`;
    };
    // Poligon "lat,lon": A di dalam Kota Hujan; B melewati batas bujur 121 tetapi
    // sebagian besar di Kota Hujan; C di dalam Kabupaten Tetangga.
    const A = '-5.6,120.2 -5.6,120.4 -5.8,120.4 -5.8,120.2 -5.6,120.2';
    const B = '-5.3,120.8 -5.3,121.02 -5.4,121.02 -5.4,120.8 -5.3,120.8';
    const C = '-5.3,121.3 -5.3,121.5 -5.5,121.5 -5.5,121.3 -5.3,121.3';

    test('peringatan cuaca BMKG disimpan, dipetakan ke kab/kota, dan diberitahukan sekali', async () => {
      const heard = [];
      const listen = (n) => heard.push(n);
      notifications.notificationBus.on('notification', listen);
      const xml = { 'CAP-1': capXml({ identifier: 'CAP-1', polygons: [A, B] }), 'CAP-2': capXml({ identifier: 'CAP-2', polygons: [C] }) };
      const fetchFeed = async () => Object.keys(xml).map((id) => ({ identifier: id, url: `https://contoh/${id}.xml` }));
      const fetched = [];
      const fetchAlert = async (url) => {
        fetched.push(url);
        return parseCap(xml[url.match(/CAP-\d/)[0]]);
      };
      const first = await syncCapAlerts({ fetchFeed, fetchAlert });
      assert.deepEqual([first.items, first.message, first.saved], [2, null, ['CAP-1', 'CAP-2']]);
      // Kedua kali: peringatan yang sudah tersimpan tidak diunduh dan diberitahukan ulang.
      await syncCapAlerts({ fetchFeed, fetchAlert });
      // BMKG menerbitkan ulang berkas yang sama dengan identifier baru: juga dilewati.
      const republished = await syncCapAlerts({
        fetchFeed: async () => [{ identifier: 'CAP-1-ulang', url: 'https://contoh/CAP-1.xml' }],
        fetchAlert,
      });
      assert.deepEqual(republished.saved, []);
      assert.equal(fetched.length, 2);
      notifications.notificationBus.off('notification', listen);

      const { body } = await getJson('/cap');
      assert.match(body.attribution, /BMKG/);
      const byId = Object.fromEntries(body.features.map((f) => [f.properties.identifier, f]));
      // Poligon B melewati batas, tetapi titik di dalamnya ada di Kota Hujan.
      assert.deepEqual(byId['CAP-1'].properties.wilayah, [{ kode: '97.01', nama: 'Kota Hujan' }]);
      assert.deepEqual(byId['CAP-2'].properties.wilayah, [{ kode: '97.02', nama: 'Kabupaten Tetangga' }]);
      assert.equal(byId['CAP-1'].geometry.type, 'MultiPolygon');
      assert.equal(byId['CAP-1'].properties.utc_offset, 480);

      assert.deepEqual(heard.map((n) => [n.kind, n.ref, n.wilayah]), [['cuaca', 'CAP-1', ['97.01']], ['cuaca', 'CAP-2', ['97.02']]]);
      assert.match(heard[0].body, /^Berlaku \d\d\.\d\d–\d\d\.\d\d WITA · Kota Hujan$/);

      // Titik di dalam peringatan ikut tampil di cek risiko.
      const { activeCapAlerts } = await import('../src/risk/nearby.js');
      assert.deepEqual((await activeCapAlerts(-5.7, 120.3)).map((a) => a.identifier), ['CAP-1']);
      assert.deepEqual(await activeCapAlerts(-5.7, 121.9), []);
    });

    test('CAP Cancel mengakhiri peringatan yang dirujuknya tanpa notifikasi baru', async () => {
      const cancel = capXml({ identifier: 'CAP-3', msgType: 'Cancel', references: 'bmkg,CAP-2,2026-10-23T00:00:00+08:00', polygons: [C] });
      const result = await syncCapAlerts({
        fetchFeed: async () => [{ identifier: 'CAP-3', url: 'https://contoh/CAP-3.xml' }],
        fetchAlert: async () => parseCap(cancel),
      });
      assert.deepEqual(result.saved, ['CAP-3']);
      const { body } = await getJson('/cap');
      assert.deepEqual(body.features.map((f) => f.properties.identifier), ['CAP-1']);
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM notifications WHERE ref = 'CAP-3'");
      assert.equal(rows[0].n, 0);
    });

    test('gempa BMKG baru dan perubahan level gunung api diberitahukan sekali', async () => {
      const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
      // Gempa dari test sebelumnya juga baru terlihat; diberitahukan dulu.
      await notifyQuakes();
      await syncEarthquakes({
        fetchEvents: async () => ({
          events: [
            quake({ id: 'bmkg:notif-baru', magnitude: 5.6, occurredAt: minutesAgo(10), props: { wilayah: 'Pusat gempa berada di laut 80 km BaratDaya Sumur' } }),
            // Gempa lama yang baru terlihat (mis. server sempat mati) tidak diberitahukan.
            quake({ id: 'bmkg:notif-lama', magnitude: 5.0, occurredAt: minutesAgo(5 * 60) }),
          ],
          errors: [],
        }),
      });
      const quakes = await notifyQuakes();
      assert.deepEqual(quakes.map((n) => n.ref), ['bmkg:notif-baru']);
      assert.equal(quakes[0].level, 1);
      assert.equal(quakes[0].title, 'Gempa M 5,6 · Laut 80 km barat daya Sumur');
      assert.deepEqual(await notifyQuakes(), []);

      const { recordSync } = await import('../src/sync-logs.js');
      const volcano = (level) => [{ kode: 'NTF', nama: 'Notif', kabupaten: null, provinsi: null, elevasiM: 1000, level, lat: -8, lon: 115 }];
      await syncVolcanoes({ fetchVolcanoes: async () => volcano(2) });
      // Sinkronisasi sebelumnya (semenit lalu) tercatat, lalu level berubah pada sinkronisasi ini.
      await recordSync({ source: 'magma', ok: true, items: 1, message: null, startedAt: new Date(Date.now() - 60_000), durationMs: 10 });
      await syncVolcanoes({ fetchVolcanoes: async () => volcano(3) });
      // Test lain di berkas ini juga mengubah level gunung api uji.
      const ours = (list) => list.filter((n) => n.ref.startsWith('NTF:'));
      // Bila sinkronisasi sebelumnya lebih dari 2 jam lalu, waktu perubahannya tidak diketahui.
      assert.deepEqual(await notifyVolcanoes({ now: Date.now() + 3 * 3_600_000 }), []);
      const [changed, ...rest] = ours(await notifyVolcanoes());
      assert.deepEqual(rest, []);
      assert.equal(changed.title, 'Gunung Notif naik ke Level III (Siaga)');
      assert.match(changed.body, /^Sebelumnya Level II \(Waspada\) · /);
      assert.equal(changed.level, 2);
      assert.deepEqual(ours(await notifyVolcanoes()), []);

      // Perubahan yang dilewati karena jeda (server sempat mati) tidak ikut muncul pada
      // sinkronisasi berikutnya, walau terjadi sesudah awal run yang dilewati itu.
      const skippedRunStart = new Date(Date.now() - 1_000);
      await syncVolcanoes({ fetchVolcanoes: async () => volcano(4) });
      assert.deepEqual(ours(await notifyVolcanoes({ now: Date.now() + 3 * 3_600_000 })), []);
      await recordSync({ source: 'magma', ok: true, items: 1, message: null, startedAt: skippedRunStart, durationMs: 10 });
      await syncVolcanoes({ fetchVolcanoes: async () => volcano(4) });
      assert.deepEqual(ours(await notifyVolcanoes()), []);

      const { body } = await getJson('/notifications?limit=100');
      const refs = body.notifications.map((n) => n.ref);
      assert.ok(refs.includes('bmkg:notif-baru') && refs.includes('CAP-1'));
      assert.ok(body.notifications.every((n, i, all) => i === 0 || all[i - 1].id > n.id), 'terbaru dulu');
    });

    // Membaca aliran SSE sampai until(teks) terpenuhi (paling lama 5 detik).
    // trigger dijalankan sekali setelah sambungan terbuka.
    async function readStream(url, { headers = {}, until, trigger }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(url, { headers, signal: controller.signal });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      try {
        while (!until(text)) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          if (trigger && text.includes('retry:')) {
            await trigger();
            trigger = null;
          }
        }
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
      return { status: res.status, type: res.headers.get('content-type'), encoding: res.headers.get('content-encoding'), text };
    }

    test('aliran SSE: notifikasi langsung terkirim tanpa kompresi; sambungan ulang menerima yang terlewat', async () => {
      let published;
      const live = await readStream(`${baseUrl}/stream`, {
        headers: { 'Accept-Encoding': 'gzip' },
        until: (text) => text.includes('event: notification'),
        trigger: async () => {
          [published] = await notifications.publishNotifications([{ kind: 'gempa', ref: 'uji-sse', level: 1, title: 'Gempa uji', body: 'Uji SSE', lat: -7, lon: 107 }]);
        },
      });
      assert.equal(live.status, 200);
      assert.match(live.type, /^text\/event-stream/);
      assert.equal(live.encoding, null);
      assert.match(live.text, /^retry: 10000\n\n/);
      const data = JSON.parse(live.text.match(/event: notification\ndata: (.*)\n\n/)[1]);
      assert.deepEqual([data.id, data.title, data.kind], [published.id, 'Gempa uji', 'gempa']);

      const resumed = await readStream(`${baseUrl}/stream`, {
        headers: { 'Last-Event-ID': String(published.id - 1) },
        until: (text) => text.includes(`id: ${published.id}\n`),
      });
      assert.match(resumed.text, /"ref":"uji-sse"/);
    });

    test('aliran SSE menolak koneksi di atas batas', async () => {
      const express = (await import('express')).default;
      const { createNotificationsRouter } = await import('../src/routes/notifications.js');
      const app = express().use('/api', createNotificationsRouter({ maxClients: 1 })).listen(0);
      const url = `http://localhost:${app.address().port}/api/stream`;
      const first = new AbortController();
      try {
        assert.equal((await fetch(url, { signal: first.signal })).status, 200);
        const busy = await fetch(url);
        assert.equal(busy.status, 503);
        assert.match((await busy.json()).error, /Terlalu banyak koneksi/);
      } finally {
        first.abort();
        app.closeAllConnections();
        app.close();
      }
    });

    test('titik evakuasi dan fasilitas terdekat dalam radius per kategori; data terpotong ditolak', async () => {
      const facility = (id, category, name, lat, lon) => ({ id, category, name, tags: { name }, lat, lon });
      const list = [
        facility('node/1', 'evakuasi', 'Masjid Raya', -5.705, 120.3),
        facility('node/2', 'titik_kumpul', 'Lapangan', -5.7, 120.31),
        facility('way/3', 'evakuasi', 'Sekolah', -5.72, 120.3),
        // ±44 km: di luar radius 30 km titik evakuasi.
        facility('node/4', 'titik_kumpul', 'Jauh', -5.7, 120.7),
        facility('node/5', 'rumah_sakit', 'RS Uji', -5.71, 120.3),
        // Rumah sakit yang sama dipetakan dua kali (titik dan gedung): cukup sekali,
        // dan jatah dua rumah sakit tetap terisi oleh yang berikutnya.
        facility('way/8', 'rumah_sakit', 'RS UJI', -5.7105, 120.3005),
        facility('node/9', 'rumah_sakit', 'RS Kedua', -5.73, 120.3),
        facility('node/6', 'klinik', 'Puskesmas Uji', -5.7, 120.305),
        // ±33 km: di luar radius 25 km pemadam.
        facility('node/7', 'pemadam', 'Damkar Jauh', -5.7, 120.6),
        // Di blok longsor kelas tinggi raster buatan (blok indikasi SIGAP di atas).
        facility('node/10', 'evakuasi', 'Balai Lereng', -7.0225, 110.0225),
      ];
      await syncFacilities({ fetch: async () => list });
      const { status, body } = await getJson('/evacuation?lat=-5.7&lon=120.3');
      assert.equal(status, 200);
      assert.match(body.attribution, /OpenStreetMap/);
      assert.deepEqual(body.evacuation.map((f) => f.name), ['Masjid Raya', 'Lapangan', 'Sekolah']);
      assert.ok(Math.abs(body.evacuation[0].distance_m - 553) < 10, `jarak ${body.evacuation[0].distance_m} m`);
      assert.deepEqual(body.facilities.map((f) => f.name), ['Puskesmas Uji', 'RS Uji', 'RS Kedua']);
      assert.deepEqual(body.evacuation[0].zona_tinggi, []);
      const slope = (await getJson('/evacuation?lat=-7.03&lon=110.03')).body;
      assert.deepEqual(slope.evacuation.map((f) => [f.name, f.zona_tinggi]), [['Balai Lereng', ['longsor']]]);
      assert.equal((await getJson('/evacuation-sites')).body.meta.count, 5);

      await assert.rejects(syncFacilities({ fetch: async () => list.slice(0, 2) }), /data lama dipertahankan/);
      assert.equal((await getJson('/evacuation-sites')).body.meta.count, 5);
      assert.equal((await getJson('/evacuation?lat=50&lon=10')).status, 400);
    });

    // Rute palsu: `uji` di geometri menandai rutenya untuk exposure palsu.
    const routeOf = (distance_m, duration_s) => ({
      distance_m,
      duration_s,
      geometry: { type: 'LineString', coordinates: [[107, -7], [107.02, -6.99]], uji: distance_m },
    });
    const exposureOf = (tinggi_m) => ({
      banjir: { tinggi_m, sedang_m: 0, rendah_m: 0 },
      longsor: { tinggi_m: 0, sedang_m: 0, rendah_m: 0 },
      tinggi_m,
      tinggi_geometry: { banjir: null, longsor: null },
    });
    const postRoute = async (body) => {
      const res = await fetch(`${baseUrl}/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    const FROM = { lat: -7, lon: 107 };
    const TO = { lat: -6.99, lon: 107.02 };

    test('rute aman: paparan terkecil dipilih; rute penghindar diminta bila semua rute melewati zona tinggi', async () => {
      const log = [];
      const exposures = { 1000: 400, 1100: 300, 1500: 0 };
      routeFakes = {
        valhalla: async (args) => {
          log.push(args);
          // Alternatif ketiga hampir sama dengan rute utama, jadi dibuang.
          return args.exclude?.length ? [routeOf(1500, 700)] : [routeOf(1000, 600), routeOf(1100, 620), routeOf(1004, 605)];
        },
        osrm: async () => {
          throw new Error('tidak dipakai');
        },
        exposure: async (geometry) => exposureOf(exposures[geometry.uji]),
        exclusions: async (geometry, from, to, budget) => {
          log.push({ exclusions: geometry.uji, budget });
          return [[[107.005, -7.005], [107.006, -7.005], [107.006, -7.006], [107.005, -7.005]]];
        },
        zones: async ([from, to]) => (to.lat === TO.lat ? [[], ['banjir']] : [[], []]),
      };
      const { status, body } = await postRoute({ from: FROM, to: TO, mode: 'jalan_kaki' });
      assert.equal(status, 200);
      assert.equal(body.engine, 'Valhalla (FOSSGIS)');
      assert.match(body.attribution, /OpenStreetMap/);
      assert.deepEqual(body.zona_tinggi, { from: [], to: ['banjir'] });
      assert.deepEqual(body.routes.map((r) => [r.id, r.source, r.distance_m, r.exposure.tinggi_m]), [
        [0, 'utama', 1000, 400],
        [1, 'alternatif', 1100, 300],
        [2, 'menghindari_zona', 1500, 0],
      ]);
      assert.deepEqual([body.fastest, body.safest, body.avoidance], [0, 2, 'dicoba']);
      // Blok zona diambil dari rute berpaparan terkecil, dalam batas keliling Valhalla.
      assert.deepEqual(log.find((entry) => entry.exclusions), { exclusions: 1100, budget: 9500 });
      assert.equal(log.find((entry) => entry.exclude)?.exclude.length, 1);

      // Rute penghindar yang terlalu lama (> 1,75 × tercepat + 2 menit) tidak dipilih.
      routeFakes.valhalla = async (args) => (args.exclude?.length ? [routeOf(1500, 1200)] : [routeOf(1000, 600), routeOf(1100, 620)]);
      const slow = (await postRoute({ from: FROM, to: TO, mode: 'motor' })).body;
      assert.deepEqual([slow.fastest, slow.safest], [0, 1]);

      // Tidak ada zona tinggi: rute tercepat sekaligus teraman.
      routeFakes.exposure = async () => exposureOf(0);
      const clear = (await postRoute({ from: FROM, to: TO, mode: 'mobil' })).body;
      assert.deepEqual([clear.fastest, clear.safest, clear.avoidance], [0, 0, 'tidak_perlu']);
    });

    test('rute: OSRM bila Valhalla gagal, 502/404 yang jelas, dan masukan yang ditolak', async () => {
      routeFakes = {
        valhalla: async () => {
          throw new Error('ECONNRESET');
        },
        osrm: async () => [routeOf(1000, 600)],
        exposure: async () => exposureOf(200),
        exclusions: async () => {
          throw new Error('OSRM tidak mendukung area terlarang');
        },
        zones: async () => {
          throw new Error('basis data sibuk');
        },
      };
      const fallback = await postRoute({ from: FROM, to: TO });
      assert.equal(fallback.status, 200);
      assert.deepEqual([fallback.body.engine, fallback.body.mode, fallback.body.avoidance], ['OSRM (FOSSGIS)', 'jalan_kaki', 'tidak_bisa']);
      // Zona di ujung rute hanya pelengkap: bila gagal dibaca, rute tetap dikirim.
      assert.deepEqual(fallback.body.zona_tinggi, { from: [], to: [] });

      routeFakes.osrm = async () => {
        throw new Error('ETIMEDOUT');
      };
      assert.equal((await postRoute({ from: FROM, to: TO })).status, 502);
      routeFakes.valhalla = async () => null;
      routeFakes.osrm = async () => null;
      assert.equal((await postRoute({ from: FROM, to: TO })).status, 404);
      assert.equal((await postRoute({ from: FROM, to: TO, mode: 'pesawat' })).status, 400);
      assert.match((await postRoute({ from: FROM, to: { lat: -7.5, lon: 107.5 } })).body.error, /terlalu jauh/);
      assert.equal((await postRoute({ from: { lat: 50, lon: 10 }, to: TO })).status, 400);
    });

    test('paparan rute dari raster kelas: panjang di zona tinggi dan blok yang bisa dihindari', async () => {
      const { exclusionRings, highZonesAt, routeExposure } = await import('../src/risk/route-exposure.js');
      // Garis barat–timur di lintang −7,0225 (tengah satu baris piksel) melintasi blok
      // longsor kelas tinggi dan blok banjir kelas sedang buatan (110,00–110,05) dari
      // blok indikasi SIGAP di atas.
      const line = { type: 'LineString', coordinates: [[109.99, -7.0225], [110.06, -7.0225]] };
      const exposure = await routeExposure(line);
      const blockM = 0.05 * 111_320 * Math.cos((7.0225 * Math.PI) / 180);
      assert.ok(Math.abs(exposure.longsor.tinggi_m - blockM) < 120, `longsor tinggi ${exposure.longsor.tinggi_m} m`);
      assert.ok(Math.abs(exposure.banjir.sedang_m - blockM) < 120, `banjir sedang ${exposure.banjir.sedang_m} m`);
      assert.deepEqual([exposure.banjir.tinggi_m, exposure.tinggi_m], [0, exposure.longsor.tinggi_m]);
      assert.equal(exposure.tinggi_geometry.longsor.type, 'LineString');

      const from = { lat: -7.0225, lon: 109.99 };
      const to = { lat: -7.0225, lon: 110.06 };
      // 10 piksel sebaris menyatu menjadi satu blok (±5,5 × 0,55 km) berkeliling
      // ±12 km, melebihi batas 9,5 km; tanpa penyelarasan grid bloknya terpecah.
      assert.deepEqual(await exclusionRings(line, from, to, 9_500), []);
      const [ring] = await exclusionRings(line, from, to, 20_000);
      const lons = ring.map(([lon]) => lon);
      assert.deepEqual([Math.min(...lons), Math.max(...lons)], [110, 110.05]);

      // Kelas tinggi per titik: blok longsor tinggi (banjirnya sedang), di luar
      // blok, dan di luar cakupan raster.
      assert.deepEqual(
        await highZonesAt([{ lat: -7.0225, lon: 110.0225 }, { lat: -7.0225, lon: 110.2 }, { lat: -5.7, lon: 120.3 }]),
        [['longsor'], [], []],
      );
    });
  });

  // P8 rencana pengujian Tugas 1: galat 5xx, timeout, dan format halaman yang
  // berubah tercatat di sync_logs, sedangkan API tetap melayani data terakhir.
  describe('ketahanan sumber (P8)', () => {
    let runJob;
    let syncCapAlerts;
    let HttpError;
    before(async () => {
      ({ runJob } = await import('../src/jobs/scheduler.js'));
      ({ syncCapAlerts } = await import('../src/jobs/sync-cap.js'));
      ({ HttpError } = await import('../src/lib/http.js'));
    });

    const lastLog = async (source) =>
      (await pool.query('SELECT ok, message FROM sync_logs WHERE source = $1 ORDER BY id DESC LIMIT 1', [source])).rows[0];
    const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

    test('sumber gagal tercatat di sync_logs; data dan waktu sinkron terakhir tetap dilayani', async () => {
      const cases = [
        {
          source: 'bmkg-gempa',
          path: '/earthquakes',
          ok: () => syncEarthquakes({ fetchEvents: async () => ({ events: [quake({ id: 'bmkg:p8-tahan' })], errors: [] }) }),
          // Seperti fetchBmkgEarthquakes bila ketiga feed gagal.
          fail: () =>
            syncEarthquakes({
              fetchEvents: async () => {
                throw new Error(`autogempa: ${new HttpError('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json', 503).message}; gempaterkini: ${timeout().message}`);
              },
            }),
          expected: /HTTP 503 .*timeout/,
        },
        {
          source: 'magma',
          path: '/volcanoes',
          ok: () => syncVolcanoes({ fetchVolcanoes: async () => [{ kode: 'P8T', nama: 'Tahan', kabupaten: null, provinsi: null, elevasiM: 900, level: 2, lat: -7.3, lon: 110.1 }] }),
          // 21 Okt 2026 di server produksi: halaman MAGMA berganti format.
          fail: () =>
            syncVolcanoes({
              fetchVolcanoes: async () => {
                throw new Error('Variabel markersGunungApi tidak ditemukan');
              },
            }),
          expected: /markersGunungApi/,
        },
        {
          source: 'bmkg-cap',
          path: '/cap',
          ok: () => syncCapAlerts({ fetchFeed: async () => [], fetchAlert: async () => null }),
          fail: () =>
            syncCapAlerts({
              fetchFeed: async () => {
                throw timeout();
              },
            }),
          expected: /timeout/,
        },
      ];
      for (const c of cases) {
        assert.equal((await runJob({ source: c.source, run: c.ok })).ok, true, c.source);
        const before = (await getJson(c.path)).body;
        const result = await runJob({ source: c.source, run: c.fail });
        assert.equal(result.ok, false, c.source);
        const log = await lastLog(c.source);
        assert.equal(log.ok, false, c.source);
        assert.match(log.message, c.expected, c.source);
        const after = (await getJson(c.path)).body;
        assert.deepEqual(after.features.map((f) => f.properties.id ?? f.properties.kode ?? f.properties.identifier), before.features.map((f) => f.properties.id ?? f.properties.kode ?? f.properties.identifier), c.source);
        // Waktu sinkron terakhir tidak maju, jadi browser bisa menandai data tertunda.
        assert.equal(after.meta.synced_at, before.meta.synced_at, c.source);
      }
    });
  });
});
