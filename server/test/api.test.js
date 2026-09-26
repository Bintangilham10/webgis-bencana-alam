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

  before(async () => {
    // config.js membaca DATABASE_URL saat di-import, jadi harus diset dulu.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ({ pool } = await import('../src/db.js'));
    const { migrate } = await import('../db/migrate.js');
    await migrate();
    await pool.query('TRUNCATE events, volcanoes, sync_logs');
    ({ syncEarthquakes } = await import('../src/jobs/sync-earthquakes.js'));
    ({ syncVolcanoes } = await import('../src/jobs/sync-volcanoes.js'));

    const { createApp } = await import('../src/app.js');
    server = createApp().listen(0);
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
});
