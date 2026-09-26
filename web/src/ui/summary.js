import { escapeHtml, timeAgo } from '../lib/format.js';
import { depthColor } from '../lib/symbology.js';

const HOUR_MS = 3_600_000;
const LIST_SIZE = 6;

export function renderEarthquakeSummary(collection, { list, count24h, countM5, onSelect }) {
  const now = Date.now();
  const quakes = collection.features.map((f) => f.properties);
  count24h.textContent = quakes.filter((q) => now - new Date(q.occurred_at) < 24 * HOUR_MS).length;
  countM5.textContent = quakes.filter((q) => q.magnitude >= 5).length;

  list.replaceChildren(
    ...quakes.slice(0, LIST_SIZE).map((q) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `
        <span class="mag" style="background:${depthColor(q.depth_class)}">${q.magnitude.toFixed(1)}</span>
        <span class="where">${escapeHtml(q.wilayah)}${q.tsunami ? ' <strong class="text-danger">· potensi tsunami</strong>' : ''}</span>
        <span class="when">${timeAgo(q.occurred_at, now)}</span>`;
      button.addEventListener('click', () => onSelect(q.id));
      item.append(button);
      return item;
    }),
  );
  if (!quakes.length) list.innerHTML = '<li class="muted">Belum ada data gempa 7 hari terakhir.</li>';
}

export function renderVolcanoSummary(collection, { countAlert }) {
  countAlert.textContent = collection.features.filter((f) => f.properties.level >= 3).length;
}

// Kesegaran data per sumber. Gempa dianggap basi bila sinkronisasi terakhir
// lebih dari 5 menit lalu (penjadwal server berjalan tiap 60 detik).
const STALE_AFTER_MS = { Gempa: 5 * 60_000, 'Gunung api': 90 * 60_000 };

export function createSyncStatus(element) {
  const sources = new Map();

  const render = () => {
    const now = Date.now();
    let problem = false;
    const parts = [...sources].map(([name, { syncedAt, error }]) => {
      if (error) {
        problem = true;
        return `${name}: gagal dimuat`;
      }
      if (!syncedAt) {
        problem = true;
        return `${name}: belum pernah tersinkron`;
      }
      if (now - new Date(syncedAt) > STALE_AFTER_MS[name]) problem = true;
      return `${name} ${timeAgo(syncedAt, now)}`;
    });
    element.textContent = parts.length ? `Data: ${parts.join(' · ')}` : 'Memuat data…';
    element.classList.toggle('is-problem', problem);
  };

  setInterval(render, 30_000);
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
