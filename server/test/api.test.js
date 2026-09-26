import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

// Test integrasi memakai database terpisah supaya data pengembangan tidak
// tersentuh. Buat sekali: docker compose exec db createdb -U sigap sigap_test
// lalu jalankan dengan TEST_DATABASE_URL=postgres://sigap:sigap@localhost:5433/sigap_test
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe('API (integrasi database)', { skip: !TEST_DATABASE_URL && 'TEST_DATABASE_URL tidak diset' }, () => {
  let pool;
  let server;
  let baseUrl;
  let syncEarthquakes;
  let syncVolcanoes;

  // Layanan luar diganti versi palsu; jumlah panggilan dicatat untuk menguji cache.
  const calls = { identify: 0, places: 0 };
  let placesShouldFail = false;
  // Router menyimpan referensi fungsi saat dibuat, jadi hasil palsu diatur lewat variabel ini.
  let placesOverride = null;
  const services = {
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
        days: [
          { date: '2026-09-26', precipitationMm: 60, probabilityPct: 90 },
          { date: '2026-09-27', precipitationMm: 10, probabilityPct: 60 },
          { date: '2026-09-28', precipitationMm: 5, probabilityPct: 40 },
        ],
      }),
    },
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
    ({ pool } = await import('../src/db.js'));
    const { migrate } = await import('../db/migrate.js');
    await migrate();
    await pool.query('TRUNCATE events, volcanoes, sync_logs, faults, wilayah');
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
    });

    test('profil risiko menggabungkan InaRISK, cuaca, dan analisis kedekatan', async () => {
      const { status, body } = await getJson('/risk?lat=-7&lon=107');
      assert.equal(status, 200);
      assert.deepEqual(body.location.wilayah, { kode: '99.01', nama: 'Kabupaten Uji', provinsi: 'Provinsi Uji' });
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

    test('titik yang sama (dibulatkan 3 desimal) dilayani dari cache', async () => {
      const before = calls.identify;
      await getJson('/risk?lat=-7.0001&lon=107.0002');
      assert.equal(calls.identify, before);
    });

    test('titik di luar wilayah administrasi tetap dilayani tanpa nama wilayah', async () => {
      const { status, body } = await getJson('/risk?lat=-9.5&lon=107');
      assert.equal(status, 200);
      assert.equal(body.location.wilayah, null);
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
});
