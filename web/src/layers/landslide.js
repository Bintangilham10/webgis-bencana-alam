import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDasarian, formatNumber } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { CEWS_LEVELS, IMERG_RAMP, LANDSLIDE_AGES, landslideAgeColor, pillStyle } from '../lib/symbology.js';
import { cssVar } from '../lib/theme.js';

// Lapisan grup "Hujan dan longsor": peringatan dini curah hujan tinggi BMKG
// (CEWS), hujan satelit NASA IMERG, dan riwayat kejadian gerakan tanah PVMBG.

const CEWS_PAGE = 'https://cews.bmkg.go.id/';
const RELOAD_AFTER_MS = 30 * 60_000;

const longDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
const monthYear = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
const shortDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
const clock = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

// Teks yang baru diketahui setelah data dimuat (periode CEWS, jam IMERG)
// diperbarui langsung di legenda yang sedang tampil.
function fillLegend(key, text) {
  for (const el of document.querySelectorAll(`[data-legend-live="${key}"]`)) el.textContent = text;
}
const legendText = {
  cews: 'Dasarian berjalan',
  imerg: 'Data terbaru NASA',
  history: 'Kejadian PVMBG dan MAGMA; yang terbaru digambar paling atas.',
};

// ---------- Peringatan dini curah hujan tinggi BMKG ----------

function warningPopup(p, period) {
  const style = CEWS_LEVELS[p.level];
  return `
    <div class="popup">
      <div class="popup-heading">
        <h3>${escapeHtml(p.nama)}</h3>
        <span class="level-pill" style="${pillStyle(style)}">${escapeHtml(style.label)}</span>
      </div>
      <p class="popup-sub">Peringatan dini curah hujan tinggi · ${escapeHtml(period)}</p>
      <a class="popup-link" href="${CEWS_PAGE}" target="_blank" rel="noopener">Peta dan keterangan resmi BMKG${icons.external}</a>
      <p class="popup-source">Sumber: BMKG (CEWS)</p>
    </div>`;
}

export function createRainWarningLayer({ onLoad, onError } = {}) {
  let period = '';
  const layer = L.geoJSON(null, {
    pane: 'warnings',
    style: (f) => {
      const { color } = CEWS_LEVELS[f.properties.level];
      return { color, weight: 1.6, opacity: 0.95, fillColor: color, fillOpacity: 0.42 };
    },
    onEachFeature: (f, feature) => {
      feature.bindPopup(() => warningPopup(f.properties, period), { maxWidth: 280 });
      feature.on('mouseover', () => feature.setStyle({ fillOpacity: 0.6 }));
      feature.on('mouseout', () => feature.setStyle({ fillOpacity: 0.42 }));
    },
  });
  let loadedAt = 0;
  layer.on('add', async () => {
    if (Date.now() - loadedAt < RELOAD_AFTER_MS) return;
    loadedAt = Date.now();
    try {
      const data = await getJson('/api/rain-warnings');
      period = formatDasarian(data.dasarian);
      legendText.cews = data.published ? period : `${period}, belum terbit`;
      fillLegend('cews', legendText.cews);
      layer.clearLayers().addData(data);
      onLoad?.(data);
    } catch (err) {
      loadedAt = 0;
      onError?.(err);
    }
  });
  return layer;
}

export const rainWarningLegend = () => `
  <p class="legend-note" data-legend-live="cews">${escapeHtml(legendText.cews)}</p>
  ${CEWS_LEVELS.slice(1)
    .map((c) => `<div class="legend-row"><span class="swatch" style="background:${c.color}"></span>${c.label}</div>`)
    .join('')}
  <p class="legend-note">Kab/kota berstatus Aman tidak diwarnai. Klik wilayah untuk rinciannya.</p>`;

// ---------- Hujan satelit NASA IMERG ----------

export function createImergLayer({ onError } = {}) {
  const group = L.layerGroup();
  const options = { pane: 'warnings', opacity: 0.75, maxNativeZoom: 6, maxZoom: 19, attribution: 'Hujan satelit: NASA GPM IMERG via GIBS' };
  let tiles = null;
  let loadedAt = 0;
  group.on('add', async () => {
    if (tiles && Date.now() - loadedAt < RELOAD_AFTER_MS) return;
    loadedAt = Date.now();
    let url;
    try {
      const now = await getJson('/api/rain-now');
      url = now.tile_url;
      const time = new Date(now.time);
      legendText.imerg = `Pengamatan ${shortDate.format(time)}, ${clock.format(time).replace(':', '.')} WIB`;
    } catch (err) {
      // Waktu terbaru tidak diketahui: GIBS tetap bisa memberi data terbarunya.
      url = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png';
      legendText.imerg = 'Data terbaru NASA';
      loadedAt = 0;
      onError?.(err);
    }
    fillLegend('imerg', legendText.imerg);
    if (tiles) tiles.setUrl(url);
    else group.addLayer((tiles = L.tileLayer(url, options)));
  });
  return group;
}

export const imergLegend = () => `
  <p class="legend-note" data-legend-live="imerg">${escapeHtml(legendText.imerg)}</p>
  <div class="legend-ramp" aria-hidden="true">${IMERG_RAMP.map((c) => `<span style="background:${c.color}"></span>`).join('')}</div>
  <div class="legend-ramp-labels"><span>${IMERG_RAMP[0].mm}</span><span>${IMERG_RAMP[3].mm}</span><span>${IMERG_RAMP.at(-1).mm}+ mm/jam</span></div>
  <p class="legend-note">Rata-rata 30 menit dari satelit, terlambat ±4–6 jam (waktu data tertulis di atas). Hujan lokal yang singkat bisa terlewat.</p>`;

// ---------- Riwayat longsor ----------

// Segitiga di canvas: 1.884 titik terlalu banyak untuk penanda DOM. Deteksi klik
// memakai lingkaran seukuran segitiga dari CircleMarker.
L.Canvas.include({
  _updateTriangle(layer) {
    if (!this._drawing || layer._empty()) return;
    const { x, y } = layer._point;
    const r = Math.max(Math.round(layer._radius), 1);
    const ctx = this._ctx;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.95, y + r * 0.7);
    ctx.lineTo(x - r * 0.95, y + r * 0.7);
    ctx.closePath();
    this._fillStroke(ctx, layer);
  },
});

const TriangleMarker = L.CircleMarker.extend({
  _updatePath() {
    this._renderer._updateTriangle(this);
  },
});

const SOURCE_LABELS = {
  'pvmbg-lapangan': 'Laporan pemeriksaan lapangan PVMBG',
  'magma-tanggapan': 'Tanggapan gerakan tanah MAGMA',
  'magma-tanggapan+pvmbg-lapangan': 'Tanggapan MAGMA dan laporan lapangan PVMBG',
};

// Nama tempat dari laporan lapangan kadang terpotong (mis. "B"); yang terlalu
// pendek tidak ditampilkan.
const placeName = (text) => (text && text.trim().length >= 3 ? text.trim() : null);

function historyPopup(p) {
  const date = new Date(`${p.tanggal}T12:00:00+07:00`);
  let when = longDate.format(date);
  if (p.presisi_tanggal === 'tahun') when = `${date.getFullYear()} (tanggal pasti tidak dicatat)`;
  else if (p.presisi_tanggal === 'bulan') when = `${monthYear.format(date)} (tanggal pasti mungkin tidak dicatat)`;
  else if (p.jam_diketahui) when += `, ${clock.format(new Date(p.occurred_at)).replace(':', '.')} WIB`;
  const desa = placeName(p.desa);
  const kecamatan = placeName(p.kecamatan);
  const where = [desa && `Desa ${desa}`, kecamatan && `Kec. ${kecamatan}`].filter(Boolean).map(escapeHtml).join(', ');
  const region = [p.kab_nama, p.provinsi].filter(Boolean).map(escapeHtml).join(', ');
  return `
    <div class="popup">
      <h3>Gerakan tanah · ${escapeHtml(when)}</h3>
      ${region ? `<p class="popup-sub">${region}</p>` : ''}
      <dl class="popup-facts">
        ${where ? `<dt>Lokasi</dt><dd>${where}</dd>` : ''}
        <dt>Tipe</dt><dd>${p.tipe ? escapeHtml(p.tipe) : '<span class="muted">Tidak dicatat</span>'}</dd>
        <dt>Sumber</dt><dd>${escapeHtml(SOURCE_LABELS[p.sumber] ?? p.sumber)}</dd>
      </dl>
      <p class="popup-source">Sumber: PVMBG, Badan Geologi (Portal MBG dan MAGMA Indonesia)</p>
    </div>`;
}

export function createLandslideHistoryLayer({ onLoad, onError } = {}) {
  // Di overlay bawaan: di atas batas wilayah, di bawah label peta dan titik gempa.
  const renderer = L.canvas({ padding: 0.2 });
  const layer = L.featureGroup();
  const outline = () => cssVar('--point-outline', layer._map?.getContainer());
  const restyle = () => layer.eachLayer((marker) => marker.setStyle({ color: outline() }));
  let loading = null;
  layer.on('add', () => {
    layer._map.on('basemapchange', restyle);
    loading ??= getJson('/api/landslides')
      .then((data) => {
        // Urutan server = tanggal naik, jadi kejadian terbaru digambar paling atas.
        for (const { geometry, properties: p } of data.features) {
          const [lon, lat] = geometry.coordinates;
          new TriangleMarker([lat, lon], {
            renderer,
            radius: 6,
            weight: 1,
            color: outline(),
            opacity: 0.9,
            fillColor: landslideAgeColor(Number(p.tanggal.slice(0, 4))),
            fillOpacity: 1,
          })
            .bindPopup(() => historyPopup(p), { maxWidth: 300 })
            .addTo(layer);
        }
        const first = data.features[0]?.properties.tanggal.slice(0, 4);
        legendText.history = `${formatNumber(data.features.length)} kejadian PVMBG dan MAGMA sejak ${first}; yang terbaru digambar paling atas.`;
        fillLegend('history', legendText.history);
        onLoad?.(data);
      })
      .catch((err) => {
        loading = null;
        onError?.(err);
      });
  });
  layer.on('remove', () => layer._map?.off('basemapchange', restyle));
  return layer;
}

const triangle = (color) =>
  `<svg class="swatch-triangle" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 14 13H2Z" fill="${color}" stroke="var(--point-outline)" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

export const landslideSymbol = () => triangle(LANDSLIDE_AGES[1].color);

export const landslideLegend = () => `
  ${LANDSLIDE_AGES.map((age) => `<div class="legend-row">${triangle(age.color)}${age.label}</div>`).join('')}
  <p class="legend-note" data-legend-live="history">${escapeHtml(legendText.history)}</p>`;
