import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { rateLimit } from '../src/lib/rate-limit.js';

// Memanggil middleware dengan req/res tiruan: 'lanjut' bila diteruskan, atau
// { status, headers, body } bila ditolak.
function call(limiter, ip) {
  let result = 'lanjut';
  const headers = {};
  const res = {
    set(name, value) {
      headers[name] = value;
      return res;
    },
    status(code) {
      result = { status: code, headers };
      return res;
    },
    json(body) {
      result.body = body;
      return res;
    },
  };
  limiter({ ip }, res, () => {});
  return result;
}

describe('batas permintaan per IP', () => {
  test('melewati batas dalam satu jendela: 429 dengan Retry-After; IP lain tidak terpengaruh', () => {
    let t = 0;
    const limiter = rateLimit({ limit: 2, windowMs: 60_000, message: 'pelan-pelan', now: () => t });
    assert.equal(call(limiter, '203.0.113.5'), 'lanjut');
    assert.equal(call(limiter, '203.0.113.5'), 'lanjut');
    t = 15_000;
    const blocked = call(limiter, '203.0.113.5');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers['Retry-After'], '45');
    assert.deepEqual(blocked.body, { error: 'pelan-pelan' });
    assert.equal(call(limiter, '198.51.100.7'), 'lanjut');
    // Jendela baru: hitungan mulai lagi.
    t = 60_000;
    assert.equal(call(limiter, '203.0.113.5'), 'lanjut');
  });

  test('di belakang proxy lokal, batas dihitung per IP pengguna dari X-Forwarded-For', async () => {
    const app = createApp({ services: { rateLimit: { limit: 1 } } });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    // Kata kunci kosong ditolak (400) sebelum database disentuh, tetapi tetap dihitung.
    const search = (ip) => fetch(`${base}/api/geocode?q=`, { headers: { 'X-Forwarded-For': ip } });
    try {
      assert.equal((await search('203.0.113.5')).status, 400);
      const blocked = await search('203.0.113.5');
      assert.equal(blocked.status, 429);
      assert.match((await blocked.json()).error, /Terlalu banyak pencarian/);
      assert.equal((await search('198.51.100.7')).status, 400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
