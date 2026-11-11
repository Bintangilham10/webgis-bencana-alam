import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { beachballUrl } from '../lib/beachball.js';
import { escapeHtml, formatDateTime, formatDecimal, timeAgo } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { makeFocusable } from '../lib/marker-focus.js';
import { DEPTH_CLASSES, depthClass, INK, magnitudeRadius, pillStyle } from '../lib/symbology.js';
import { bmkgMissingReason } from './usgs.js';

// Gempa dari katalog GFZ (GEOFON, Jerman). GFZ mengoperasikan jaringan seismograf
// GEOFON bersama BMKG (21 stasiun di Indonesia) dan menghitung sendiri magnitudo
// momen serta mekanisme sumber gempa (jenis sesar), yang tidak dimuat feed publik
// BMKG. Gempa yang sudah bermekanisme digambar sebagai bola fokus; yang belum
// sebagai belah ketupat. Warna = kelas kedalaman, seperti lapisan gempa lain.

const FOCUS_ZOOM = 10;
const REFRESH_MS = 3 * 60_000;
// Belah ketupat selalu di bawah cakram BMKG: klik di tengahnya tetap membuka
// gempa BMKG. Bola fokus sebaliknya di atas cakram BMKG gempa yang sama (hampir
// selalu berimpit), karena itulah yang ingin dilihat saat lapisan ini dinyalakan;
// popupnya tetap memuat magnitudo BMKG. Gempa BMKG paling baru (+20.000) tetap
// paling atas.
const BELOW_BMKG = -30_000;
const ABOVE_BMKG = 10_000;
const MIN_BALL_PX = 18;

const ballDiameter = (magnitude) => Math.max(MIN_BALL_PX, Math.round(2 * magnitudeRadius(magnitude)));
const diamondSide = (magnitude) => Math.max(10, Math.round(1.3 * magnitudeRadius(magnitude)));

// Penjelasan satu kalimat tiap jenis sesar.
const MECHANISM_NOTES = {
  naik: 'Satu blok batuan terdorong naik di atas blok lain; umum di zona tumbukan lempeng.',
  turun: 'Satu blok batuan turun terhadap blok lain; terjadi saat kerak meregang.',
  geser: 'Dua blok batuan bergeser mendatar satu terhadap yang lain.',
  oblik: 'Gabungan gerak naik atau turun dengan gerak mendatar.',
};

const ballImage = (mechanism, depthColor, size) =>
  `<img class="gfz-ball" src="${beachballUrl(mechanism.planes[0], { size, fill: depthColor, outline: INK })}" width="${size}" height="${size}" alt="" />`;

function gfzIcon(p, index) {
  const color = depthClass(p.depth_class).color;
  const label = `Gempa GFZ M ${formatDecimal(p.magnitude)}${p.mechanism ? `, ${p.mechanism.label.toLowerCase()}` : ''}`;
  if (p.mechanism) {
    const d = ballDiameter(p.magnitude);
    return L.divIcon({
      className: 'gfz-icon',
      html: `<span class="gfz-symbol gfz-symbol--ball" style="--i:${index}" role="img" aria-label="${escapeHtml(label)}">${ballImage(p.mechanism, color, d)}</span>`,
      iconSize: [d, d],
      tooltipAnchor: [0, -d / 2],
      popupAnchor: [0, -d / 2],
    });
  }
  const side = diamondSide(p.magnitude);
  // Belah ketupat = persegi diputar 45°, jadi kotak ikonnya selebar diagonalnya.
  const box = Math.round(side * Math.SQRT2);
  return L.divIcon({
    className: 'gfz-icon',
    html: `<span class="gfz-symbol" style="--i:${index}" role="img" aria-label="${escapeHtml(label)}"><i class="gfz-diamond" style="--c:${color};--s:${side}px"></i></span>`,
    iconSize: [box, box],
    tooltipAnchor: [0, -box / 2],
    popupAnchor: [0, -box / 2],
  });
}

function bmkgComparison(match, magnitude) {
  if (!match) return `Tidak ada di feed publik BMKG ${bmkgMissingReason(magnitude)}`;
  const seconds = formatDecimal(Math.abs(match.time_diff_s), 0);
  return `M ${formatDecimal(match.magnitude)} <span class="muted">· selisih ${seconds} detik, ${formatDecimal(match.distance_km, 0)} km</span>`;
}

// "4 menit setelah gempa": jeda antara kejadian dan terbitan pertama GFZ.
function publishedFact(p) {
  if (!p.published_at) return '';
  const minutes = Math.round((new Date(p.published_at) - new Date(p.occurred_at)) / 60_000);
  return minutes >= 0 && minutes < 24 * 60 ? `<dt>Terbit</dt><dd>${minutes} menit setelah gempa</dd>` : '';
}

const planeText = ({ strike, dip, rake }) => `jurus ${strike}°, kemiringan ${dip}°, rake ${rake}°`;

// Mekanisme sumber: bola fokus, jenis sesar, dan dua bidang nodal. Dipakai juga
// di popup gempa BMKG pasangannya (layers/earthquakes.js).
export function mechanismSection(mechanism, depthColor) {
  if (!mechanism) return '';
  const status = mechanism.reviewed ? 'sudah ditinjau seismolog GFZ' : 'hasil otomatis GFZ';
  return `
      <div class="popup-mechanism">
        ${ballImage(mechanism, depthColor, 52)}
        <div>
          <p class="popup-mechanism__type">${escapeHtml(mechanism.label)}</p>
          <p class="popup-mechanism__note">${MECHANISM_NOTES[mechanism.type] ?? ''}</p>
          <p class="popup-mechanism__planes">Bidang 1: ${planeText(mechanism.planes[0])}<br />Bidang 2: ${planeText(mechanism.planes[1])}</p>
        </div>
      </div>
      <p class="popup-mechanism__caption">Mekanisme sumber, ${status}. Bagian berwarna pada bola fokus = tanah terdorong menjauhi sumber gempa; salah satu dari dua bidang adalah bidang patahannya.</p>`;
}

export function gfzPopup(p) {
  const depth = depthClass(p.depth_class);
  const magnitude = formatDecimal(p.magnitude);
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="mag-badge mag-badge--lg" style="${pillStyle(depth)}">${magnitude}</span>
        <div class="popup-heading">
          <h3>Gempa M ${magnitude}${p.mag_type ? ` <span class="muted">${escapeHtml(p.mag_type)}</span>` : ''}</h3>
          <p class="popup-sub">${timeAgo(p.occurred_at)} · katalog GFZ</p>
        </div>
      </div>
      <p class="popup-place">${escapeHtml(p.wilayah ?? '')}</p>
      <dl class="popup-facts">
        <dt>Waktu</dt><dd>${formatDateTime(p.occurred_at)}</dd>
        <dt>Kedalaman</dt><dd>${formatDecimal(p.depth_km)} km (${escapeHtml(p.depth_class)})</dd>
        <dt>BMKG</dt><dd>${bmkgComparison(p.bmkg, p.magnitude)}</dd>
        <dt>Status</dt><dd>${p.status === 'manual' ? 'Lokasi sudah ditinjau seismolog GFZ' : 'Otomatis, masih bisa berubah'}</dd>
        ${publishedFact(p)}
      </dl>
      ${mechanismSection(p.mechanism, depth.color)}
      ${p.url ? `<a class="popup-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Halaman gempa di GFZ${icons.external}</a>` : ''}
      <p class="popup-source">Sumber: GFZ GEOFON (Jerman), dari jaringan seismograf dunia termasuk 21 stasiun GEOFON–BMKG di Indonesia · pembanding, bukan peringatan resmi</p>
    </div>`;
}

// Data dimuat saat lapisan dinyalakan dan diperbarui tiap 3 menit selama menyala.
export function createGfzLayer(map, { viewPadding, onLoad, onError } = {}) {
  const group = L.featureGroup();
  const markers = new Map();
  const openers = new Map();
  let signature = '';
  let timer = null;

  function render(collection) {
    // Popup yang sedang dibaca dibuka lagi setelah data diperbarui.
    const openId = [...markers].find(([, marker]) => marker.isPopupOpen())?.[0];
    markers.clear();
    openers.clear();
    group.clearLayers();
    // Gempa besar lebih dulu dan di bawah, supaya simbol kecil di atasnya tetap bisa diklik.
    const byMagnitude = [...collection.features].sort((a, b) => b.properties.magnitude - a.properties.magnitude);
    byMagnitude.forEach(({ geometry, properties: p }, index) => {
      const [lon, lat] = geometry.coordinates;
      const kind = p.mechanism ? ` · ${p.mechanism.label}` : '';
      const marker = L.marker([lat, lon], {
        pane: 'quakes',
        icon: gfzIcon(p, index),
        zIndexOffset: Math.round((10 - p.magnitude) * 1000) + (p.mechanism ? ABOVE_BMKG : BELOW_BMKG),
      }).bindTooltip(`GFZ M ${formatDecimal(p.magnitude)}${escapeHtml(kind)} · ${timeAgo(p.occurred_at)}`, { direction: 'top' });
      openers.set(p.id, makeFocusable(map, marker, { zoom: FOCUS_ZOOM, popup: () => gfzPopup(p), viewPadding }));
      markers.set(p.id, marker);
      group.addLayer(marker);
    });
    openers.get(openId)?.({ fly: false });
  }

  async function load() {
    try {
      const collection = await getJson('/api/earthquakes?days=7&source=gfz');
      // Mekanisme sumber dan tinjauan seismolog menyusul beberapa jam setelah gempa.
      const next = JSON.stringify(
        collection.features.map(({ properties: p }) => [p.id, p.magnitude, p.depth_km, p.status, p.bmkg?.id, p.mechanism?.updated_at]),
      );
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

// Contoh bola fokus tiap jenis sesar untuk legenda (bidang nodal khas).
const LEGEND_BALLS = [
  { label: 'Sesar naik', plane: { strike: 300, dip: 30, rake: 90 } },
  { label: 'Sesar turun', plane: { strike: 300, dip: 45, rake: -90 } },
  { label: 'Sesar geser', plane: { strike: 320, dip: 88, rake: 2 } },
];

export function gfzLegend() {
  const balls = LEGEND_BALLS.map(
    ({ label, plane }) =>
      `<span class="legend-size"><img src="${beachballUrl(plane, { size: 24, fill: DEPTH_CLASSES[0].color, outline: INK })}" width="24" height="24" alt="" />${label}</span>`,
  ).join('');
  const depths = DEPTH_CLASSES.map(
    (c) => `<div class="legend-row"><span class="gfz-swatch"><i class="gfz-diamond" style="--c:${c.color};--s:9px"></i></span>${c.label}</div>`,
  ).join('');
  return `<div class="legend-sizes">${balls}</div>${depths}
    <p class="legend-note">Bola fokus: gempa yang mekanisme sumbernya sudah dihitung GFZ (±Mw 5 ke atas, beberapa jam setelah gempa); bagian berwarna = tanah terdorong menjauhi sumber. Belah ketupat: gempa lain di katalog GFZ (mulai ±M4,3). Ukuran mengikuti magnitudo. Tidak ikut dihitung di Ikhtisar dan cek risiko.</p>`;
}

// ---------- Stasiun seismograf jaringan internasional ----------

// Segitiga terbalik = simbol baku stasiun seismik di peta. Putih bergaris tepi
// gelap supaya terbaca di peta dasar terang maupun gelap.
export const SEISMO_SYMBOL =
  '<svg class="seismo-symbol" viewBox="0 0 14 12" width="14" height="12" aria-hidden="true"><path d="M1.2 1.2h11.6L7 10.8z" fill="#fff" stroke="var(--glyph-outline)" stroke-width="1.6" stroke-linejoin="round"/></svg>';

function stationPopup(p) {
  const data = p.data_terbuka
    ? 'Rekaman getarannya terbuka untuk umum lewat EarthScope (Amerika Serikat).'
    : 'Rekaman getarannya dipakai GFZ dan BMKG untuk menentukan lokasi gempa dan peringatan tsunami; data mentahnya tidak dibuka untuk umum.';
  return `
    <div class="popup">
      <h3>Seismograf ${escapeHtml(p.nama)}</h3>
      <dl class="popup-facts">
        <dt>Kode</dt><dd>${escapeHtml(p.kode)}</dd>
        <dt>Jaringan</dt><dd>${escapeHtml(p.jaringan)}</dd>
        <dt>Pengelola</dt><dd>${escapeHtml(p.pengelola)}</dd>
        <dt>Beroperasi</dt><dd>Sejak ${p.sejak}</dd>
        <dt>Ketinggian</dt><dd>${formatDecimal(p.elevasi_m, 0)} m</dd>
      </dl>
      <p class="popup-source">${data}</p>
    </div>`;
}

// Daftar stasiun berupa file statis (server/scripts/build-stasiun-seismik.js),
// diunduh saat lapisan pertama kali dinyalakan.
export function createSeismicStationLayer({ onError } = {}) {
  const layer = L.geoJSON(null, {
    pointToLayer: (feature, latlng) =>
      L.marker(latlng, {
        pane: 'quakes',
        zIndexOffset: BELOW_BMKG - 20_000,
        icon: L.divIcon({
          className: 'seismo-icon',
          html: `<span class="seismo-marker" role="img" aria-label="Stasiun seismograf">${SEISMO_SYMBOL}</span>`,
          iconSize: [14, 12],
          tooltipAnchor: [0, -6],
          popupAnchor: [0, -6],
        }),
      }),
    onEachFeature({ properties: p }, marker) {
      marker.bindTooltip(`${escapeHtml(p.nama)} · ${escapeHtml(p.kode)}`, { direction: 'top' });
      marker.bindPopup(() => stationPopup(p), { maxWidth: 300 });
    },
  });
  let loading = null;
  layer.on('add', () => {
    loading ??= getJson('/data/stasiun-seismik.geojson')
      .then((data) => layer.addData(data))
      .catch((err) => {
        loading = null;
        onError?.(err);
      });
  });
  return layer;
}

export const seismicStationLegend = () => `
  <div class="legend-row">${SEISMO_SYMBOL}Stasiun seismograf</div>
  <p class="legend-note">21 stasiun jaringan GEOFON (GFZ Jerman bersama BMKG) dan 1 stasiun Global Seismographic Network (Amerika Serikat). Alat inilah yang merekam getaran untuk katalog gempa GFZ.</p>`;
