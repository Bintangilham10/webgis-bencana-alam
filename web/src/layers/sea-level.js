import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatClock, formatDecimal, timeAgo } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { makeFocusable } from '../lib/marker-focus.js';
import { TIDE_GAUGE } from '../lib/symbology.js';

// Muka laut dari alat pasang surut di pelabuhan Indonesia (data tiap menit lewat
// IOC–UNESCO). Peta hanya memuat daftar stasiun; deret 12 jam satu stasiun baru
// diambil saat popupnya dibuka. Popup menampilkan dua grafik bersumbu waktu
// sama: muka laut (pasang surut) dan sisanya setelah pasang surut dipisahkan,
// yaitu gelombang pelabuhan, pengaruh cuaca, atau tsunami bila ada.

const FOCUS_ZOOM = 9;
const REFRESH_MS = 10 * 60_000;
// Simpangan di luar pasang surut (cm): di bawah 10 biasa (99% data normal enam
// stasiun, 8–11 Nov 2026), 25 ke atas tidak pernah muncul pada data normal itu.
const SMALL_CM = 10;
const LARGE_CM = 25;

const gaugeStyle = (station) => (station.active ? TIDE_GAUGE.active : TIDE_GAUGE.stale);
// Server memeriksa 90 menit terakhir tiap alat; tanpa sampel di situ waktunya tidak diketahui.
const dataAge = (station) => (station.last_at ? `data ${timeAgo(station.last_at)}` : 'tidak ada data 90 menit terakhir');
const signed = (cm) => `${cm > 0 ? '+' : ''}${formatDecimal(cm, 0)} cm`;

function gaugeIcon(station) {
  const state = station.active ? 'mengirim data' : 'data tertunda';
  return L.divIcon({
    className: 'tide-icon',
    html: `<span class="facility-pin tide-pin" style="--c:${gaugeStyle(station).color}" role="img" aria-label="Alat pasang surut ${escapeHtml(station.nama)}, ${state}">${icons.tide}</span>`,
    iconSize: [26, 26],
    tooltipAnchor: [0, -13],
    popupAnchor: [0, -13],
  });
}

// ---------- Grafik ----------

// Ukuran dalam satuan viewBox; SVG-nya mengisi lebar popup.
const CHART = { width: 288, left: 30, right: 8, levelTop: 16, levelHeight: 78, residualTop: 120, residualHeight: 40, axisGap: 16, bottomPad: 8 };
const plotWidth = CHART.width - CHART.left - CHART.right;
// Deret terputus bila jeda antar-sampel lebih dari ini (alat sempat tidak mengirim).
const GAP_MINUTES = 6;

// Batas sumbu yang bulat: kelipatan 10, 25, 50, atau 100 cm.
function niceLimit(maxAbs, floor) {
  const target = Math.max(maxAbs, floor);
  return [10, 15, 25, 50, 75, 100, 150, 200, 300, 500].find((step) => step >= target) ?? Math.ceil(target / 100) * 100;
}

// Garis deret sebagai path SVG; jeda data memulai potongan baru.
function linePath(minutes, values, x, y) {
  let path = '';
  values.forEach((value, index) => {
    const gap = index === 0 || minutes[index] - minutes[index - 1] > GAP_MINUTES;
    path += `${gap ? 'M' : 'L'}${x(minutes[index]).toFixed(1)} ${y(value).toFixed(1)}`;
  });
  return path;
}

// Satu bidang grafik: garis kisi di batas atas, nol, dan batas bawah beserta
// labelnya, lalu garis deret dan titik ujungnya.
function plot({ title, minutes, values, top, height, limit, x }) {
  const y = (value) => top + height / 2 - (value / limit) * (height / 2);
  const grid = [limit, 0, -limit]
    .map((tick) => {
      const line = `<line class="sea-chart__grid${tick === 0 ? ' sea-chart__grid--zero' : ''}" x1="${CHART.left}" x2="${CHART.width - CHART.right}" y1="${y(tick)}" y2="${y(tick)}" />`;
      return `${line}<text class="sea-chart__tick" x="${CHART.left - 5}" y="${y(tick) + 3.5}" text-anchor="end">${tick > 0 ? '+' : ''}${tick}</text>`;
    })
    .join('');
  const last = values.length - 1;
  return {
    y,
    svg: `<text class="sea-chart__title" x="${CHART.left}" y="${top - 6}">${title}</text>${grid}
      <path class="sea-chart__line" d="${linePath(minutes, values, x, y)}" />
      <circle class="sea-chart__end" cx="${x(minutes[last]).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="4" />`,
  };
}

// Label jam (WIB) tiap 3 jam di bawah grafik, pada ketinggian `y`.
function timeAxis(series, x, y) {
  const start = Date.parse(series.from);
  const span = series.minutes.at(-1);
  const ticks = [];
  const firstHour = Math.ceil(start / 3_600_000) * 3_600_000;
  for (let ms = firstHour; ms <= start + span * 60_000; ms += 3_600_000) {
    const hourWib = (new Date(ms).getUTCHours() + 7) % 24;
    if (hourWib % 3 !== 0) continue;
    const minute = (ms - start) / 60_000;
    ticks.push(`<text class="sea-chart__tick" x="${x(minute).toFixed(1)}" y="${y}" text-anchor="middle">${String(hourWib).padStart(2, '0')}.00</text>`);
  }
  return ticks.join('');
}

const readoutText = (series, index) => {
  const at = new Date(Date.parse(series.from) + series.minutes[index] * 60_000).toISOString();
  const residual = series.residual_cm ? ` · di luar pasang surut ${signed(series.residual_cm[index])}` : '';
  return `${formatClock(at)} · muka laut ${signed(series.level_cm[index])}${residual}`;
};

// Dua grafik bersumbu waktu sama. Tanpa residu (data kurang dari 70%) hanya grafik pertama.
function chart(series) {
  const span = Math.max(series.minutes.at(-1), 1);
  const x = (minute) => CHART.left + (minute / span) * plotWidth;
  const level = plot({
    title: 'Muka laut, cm dari rata-rata 12 jam',
    minutes: series.minutes,
    values: series.level_cm,
    top: CHART.levelTop,
    height: CHART.levelHeight,
    limit: niceLimit(Math.max(...series.level_cm.map(Math.abs)), 25),
    x,
  });
  const residual = series.residual_cm
    ? plot({
        title: 'Di luar pasang surut, cm',
        minutes: series.minutes,
        values: series.residual_cm,
        top: CHART.residualTop,
        height: CHART.residualHeight,
        limit: niceLimit(Math.max(...series.residual_cm.map(Math.abs)), 10),
        x,
      })
    : null;
  const bottom = residual ? CHART.residualTop + CHART.residualHeight : CHART.levelTop + CHART.levelHeight;
  const height = bottom + CHART.axisGap + CHART.bottomPad;
  const axis = timeAxis(series, x, bottom + CHART.axisGap);
  return `
    <figure class="sea-chart">
      <svg viewBox="0 0 ${CHART.width} ${height}" role="img" tabindex="0" aria-label="Grafik muka laut 12 jam terakhir. Gerakkan penunjuk atau tekan panah kiri dan kanan untuk membaca nilainya.">
        ${level.svg}${residual?.svg ?? ''}${axis}
        <line class="sea-chart__cursor" x1="0" x2="0" y1="${CHART.levelTop}" y2="${bottom}" hidden />
        <rect class="sea-chart__hit" x="${CHART.left}" y="${CHART.levelTop}" width="${plotWidth}" height="${bottom - CHART.levelTop}" />
      </svg>
      <figcaption class="sea-chart__readout" aria-live="polite">${escapeHtml(readoutText(series, series.minutes.length - 1))}</figcaption>
    </figure>`;
}

// Tabel per jam: padanan grafik yang bisa dibaca tanpa penunjuk.
function hourlyTable(series) {
  const start = Date.parse(series.from);
  const rows = [];
  let nextHour = Math.ceil(start / 3_600_000) * 3_600_000;
  series.minutes.forEach((minute, index) => {
    const ms = start + minute * 60_000;
    if (ms < nextHour) return;
    nextHour = Math.floor(ms / 3_600_000) * 3_600_000 + 3_600_000;
    const residual = series.residual_cm ? `<td>${signed(series.residual_cm[index])}</td>` : '';
    rows.push(`<tr><td>${formatClock(new Date(ms).toISOString())}</td><td>${signed(series.level_cm[index])}</td>${residual}</tr>`);
  });
  const residualHead = series.residual_cm ? '<th>Di luar pasang surut</th>' : '';
  return `<details class="popup-details"><summary>Angka per jam</summary>
    <table class="sea-table"><thead><tr><th>Jam</th><th>Muka laut</th>${residualHead}</tr></thead><tbody>${rows.join('')}</tbody></table></details>`;
}

function assessment(peak) {
  if (peak === null) return 'Data alat ini belum cukup (kurang dari 70% dalam 15 jam) untuk memisahkan pasang surutnya.';
  if (peak < SMALL_CM) return 'Muka laut mengikuti pasang surut biasa.';
  if (peak < LARGE_CM) return 'Ada osilasi kecil di luar pasang surut; umumnya gelombang pelabuhan atau pengaruh cuaca.';
  return 'Ada osilasi besar di luar pasang surut. Periksa informasi resmi BMKG.';
}

// Isi popup setelah deret dimuat.
function seriesBody(series) {
  if (!series.latest) return '<p class="sea-note">Alat ini tidak mengirim data muka laut dalam 15 jam terakhir.</p>';
  const { latest } = series;
  const residual =
    latest.residual_cm === null
      ? ''
      : `<dt>Di luar pasang surut</dt><dd><strong>${signed(latest.residual_cm)}</strong> <span class="muted">paling besar ${formatDecimal(latest.residual_peak_cm, 0)} cm dalam 2 jam terakhir</span></dd>`;
  return `
    <dl class="popup-facts">
      <dt>Muka laut</dt><dd><strong>${signed(latest.level_cm)}</strong> <span class="muted">dari rata-rata 12 jam · ${formatClock(latest.at)}</span></dd>
      ${residual}
      <dt>Sensor</dt><dd>${escapeHtml(series.sensor_kind)} <span class="muted">${series.points} sampel</span></dd>
    </dl>
    <p class="sea-note">${assessment(latest.residual_peak_cm)}</p>
    ${chart(series)}
    ${hourlyTable(series)}`;
}

// `body` = isi di bawah kepala popup: catatan "memuat", pesan gagal, atau hasil
// seriesBody() setelah deretnya dimuat.
export function seaLevelPopup(station, body = '<p class="sea-note">Memuat data 12 jam terakhir…</p>') {
  return `
    <div class="popup sea-popup">
      <div class="popup-head">
        <span class="facility-pin facility-pin--lg" style="--c:${gaugeStyle(station).color}">${icons.tide}</span>
        <div class="popup-heading">
          <h3>Muka laut ${escapeHtml(station.nama)}</h3>
          <p class="popup-sub">Alat pasang surut · ${dataAge(station)}</p>
        </div>
      </div>
      <div class="sea-body">${body}</div>
      <a class="popup-link" href="${escapeHtml(station.url)}" target="_blank" rel="noopener">Stasiun ini di IOC–UNESCO${icons.external}</a>
      <p class="popup-source">Alat pasang surut di Indonesia; data lewat IOC–UNESCO (VLIZ, Belgia). Bukan peringatan tsunami: peringatan resmi hanya dari BMKG.</p>
    </div>`;
}

// Garis penunjuk mengikuti penunjuk tetikus/sentuhan atau tombol panah, dan baris
// bacaan di bawah grafik menampilkan nilai kedua deret pada waktu itu.
function wireChart(root, series) {
  const svg = root.querySelector('.sea-chart svg');
  const readout = root.querySelector('.sea-chart__readout');
  const cursor = svg?.querySelector('.sea-chart__cursor');
  if (!svg || !readout || !cursor) return;
  const span = Math.max(series.minutes.at(-1), 1);
  let current = series.minutes.length - 1;

  function show(index) {
    current = Math.max(0, Math.min(series.minutes.length - 1, index));
    const x = CHART.left + (series.minutes[current] / span) * plotWidth;
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
    cursor.removeAttribute('hidden');
    readout.textContent = readoutText(series, current);
  }
  // Sampel terdekat dengan posisi penunjuk.
  function indexAt(clientX) {
    const box = svg.getBoundingClientRect();
    const minute = ((((clientX - box.left) / box.width) * CHART.width - CHART.left) / plotWidth) * span;
    let best = 0;
    series.minutes.forEach((value, index) => {
      if (Math.abs(value - minute) < Math.abs(series.minutes[best] - minute)) best = index;
    });
    return best;
  }
  svg.addEventListener('pointermove', (event) => show(indexAt(event.clientX)));
  svg.addEventListener('pointerdown', (event) => show(indexAt(event.clientX)));
  svg.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -5, ArrowRight: 5, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    show(current + step);
  });
}

// Deret diambil saat popup dibuka, lalu isi popup diganti seluruhnya (Leaflet
// menggambar ulang popup dari isi yang tersimpan, jadi isinya tidak boleh hanya
// ditempel ke elemen yang ada). Popup yang ditutup sebelum jawabannya tiba dibiarkan.
async function fillPopup(popup, station) {
  let body;
  let series = null;
  try {
    series = await getJson(`/api/sea-level/${encodeURIComponent(station.code)}`);
    body = seriesBody(series);
  } catch (err) {
    body = `<p class="sea-note">Data muka laut gagal dimuat: ${escapeHtml(err.message)}</p>`;
  }
  if (!popup.isOpen()) return;
  popup.setContent(seaLevelPopup(station, body));
  if (series?.latest) wireChart(popup.getElement(), series);
}

// Data dimuat saat lapisan dinyalakan dan diperbarui tiap 10 menit selama menyala.
export function createSeaLevelLayer(map, { viewPadding, onLoad, onError } = {}) {
  const group = L.featureGroup();
  let signature = '';
  let timer = null;

  function render(collection) {
    group.clearLayers();
    for (const { geometry, properties } of collection.features) {
      const [lon, lat] = geometry.coordinates;
      const state = properties.active ? dataAge(properties) : 'data tertunda';
      // Di atas penanda gunung api (paling tinggi +450) supaya tetap bisa diklik
      // di tampilan nasional, mis. Cilacap yang berimpit dengan Gunung Slamet.
      const marker = L.marker([lat, lon], { icon: gaugeIcon(properties), zIndexOffset: 1_000 }).bindTooltip(
        `Muka laut ${escapeHtml(properties.nama)} · ${state}`,
        { direction: 'top' },
      );
      makeFocusable(map, marker, { zoom: FOCUS_ZOOM, popup: () => seaLevelPopup(properties), viewPadding });
      marker.on('popupopen', (event) => fillPopup(event.popup, properties));
      group.addLayer(marker);
    }
  }

  async function load() {
    try {
      const collection = await getJson('/api/sea-level');
      const next = JSON.stringify(collection.features.map(({ properties: p }) => [p.code, p.active]));
      if (next !== signature) {
        signature = next;
        render(collection);
      }
      onLoad?.(collection);
    } catch (err) {
      onError?.(err);
    }
  }

  group.on('add', () => {
    load();
    timer ??= setInterval(load, REFRESH_MS);
  });
  group.on('remove', () => {
    clearInterval(timer);
    timer = null;
  });
  return { layer: group };
}

const legendPin = ({ label, color }) =>
  `<div class="legend-row"><span class="facility-pin tide-pin tide-pin--legend" style="--c:${color}">${icons.tide}</span>${label}</div>`;

export const seaLevelLegend = () => `
  ${legendPin(TIDE_GAUGE.active)}${legendPin(TIDE_GAUGE.stale)}
  <p class="legend-note">Alat pasang surut di pelabuhan, data tiap menit lewat IOC–UNESCO. Klik alat untuk grafik muka laut 12 jam terakhir dan simpangannya di luar pasang surut (gelombang pelabuhan, pengaruh cuaca, atau tsunami bila ada). Bukan peringatan tsunami; peringatan resmi hanya dari BMKG.</p>`;
