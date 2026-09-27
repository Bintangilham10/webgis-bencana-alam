import { escapeHtml, formatDecimal, shortQuakeRegion, timeAgo } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { animateNumber } from '../lib/motion.js';
import { depthClass, pillStyle, VOLCANO_LEVELS } from '../lib/symbology.js';

const HOUR_MS = 3_600_000;
const QUAKE_LIST_SIZE = 6;

const volcanoName = (nama) => (/^gunung\s/i.test(nama) ? nama : `Gunung ${nama}`);

function quakeRow(q, index, now) {
  const depth = depthClass(q.depth_class);
  return `
    <li style="--i:${index}">
      <button type="button" class="list-row" data-quake="${escapeHtml(q.id)}">
        <span class="mag-badge" style="${pillStyle(depth)}"><span class="visually-hidden">Magnitudo </span>${formatDecimal(q.magnitude)}</span>
        <span class="list-row__text">
          <span class="list-row__title">${escapeHtml(shortQuakeRegion(q.wilayah))}</span>
          <span class="list-row__meta">Kedalaman ${q.depth_km} km · ${timeAgo(q.occurred_at, now)}</span>
        </span>
        ${q.tsunami ? `<span class="tsunami-pill">${icons.alert}Tsunami</span>` : ''}
      </button>
    </li>`;
}

function volcanoRow(v, index) {
  const level = VOLCANO_LEVELS[v.level];
  return `
    <li style="--i:${index}">
      <button type="button" class="list-row" data-volcano="${escapeHtml(v.kode)}">
        <span class="row-icon"><span class="volcano-glyph" style="--level-color:${level.color}"></span></span>
        <span class="list-row__text">
          <span class="list-row__title">${escapeHtml(volcanoName(v.nama))}</span>
          <span class="list-row__meta">${escapeHtml(v.provinsi ?? '')}</span>
        </span>
        <span class="level-pill" style="${pillStyle(level)}">${level.short}</span>
      </button>
    </li>`;
}

// Isi daftar diganti setiap pembaruan (supaya "x menit lalu" tetap akurat),
// tetapi animasi berurutan hanya diputar bila isinya benar-benar berubah.
function renderList(list, html, signature) {
  const changed = list.dataset.signature !== signature;
  list.dataset.signature = signature;
  list.classList.toggle('stagger', changed);
  list.removeAttribute('aria-busy');
  list.innerHTML = html;
}

// Tab Ikhtisar: kartu statistik nasional (angka menghitung naik), gunung api
// berstatus tinggi, dan daftar gempa terkini (klik untuk menuju ke peta).
export function createOverview({ stats, quakeList, volcanoList, onSelectQuake, onSelectVolcano }) {
  quakeList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quake]');
    if (button) onSelectQuake(button.dataset.quake);
  });
  volcanoList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-volcano]');
    if (button) onSelectVolcano(button.dataset.volcano);
  });

  return {
    renderQuakes(collection) {
      const now = Date.now();
      const quakes = collection.features.map((f) => f.properties);
      const lastDay = quakes.filter((q) => now - new Date(q.occurred_at) < 24 * HOUR_MS);
      const strongest = lastDay.reduce((max, q) => (!max || q.magnitude > max.magnitude ? q : max), null);
      animateNumber(stats.quakes24h, lastDay.length);
      stats.quakes24hSub.textContent = strongest ? `terbesar M ${formatDecimal(strongest.magnitude)}` : 'tidak ada';
      animateNumber(stats.quakesM5, quakes.filter((q) => q.magnitude >= 5).length);

      const shown = quakes.slice(0, QUAKE_LIST_SIZE);
      renderList(
        quakeList,
        shown.length
          ? shown.map((q, i) => quakeRow(q, i, now)).join('')
          : '<li class="empty-note">Belum ada gempa tercatat dalam 7 hari terakhir.</li>',
        shown.map((q) => `${q.id}:${q.magnitude}`).join('|'),
      );
    },

    renderVolcanoes(collection) {
      const volcanoes = collection.features.map((f) => f.properties);
      const high = volcanoes
        .filter((v) => v.level >= 3)
        .sort((a, b) => b.level - a.level || a.nama.localeCompare(b.nama, 'id'));
      const waspada = volcanoes.filter((v) => v.level === 2).length;
      animateNumber(stats.volcanoes, high.length);
      stats.volcanoesSub.textContent = `dari ${volcanoes.length} dipantau`;

      renderList(
        volcanoList,
        (high.length ? high.map(volcanoRow).join('') : '<li class="empty-note">Tidak ada gunung api berstatus Siaga atau Awas.</li>') +
          (waspada ? `<li class="list-note" style="--i:${high.length}">${waspada} gunung api lain berstatus Waspada (Level II).</li>` : ''),
        `${high.map((v) => `${v.kode}:${v.level}`).join('|')}#${waspada}`,
      );
    },

    // Daftar lama tetap ditampilkan bila ada; pesan hanya menggantikan kerangka muat.
    showError(list, message) {
      if (list.getAttribute('aria-busy') === 'true') {
        list.removeAttribute('aria-busy');
        list.innerHTML = `<li class="empty-note">${escapeHtml(message)}</li>`;
      }
    },
  };
}
