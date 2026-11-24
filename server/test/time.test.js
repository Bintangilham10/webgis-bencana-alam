import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/app.js';

describe('jam server', () => {
  test('/api/time memberi waktu UTC sampai milidetik dan tidak boleh di-cache', async () => {
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const before = Date.now();
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/time`);
      const after = Date.now();
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const { time } = await res.json();
      assert.match(time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.ok(Date.parse(time) >= before && Date.parse(time) <= after, 'di antara waktu kirim dan terima');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
