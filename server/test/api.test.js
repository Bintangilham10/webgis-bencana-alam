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
  const calls = { identify: 0, places: 0 };
  let placesShouldFail = false;
  // Router menyimpan referensi fungsi saat dibuat, jadi hasil palsu diatur lewat variabel ini.
  let placesOverride = null;
  // Tanggal "hari ini" (WIB) untuk jendela indikasi SIGAP.
  let outlookToday = '2026-09-29';
  const services = {
    outlook: { today: () => outlookToday },
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
      'TRUNCATE events, volcanoes, sync_logs, faults, wilayah, wilayah_bahaya, titik_pantau, bahaya_raster, indikasi_run, indikasi_wilayah, indikasi_hari',
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
      // Gempa uji pertama (Selat Sunda, ±196 km) berada di luar radius 100 km.
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
});
