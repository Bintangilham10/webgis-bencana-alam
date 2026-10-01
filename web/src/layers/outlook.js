import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { capitalize, escapeHtml, formatDay, outlookPeriod } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { CEWS_LEVELS, NO_DATA_STYLE, pillStyle, WARNING_LEVEL_STYLES } from '../lib/symbology.js';

// Indikasi SIGAP 3 hari per kab/kota (hujan lebat, banjir, tanah longsor) dari
// prakiraan hujan Open-Meteo × zona bahaya InaRISK, dihitung server tiap 12 jam.
// Satu lapisan GeoJSON dipakai bersama oleh empat tampilan yang dipilih di panel
// Lapisan: level tertinggi, atau salah satu bahaya.

export const OUTLOOK_VIEWS = [
  { id: 'tertinggi', label: 'Tertinggi', note: 'Level tertinggi dari hujan lebat, banjir, dan tanah longsor.' },
  { id: 'hujan', label: 'Hujan lebat', note: 'Hujan harian tertinggi (kategori BMKG): lebat Waspada, sangat lebat Siaga, ekstrem Awas.' },
  { id: 'banjir', label: 'Banjir', note: 'Hujan tertinggi × kelas zona bahaya banjir InaRISK di titik pantau.' },
  { id: 'longsor', label: 'Tanah longsor', note: 'Hujan tertinggi × kelas zona bahaya longsor InaRISK; akumulasi 3 hari ≥ 100 mm dihitung setara hujan lebat.' },
];
export const HAZARD_NAMES = { hujan: 'Hujan lebat', banjir: 'Banjir', longsor: 'Tanah longsor' };
// Titik yang dibuka "cek risiko": bahaya berzona lebih informatif daripada titik hujan.
const CHECK_ORDER = ['longsor', 'banjir', 'hujan'];

const clock = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
const wib = (iso) => clock.format(new Date(iso)).replace(':', '.');
const levelStyle = (level) => (level == null ? NO_DATA_STYLE : WARNING_LEVEL_STYLES[level]);

// Normal tetap diwarnai tipis supaya terlihat bahwa seluruh Indonesia dinilai;
// kab/kota tanpa data hujan hanya bergaris putus-putus.
function baseStyle(level) {
  if (level == null) return { color: NO_DATA_STYLE.color, weight: 0.8, opacity: 0.7, dashArray: '3 3', fillColor: NO_DATA_STYLE.color, fillOpacity: 0.06 };
  const { color } = WARNING_LEVEL_STYLES[level];
  if (level === 0) return { color, weight: 0.5, opacity: 0.35, dashArray: null, fillColor: color, fillOpacity: 0.1 };
  return { color, weight: 1.4, opacity: 0.95, dashArray: null, fillColor: color, fillOpacity: 0.45 };
}

// Batas kab/kota disederhanakan (±550 m), jadi di zoom dekat isinya dipudarkan
// supaya peta dasar dan garis pantai aslinya tetap terbaca.
const fillFade = (zoom) => (zoom >= 12 ? 0.3 : zoom >= 10 ? 0.6 : 1);

function polygonStyle(level, fade) {
  const style = baseStyle(level);
  return { ...style, fillOpacity: style.fillOpacity * fade };
}

const levelIn = (region, view) => (region ? (view === 'tertinggi' ? region.level : (region.hazards[view]?.level ?? null)) : null);

// Titik pantau terparah untuk tampilan ini (titik hujan bila bahaya itu tanpa zona).
function worstPoint(region, view) {
  const hazards = view === 'tertinggi' ? CHECK_ORDER : [view, 'hujan'];
  const level = levelIn(region, view);
  const hazard = hazards.find((h) => region.hazards[h]?.lat != null && (view !== 'tertinggi' || region.hazards[h].level === level)) ?? 'hujan';
  const { lat, lon } = region.hazards[hazard] ?? {};
  return lat == null ? null : { lat, lon, hazard };
}

// Teks legenda yang baru diketahui setelah data dimuat diperbarui di legenda yang tampil.
let legendText = 'Memuat indikasi…';
function fillLegend(text) {
  legendText = text;
  for (const el of document.querySelectorAll('[data-legend-live="outlook"]')) el.textContent = text;
}

const swatch = (level) => {
  if (level == null) return '<span class="swatch swatch--nodata"></span>';
  const { color } = WARNING_LEVEL_STYLES[level];
  return level === 0 ? `<span class="swatch swatch--faint" style="--c:${color}"></span>` : `<span class="swatch" style="background:${color}"></span>`;
};

export const outlookLegend = (viewId) => () => `
  <p class="legend-note" data-legend-live="outlook">${escapeHtml(legendText)}</p>
  ${[3, 2, 1, 0].map((level) => `<div class="legend-row">${swatch(level)}${WARNING_LEVEL_STYLES[level].label}</div>`).join('')}
  <div class="legend-row">${swatch(null)}${NO_DATA_STYLE.label}</div>
  <p class="legend-note">${escapeHtml(OUTLOOK_VIEWS.find((v) => v.id === viewId).note)}</p>
  <p class="legend-note">Indikasi sistem (aturan awal), belum dikalibrasi. Bukan peringatan resmi.</p>`;

function hazardRow(region, hazard, view) {
  const h = region.hazards[hazard];
  if (!h) return '';
  const style = levelStyle(h.level);
  const peak = h.level > 0 && h.peak_date ? ` · puncak ${escapeHtml(formatDay(h.peak_date))}` : '';
  return `
    <li class="outlook-hazard${view === hazard ? ' is-current' : ''}">
      <span class="outlook-hazard__name">${HAZARD_NAMES[hazard]}</span>
      <span class="level-pill" style="${pillStyle(style)}">${escapeHtml(h.label ?? style.label)}</span>
      <span class="outlook-hazard__reason">${escapeHtml(capitalize(h.reason))}${peak}</span>
    </li>`;
}

function popupHtml(region, { view, data, official }) {
  const { run } = data;
  const style = levelStyle(levelIn(region, view));
  const officialRow = official
    ? `<p class="outlook-official">Peringatan resmi BMKG (CEWS, ${escapeHtml(official.period)}):
         <strong>${escapeHtml(CEWS_LEVELS[official.level].label)}</strong></p>`
    : '';
  const point = worstPoint(region, view);
  return `
    <div class="popup outlook-popup">
      <div class="popup-heading">
        <h3>${escapeHtml(region.nama)}</h3>
        <span class="level-pill" style="${pillStyle(style)}">${escapeHtml(style.label)}</span>
      </div>
      <p class="popup-sub">${escapeHtml(region.provinsi)} · indikasi ${escapeHtml(outlookPeriod(data))}</p>
      <ul class="outlook-hazards">${['hujan', 'banjir', 'longsor'].map((hazard) => hazardRow(region, hazard, view)).join('')}</ul>
      ${officialRow}
      ${point ? `<button type="button" class="btn btn-secondary btn-block" data-action="outlook-check">${icons.pin}Cek risiko di titik pantau</button>` : ''}
      <p class="popup-source">
        Indikasi sistem ${escapeHtml(run.rules_version)}, belum dikalibrasi; bukan peringatan resmi. Dihitung ${escapeHtml(wib(run.finished_at))} WIB;
        cek risiko memakai prakiraan terbaru. Hujan: Open-Meteo · zona bahaya: InaRISK BNPB.
      </p>
    </div>`;
}

// officialRain(kode) → { level, period } | null: peringatan CEWS BMKG untuk dibandingkan.
// onCheckPoint({ lat, lon, hazard, region }) dipanggil dari tombol cek risiko di popup.
export function createOutlookLayer({ onError, onCheckPoint, officialRain = () => null }) {
  const renderer = L.canvas({ pane: 'warnings' });
  let data = null;
  let byKode = new Map();
  let view = 'tertinggi';
  let owner = null;

  const regionOf = (feature) => byKode.get(feature.feature.properties.kode);
  const fade = () => fillFade(shared._map?.getZoom() ?? 0);
  const styleOf = (f) => polygonStyle(levelIn(byKode.get(f.properties.kode), view), fade());

  const shared = L.geoJSON(null, {
    pane: 'warnings',
    renderer,
    style: styleOf,
    onEachFeature: (f, feature) => {
      feature.bindTooltip(
        () => {
          const region = regionOf(feature);
          return `${escapeHtml(f.properties.nama)} · ${escapeHtml(levelStyle(levelIn(region, view)).label)}`;
        },
        { sticky: true, className: 'boundary-tooltip' },
      );
      feature.bindPopup(
        () =>
          data && regionOf(feature)
            ? popupHtml(regionOf(feature), { view, data, official: officialRain(f.properties.kode) })
            : `<div class="popup"><h3>${escapeHtml(f.properties.nama)}</h3><p class="popup-sub">Indikasi SIGAP untuk kab/kota ini belum tersedia.</p></div>`,
        { maxWidth: 320 },
      );
      feature.on('popupopen', ({ popup }) => {
        popup.getElement().querySelector('[data-action="outlook-check"]')?.addEventListener('click', () => {
          const region = regionOf(feature);
          const point = worstPoint(region, view);
          feature.closePopup();
          onCheckPoint?.({ ...point, region });
        });
      });
      feature.on('mouseover', () => feature.setStyle({ weight: 2.2, fillOpacity: (levelIn(regionOf(feature), view) > 0 ? 0.6 : 0.2) * fade() }));
      feature.on('mouseout', () => shared.resetStyle(feature));
    },
  });

  // Kab/kota berlevel lebih tinggi digambar paling atas supaya garisnya tidak tertutup tetangga.
  let styledFade = null;
  function restyle() {
    styledFade = fade();
    shared.setStyle(styleOf);
    const raised = [];
    shared.eachLayer((feature) => {
      const level = levelIn(regionOf(feature), view);
      if (level > 0) raised.push([level, feature]);
    });
    raised.sort((a, b) => a[0] - b[0]).forEach(([, feature]) => feature.bringToFront());
  }

  const onZoom = () => fade() !== styledFade && restyle();
  let geometry = null;
  shared.on('remove', () => shared._map.off('zoomend', onZoom));
  shared.on('add', () => {
    shared._map.on('zoomend', onZoom);
    geometry ??= getJson('/api/wilayah?tingkat=kabkota')
      .then((collection) => {
        shared.addData(collection);
        restyle();
      })
      .catch((err) => {
        geometry = null;
        onError?.(err);
      });
  });

  // Tampilan untuk panel Lapisan. Tampilan yang terakhir dinyalakan "memiliki"
  // lapisan bersama, jadi mematikan tampilan lain tidak ikut menghapusnya.
  const View = L.Layer.extend({
    initialize(id) {
      this.viewId = id;
    },
    onAdd(map) {
      owner = this;
      view = this.viewId;
      map.closePopup();
      map.addLayer(shared);
      restyle();
    },
    onRemove(map) {
      if (owner !== this) return;
      owner = null;
      map.removeLayer(shared);
    },
  });
  const views = Object.fromEntries(OUTLOOK_VIEWS.map(({ id }) => [id, new View(id)]));

  return {
    views,
    get activeView() {
      return owner?.viewId ?? null;
    },
    // Data terbaru dari server; peta ikut diperbarui bila sedang tampil.
    async refresh() {
      data = await getJson('/api/outlook');
      byKode = new Map(data.regions.map((region) => [region.kode, region]));
      fillLegend(
        data.window?.expired
          ? `Indikasi terakhir (dihitung ${wib(data.run.finished_at)} WIB) sudah kedaluwarsa`
          : `Prakiraan ${outlookPeriod(data)}, dihitung ${wib(data.run.finished_at)} WIB`,
      );
      restyle();
      return data;
    },
    // Popup kab/kota (dipanggil setelah peta terbang ke wilayahnya).
    openPopup(kode) {
      shared.eachLayer((feature) => {
        if (feature.feature.properties.kode === kode) feature.openPopup();
      });
    },
    // Selesai saat batas kab/kota sudah tergambar (atau gagal dimuat).
    whenLoaded: () => geometry ?? Promise.resolve(),
  };
}
