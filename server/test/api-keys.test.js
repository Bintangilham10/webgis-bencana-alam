import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import express from 'express';
import { generateKey, hashKey, KEY_PATTERN, keyPrefix, nextReset, validateRegistration } from '../src/api-keys.js';
import { createV1Router, ENDPOINTS } from '../src/routes/v1.js';

describe('kunci API: bentuk dan pendaftaran', () => {
  test('kunci acak 192 bit berawalan sigap_; yang disimpan hanya sidiknya', () => {
    const a = generateKey();
    const b = generateKey();
    assert.match(a, KEY_PATTERN);
    assert.notEqual(a, b);
    assert.equal(keyPrefix(a), a.slice(0, 14));
    assert.match(hashKey(a), /^[0-9a-f]{64}$/);
    assert.equal(hashKey(a), hashKey(a));
    assert.notEqual(hashKey(a), hashKey(b));
  });

  test('kuota berganti tengah malam UTC berikutnya (07.00 WIB)', () => {
    assert.equal(nextReset(new Date('2026-11-24T03:15:00Z')).toISOString(), '2026-11-25T00:00:00.000Z');
    assert.equal(nextReset(new Date('2026-12-31T23:59:59Z')).toISOString(), '2027-01-01T00:00:00.000Z');
  });

  test('isi formulir dirapikan; yang kurang ditolak dengan alasan', () => {
    const ok = { name: '  Tim   Peta  ', email: ' Tim@Contoh.AC.id ', purpose: 'Dasbor kebencanaan kampus', agree: true };
    assert.deepEqual(validateRegistration(ok), { value: { name: 'Tim Peta', email: 'tim@contoh.ac.id', purpose: 'Dasbor kebencanaan kampus' } });
    assert.match(validateRegistration({ ...ok, name: 'A' }).error, /Nama/);
    for (const email of ['bukan-email', 'a@b', 'a@@b.id', 'a b@c.id', '@contoh.id', 'a@contoh.', 'a@.id', 'a@contoh.i']) {
      assert.match(validateRegistration({ ...ok, email }).error, /email/, email);
    }
    assert.equal(validateRegistration({ ...ok, email: 'nama.depan+uji@sub.contoh.ac.id' }).value.email, 'nama.depan+uji@sub.contoh.ac.id');
    assert.match(validateRegistration({ ...ok, purpose: 'coba' }).error, /Tujuan/);
    assert.match(validateRegistration({ ...ok, agree: 'ya' }).error, /Ketentuan/);
    assert.match(validateRegistration(undefined).error, /Nama/);
    assert.match(validateRegistration({ ...ok, name: { $ne: '' } }).error, /Nama/);
  });

  test('karakter kendali dan karakter tak terlihat tidak ikut tersimpan', () => {
    const ok = { name: 'Tim\u001b[31m Peta‮\u0007', email: 'tim@contoh.id', purpose: 'Dasbor\tkebencanaan\nkampus​', agree: true };
    assert.deepEqual(validateRegistration(ok).value, { name: 'Tim [31m Peta', email: 'tim@contoh.id', purpose: 'Dasbor kebencanaan kampus' });
    assert.match(validateRegistration({ ...ok, email: 'tim\u0000@contoh.id' }).error, /email/);
    assert.match(validateRegistration({ ...ok, name: '\u001b\u001b​' }).error, /Nama/);
  });
});

// Router v1 dengan penyimpanan kunci tiruan di memori dan satu router data kecil.
describe('API v1: kunci, kuota, dan endpoint yang dibuka', () => {
  const VALID = 'sigap_' + 'a'.repeat(32);
  const REVOKED = 'sigap_' + 'b'.repeat(32);
  const used = { [VALID]: 0 };

  const keys = {
    KEY_PATTERN,
    MAX_KEYS_PER_EMAIL: 3,
    DEFAULT_DAILY_QUOTA: 1000,
    validateRegistration,
    nextReset: () => new Date('2026-11-25T00:00:00Z'),
    createKey: async ({ email }) => (email === 'penuh@contoh.id' ? null : { key: VALID, prefix: VALID.slice(0, 14), daily_quota: 2, created_at: '2026-11-24T00:00:00.000Z' }),
    consumeKey: async (key) => {
      if (key === REVOKED) return { id: 2, daily_quota: 2, revoked: true, requests: null };
      if (key !== VALID) return null;
      used[VALID]++;
      return { id: 1, daily_quota: 2, revoked: false, requests: used[VALID] };
    },
    keyUsage: async () => [{ date: '2026-11-24', requests: used[VALID] }],
  };

  async function withServer(run, options = {}) {
    const data = express.Router();
    data.get('/earthquakes', (req, res) => res.set('Cache-Control', 'public, max-age=300').json({ type: 'FeatureCollection', features: [] }));
    data.get('/volcanoes', (req, res) => res.json({ type: 'FeatureCollection', features: [] }));
    data.get('/risk', (req, res) => res.json({ bocor: true }));
    const app = express().use('/api/v1', createV1Router({ data: [data], keys, ...options }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      await run(`http://127.0.0.1:${server.address().port}/api/v1`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  test('daftar endpoint terbuka tanpa kunci dan memuat sumber tiap data', async () => {
    await withServer(async (base) => {
      const res = await fetch(base);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.endpoints.length, ENDPOINTS.length);
      assert.deepEqual([body.daily_quota_default, body.max_keys_per_email], [1000, 3]);
      assert.ok(body.endpoints.every((e) => e.path.startsWith('/api/v1/') && e.source && e.description));
      assert.ok(body.endpoints.some((e) => e.path === '/api/v1/stream'));
    });
  });

  test('tanpa kunci atau kunci salah: 401; kunci dicabut: 403', async () => {
    await withServer(async (base) => {
      const none = await fetch(`${base}/earthquakes`);
      assert.equal(none.status, 401);
      assert.match((await none.json()).error, /Kunci API tidak ada/);
      assert.equal((await fetch(`${base}/earthquakes`, { headers: { 'X-API-Key': 'salah' } })).status, 401);
      assert.equal((await fetch(`${base}/earthquakes`, { headers: { 'X-API-Key': 'sigap_' + 'z'.repeat(32) } })).status, 401);
      const revoked = await fetch(`${base}/earthquakes`, { headers: { 'X-API-Key': REVOKED } });
      assert.equal(revoked.status, 403);
      assert.match((await revoked.json()).error, /dicabut/);
    });
  });

  test('kunci sah: data, sisa kuota di header, cache tidak publik; di atas kuota: 429', async () => {
    used[VALID] = 0;
    await withServer(async (base) => {
      const first = await fetch(`${base}/earthquakes`, { headers: { 'X-API-Key': VALID } });
      assert.equal(first.status, 200);
      assert.deepEqual([first.headers.get('x-ratelimit-limit'), first.headers.get('x-ratelimit-remaining')], ['2', '1']);
      assert.equal(first.headers.get('x-ratelimit-reset'), String(Date.parse('2026-11-25T00:00:00Z') / 1000));
      assert.equal(first.headers.get('cache-control'), 'private, max-age=300');
      assert.equal((await first.json()).type, 'FeatureCollection');

      const bearer = await fetch(`${base}/earthquakes`, { headers: { Authorization: `Bearer ${VALID}` } });
      assert.equal(bearer.status, 200);
      assert.equal(bearer.headers.get('x-ratelimit-remaining'), '0');

      const over = await fetch(`${base}/earthquakes`, { headers: { 'X-API-Key': VALID } });
      assert.equal(over.status, 429);
      assert.ok(Number(over.headers.get('retry-after')) >= 1);
      assert.match((await over.json()).error, /Kuota harian/);
    });
  });

  test('skema Bearer boleh huruf kecil; jawaban yang tidak mengatur cache ditandai private', async () => {
    used[VALID] = 0;
    await withServer(async (base) => {
      const res = await fetch(`${base}/volcanoes`, { headers: { Authorization: `bearer ${VALID}` } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'private');
      assert.equal((await fetch(`${base}/volcanoes`, { headers: { Authorization: `Basic ${VALID}` } })).status, 401);
    });
  });

  test('endpoint di luar daftar tidak terbuka walau ada di router data', async () => {
    used[VALID] = 0;
    await withServer(async (base) => {
      const res = await fetch(`${base}/risk?lat=-7&lon=107`, { headers: { 'X-API-Key': VALID } });
      assert.equal(res.status, 404);
      assert.match((await res.json()).error, /tidak ada di API v1/);
    });
  });

  test('pemakaian kunci sendiri', async () => {
    used[VALID] = 0;
    await withServer(async (base) => {
      const res = await fetch(`${base}/usage`, { headers: { 'X-API-Key': VALID } });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        daily_quota: 2, used_today: 1, remaining_today: 1, resets_at: '2026-11-25T00:00:00.000Z', last_7_days: [{ date: '2026-11-24', requests: 1 }],
      });
    });
  });

  test('pendaftaran: 201 dengan kunci, 400 bila isian kurang, 409 bila email penuh, 429 bila terlalu sering', async () => {
    const post = (base, body) => fetch(`${base}/keys`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const form = { name: 'Tim Peta', email: 'tim@contoh.id', purpose: 'Dasbor kebencanaan kampus', agree: true };
    await withServer(async (base) => {
      const created = await post(base, form);
      assert.equal(created.status, 201);
      assert.equal(created.headers.get('cache-control'), 'no-store');
      const body = await created.json();
      assert.deepEqual([body.key, body.prefix, body.daily_quota], [VALID, VALID.slice(0, 14), 2]);
      assert.match(body.message, /tidak bisa ditampilkan lagi/);

      const invalid = await post(base, { ...form, agree: false });
      assert.equal(invalid.status, 400);
      const full = await post(base, { ...form, email: 'penuh@contoh.id' });
      assert.equal(full.status, 409);
      assert.match((await full.json()).error, /sudah punya 3 kunci aktif/);
    });
    await withServer(async (base) => {
      assert.equal((await post(base, form)).status, 201);
      const blocked = await post(base, form);
      assert.equal(blocked.status, 429);
      assert.match((await blocked.json()).error, /Terlalu banyak pendaftaran/);
    }, { registerLimit: { limit: 1 } });
  });

  test('CORS: data boleh dibaca dari situs lain, pendaftaran kunci tidak', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/earthquakes`, { method: 'OPTIONS', headers: { Origin: 'https://contoh.id', 'Access-Control-Request-Headers': 'x-api-key' } });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      assert.match(res.headers.get('access-control-allow-headers'), /X-API-Key/);

      // Tanpa header CORS pada jawaban permintaan awal, browser tidak mengirim POST lintas situs.
      // Berlaku untuk semua penulisan alamat yang diterima Express.
      const form = { name: 'Tim Peta', email: 'tim@contoh.id', purpose: 'Dasbor kebencanaan kampus', agree: true };
      for (const path of ['/keys', '/keys/', '/KEYS']) {
        const preflight = await fetch(`${base}${path}`, { method: 'OPTIONS', headers: { Origin: 'https://contoh.id', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
        assert.equal(preflight.status, 204, path);
        assert.equal(preflight.headers.get('access-control-allow-origin'), null, path);
        const created = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://contoh.id' }, body: JSON.stringify(form) });
        assert.equal(created.status, 201, path);
        assert.equal(created.headers.get('access-control-allow-origin'), null, path);
      }
      // Tanpa isi JSON (permintaan lintas situs "sederhana" tidak bisa mengirim JSON): ditolak.
      const simple = await fetch(`${base}/keys`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(form) });
      assert.equal(simple.status, 400);
    });
  });

  test('aliran notifikasi: sambungan sekaligus per kunci dibatasi, dan dibebaskan lagi saat ditutup', async () => {
    used[VALID] = -1000;
    const stream = express.Router();
    stream.get('/stream', (req, res) => {
      res.set('Content-Type', 'text/event-stream').flushHeaders();
      res.write('retry: 10000\n\n');
    });
    const app = express().use('/api/v1', createV1Router({ data: [stream], keys, maxStreamsPerKey: 2 }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/v1/stream`;
    const open = async () => {
      const controller = new AbortController();
      const res = await fetch(url, { headers: { 'X-API-Key': VALID }, signal: controller.signal });
      return { res, close: () => controller.abort() };
    };
    try {
      const first = await open();
      const second = await open();
      assert.deepEqual([first.res.status, second.res.status], [200, 200]);
      const third = await open();
      assert.equal(third.res.status, 429);
      assert.match((await third.res.json()).error, /sudah membuka 2 aliran/);
      first.close();
      // Server baru tahu sambungan tertutup sesaat kemudian.
      let again;
      for (let i = 0; i < 20 && again?.res.status !== 200; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        again = await open();
      }
      assert.equal(again.res.status, 200);
      again.close();
      second.close();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
