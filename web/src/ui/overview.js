import { capitalize, escapeHtml, formatDateRange, formatDay, formatDecimal, shortQuakeRegion, timeAgo } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { animateNumber } from '../lib/motion.js';
import { CEWS_LEVELS, depthClass, pillStyle, VOLCANO_LEVELS, WARNING_LEVEL_STYLES } from '../lib/symbology.js';

const HOUR_MS = 3_600_000;
const QUAKE_LIST_SIZE = 6;
const RAIN_LIST_SIZE = 5;
const OUTLOOK_LIST_SIZE = 5;
const COUNT_KEYS = ['normal', 'waspada', 'siaga', 'awas'];
const OUTLOOK_HAZARDS = { hujan: 'hujan lebat', banjir: 'banjir', longsor: 'tanah longsor' };

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

function rainWarningRow(r, index) {
  const style = CEWS_LEVELS[r.level];
  return `
    <li style="--i:${index}">
      <button type="button" class="list-row" data-rain-warning="${escapeHtml(r.kode)}">
        <span class="row-icon"><span class="rain-swatch" style="--c:${style.color}"></span></span>
        <span class="list-row__text">
          <span class="list-row__title">${escapeHtml(r.nama)}</span>
          <span class="list-row__meta">${escapeHtml(r.provinsi)}</span>
        </span>
        <span class="level-pill" style="${pillStyle(style)}">${escapeHtml(style.label)}</span>
      </button>
    </li>`;
}

// Kab/kota dengan indikasi SIGAP Waspada ke atas: bahaya penyebab level
// tertingginya dan hari puncaknya.
function outlookRow(region, index) {
  const style = WARNING_LEVEL_STYLES[region.level];
  const worst = Object.keys(OUTLOOK_HAZARDS).filter((hazard) => region.hazards[hazard]?.level === region.level);
  const peak = worst.map((hazard) => region.hazards[hazard].peak_date).filter(Boolean).sort()[0];
  const meta = `${capitalize(worst.map((hazard) => OUTLOOK_HAZARDS[hazard]).join(', '))}${peak ? ` · puncak ${formatDay(peak)}` : ''}`;
  return `
    <li style="--i:${index}">
      <button type="button" class="list-row" data-outlook="${escapeHtml(region.kode)}">
        <span class="row-icon"><span class="rain-swatch" style="--c:${style.color}"></span></span>
        <span class="list-row__text">
          <span class="list-row__title">${escapeHtml(region.nama)}</span>
          <span class="list-row__meta">${escapeHtml(meta)}</span>
        </span>
        <span class="level-pill" style="${pillStyle(style)}">${escapeHtml(style.label)}</span>
      </button>
    </li>`;
}

const worstCount = (region) => Object.keys(OUTLOOK_HAZARDS).filter((hazard) => region.hazards[hazard]?.level === region.level).length;

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
export function createOverview({
  stats,
  quakeList,
  volcanoList,
  rainList,
  rainMeta,
  outlook,
  onSelectQuake,
  onSelectVolcano,
  onSelectRainWarning,
  onSelectOutlook,
}) {
  quakeList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quake]');
    if (button) onSelectQuake(button.dataset.quake);
  });
  volcanoList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-volcano]');
    if (button) onSelectVolcano(button.dataset.volcano);
  });
  rainList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rain-warning]');
    if (button) onSelectRainWarning(button.dataset.rainWarning);
  });
  outlook.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-outlook]');
    if (button) onSelectOutlook(button.dataset.outlook);
  });

  // Ubin jumlah kab/kota per level dibuat sekali; angkanya menghitung naik saat berubah.
  function countTiles() {
    if (!outlook.counts.querySelector('.level-count')) {
      outlook.counts.removeAttribute('aria-busy');
      outlook.counts.innerHTML = [3, 2, 1, 0]
        .map(
          (level) => `
            <div class="level-count" data-level="${level}" style="--c:${WARNING_LEVEL_STYLES[level].color}">
              <span class="level-count__value">0</span>
              <span class="level-count__label">${WARNING_LEVEL_STYLES[level].label}</span>
            </div>`,
        )
        .join('');
    }
    return outlook.counts.querySelectorAll('.level-count');
  }

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

    // Peringatan dini curah hujan tinggi BMKG (CEWS) untuk dasarian berjalan:
    // kab/kota Waspada ke atas, tertinggi dulu. Klik untuk menuju wilayahnya.
    renderRainWarnings(summary, period) {
      rainMeta.textContent = `BMKG · ${period}`;
      const regions = summary.regions;
      const shown = regions.slice(0, RAIN_LIST_SIZE);
      let html;
      if (!summary.published) html = '<li class="empty-note">BMKG belum menerbitkan peringatan untuk dasarian ini.</li>';
      else if (!regions.length) html = '<li class="empty-note">Tidak ada kab/kota berstatus Waspada atau lebih tinggi.</li>';
      else {
        html = shown.map(rainWarningRow).join('');
        if (regions.length > shown.length) {
          html += `<li class="list-note" style="--i:${shown.length}">${regions.length - shown.length} kab/kota lain juga berstatus Waspada atau lebih tinggi. Lihat semuanya di peta.</li>`;
        }
      }
      renderList(rainList, html, `${summary.dasarian.start}#${regions.map((r) => `${r.kode}:${r.level}`).join('|')}`);
    },

    // Indikasi SIGAP 3 hari: jumlah kab/kota per level tertinggi, lalu kab/kota
    // Waspada ke atas (tertinggi dulu). Klik untuk menuju wilayahnya.
    renderOutlook(data) {
      outlook.meta.textContent = formatDateRange(data.run.forecast_from, data.run.forecast_to);
      const counts = data.counts.tertinggi;
      for (const tile of countTiles()) {
        const value = counts[COUNT_KEYS[tile.dataset.level]];
        tile.classList.toggle('is-zero', value === 0);
        animateNumber(tile.querySelector('.level-count__value'), value);
      }
      const warned = data.regions
        .filter((r) => r.level >= 1)
        .sort((a, b) => b.level - a.level || worstCount(b) - worstCount(a) || a.nama.localeCompare(b.nama, 'id'));
      const shown = warned.slice(0, OUTLOOK_LIST_SIZE);
      let html = shown.length
        ? shown.map(outlookRow).join('')
        : '<li class="empty-note">Tidak ada kab/kota dengan indikasi Waspada atau lebih tinggi untuk 3 hari ke depan.</li>';
      if (warned.length > shown.length) {
        html += `<li class="list-note" style="--i:${shown.length}">${warned.length - shown.length} kab/kota lain juga Waspada atau lebih tinggi. Lihat semuanya di peta.</li>`;
      }
      if (counts.tanpa_data) html += `<li class="list-note">${counts.tanpa_data} kab/kota tanpa data hujan pada perhitungan ini.</li>`;
      renderList(outlook.list, html, `${data.run.id}`);
    },

    // Belum ada hasil (run pertama) atau gagal dimuat: kerangka muat diganti pesan.
    showOutlookMessage(message) {
      if (outlook.counts.getAttribute('aria-busy') === 'true') {
        outlook.counts.removeAttribute('aria-busy');
        outlook.counts.innerHTML = '';
      }
      if (outlook.list.getAttribute('aria-busy') === 'true') {
        outlook.list.removeAttribute('aria-busy');
        outlook.list.innerHTML = `<li class="empty-note">${escapeHtml(message)}</li>`;
      }
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
