import { timeAgo } from '../lib/format.js';

// Kesegaran data per sumber, ditampilkan di bilah atas sebagai titik status +
// teks singkat; rincian per sumber ada di tooltip. Gempa dianggap tertunda bila
// sinkronisasi terakhir lebih dari 5 menit lalu (penjadwal server tiap 60 detik).
const STALE_AFTER_MS = { Gempa: 5 * 60_000, 'Gunung api': 90 * 60_000 };
const REFRESH_TEXT_MS = 30_000;

export function createFreshness(element) {
  element.innerHTML = '<span class="freshness-dot" aria-hidden="true"></span><span class="freshness-text">Memuat data…</span>';
  const text = element.querySelector('.freshness-text');
  const sources = new Map();

  function render() {
    const now = Date.now();
    let state = sources.size ? 'ok' : 'loading';
    const details = [];
    for (const [name, { syncedAt, error }] of sources) {
      if (error) {
        state = 'error';
        details.push(`${name}: gagal dimuat`);
      } else if (!syncedAt) {
        if (state === 'ok') state = 'stale';
        details.push(`${name}: belum pernah tersinkron`);
      } else {
        if (state === 'ok' && now - new Date(syncedAt) > STALE_AFTER_MS[name]) state = 'stale';
        details.push(`${name}: ${timeAgo(syncedAt, now)}`);
      }
    }
    const quakeSync = sources.get('Gempa')?.syncedAt;
    text.textContent = {
      loading: 'Memuat data…',
      error: 'Sebagian data gagal dimuat',
      stale: 'Data tertunda',
      ok: quakeSync ? `Diperbarui ${timeAgo(quakeSync, now)}` : 'Data terkini',
    }[state];
    element.dataset.state = state;
    element.title = details.length ? `Kesegaran data\n${details.join('\n')}` : '';
  }

  render();
  setInterval(render, REFRESH_TEXT_MS);
  return {
    ok(name, syncedAt) {
      sources.set(name, { syncedAt });
      render();
    },
    fail(name, error) {
      console.error(error);
      sources.set(name, { error });
      render();
    },
  };
}
