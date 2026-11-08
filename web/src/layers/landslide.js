import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { cloudCss, cloudsOnly } from '../lib/clouds.js';
import { escapeHtml, formatDasarian, formatNumber } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { decodeRain, paintRain, RAIN_CLASSES, rainCss } from '../lib/rain.js';
import { CEWS_LEVELS, LANDSLIDE_AGES, landslideAgeColor, pillStyle } from '../lib/symbology.js';
import { cssVar } from '../lib/theme.js';

// Lapisan grup "Hujan dan longsor": peringatan dini curah hujan tinggi BMKG
// (CEWS), hujan satelit NASA IMERG, citra awan Himawari-9 (JMA), dan riwayat
// kejadian gerakan tanah PVMBG.

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
  clouds: 'Citra terbaru Himawari-9',
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

const TILE = 256;
// Petak IMERG di GIBS paling detail di zoom 6; sel datanya 0,1° (±11 km).
const SOURCE_Z = 6;
const CELL_DEG = 0.1;
const MAX_SOURCES = 200;

// Kanvas bantu untuk membaca piksel petak GIBS (GIBS mengizinkan CORS).
let scratch = null;
function readRain(image) {
  scratch ??= Object.assign(document.createElement('canvas'), { width: TILE, height: TILE });
  const context = scratch.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, TILE, TILE);
  context.drawImage(image, 0, 0, TILE, TILE);
  return decodeRain(context.getImageData(0, 0, TILE, TILE).data);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Petak IMERG gagal dimuat'));
    image.src = url;
  });
}

// Warna NASA dibaca balik menjadi mm/jam (lib/rain.js) lalu digambar ulang
// dengan skala BMKG. Sampai zoom 4 satu sel data ±1 piksel, jadi petak GIBS
// di zoom itu langsung dipakai. Mulai zoom 5 nilai tiap sel diambil dari petak
// zoom 6 dan, bila `smooth`, diinterpolasi bilinear antar-titik tengah sel
// supaya tidak tampak kotak-kotak 11 km.
const RainTiles = L.GridLayer.extend({
  options: { smooth: true },

  initialize(options) {
    L.GridLayer.prototype.initialize.call(this, options);
    this._sources = new Map();
  },

  setUrl(url) {
    this.options.url = url;
    this._sources.clear();
    return this.redraw();
  },

  createTile(coords, done) {
    const tile = L.DomUtil.create('canvas', 'leaflet-tile');
    tile.width = TILE;
    tile.height = TILE;
    const values = coords.z < SOURCE_Z - 1 ? this._native(coords) : this._resample(coords);
    values
      .then((mm) => {
        const context = tile.getContext('2d');
        const image = context.createImageData(TILE, TILE);
        paintRain(mm, image.data);
        context.putImageData(image, 0, 0);
        done(null, tile);
      })
      .catch((err) => done(err, tile));
    return tile;
  },

  _native(coords) {
    return loadImage(L.Util.template(this.options.url, coords)).then(readRain);
  },

  // Petak sumber zoom 6 sebagai mm/jam per piksel, disimpan supaya petak
  // tetangga dan zoom berikutnya tidak memuat ulang.
  _source(x, y) {
    const n = 2 ** SOURCE_Z;
    if (y < 0 || y >= n) return Promise.resolve(null);
    const wrapped = ((x % n) + n) % n;
    const key = `${wrapped}/${y}`;
    let source = this._sources.get(key);
    if (!source) {
      source = loadImage(L.Util.template(this.options.url, { x: wrapped, y, z: SOURCE_Z }))
        .then(readRain)
        .catch(() => null);
      this._sources.set(key, source);
      if (this._sources.size > MAX_SOURCES) this._sources.delete(this._sources.keys().next().value);
    }
    return source;
  },

  async _resample({ x, y, z }) {
    const worldZ = TILE * 2 ** z;
    const world6 = TILE * 2 ** SOURCE_Z;
    const lonOf = (px) => ((x * TILE + px + 0.5) / worldZ) * 360 - 180;
    const latOf = (py) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y * TILE + py + 0.5)) / worldZ))) * 180) / Math.PI;
    // Indeks sel: kolom dari 180° B, baris dari 90° U; titik tengah sel di +0,5.
    const colOf = (lon) => (lon + 180) / CELL_DEG - 0.5;
    const rowOf = (lat) => (90 - lat) / CELL_DEG - 0.5;
    const i0 = Math.floor(colOf(lonOf(0)));
    const i1 = Math.floor(colOf(lonOf(TILE - 1))) + 1;
    const j0 = Math.floor(rowOf(latOf(0)));
    const j1 = Math.floor(rowOf(latOf(TILE - 1))) + 1;
    const width = i1 - i0 + 1;
    const height = j1 - j0 + 1;

    // Posisi titik tengah tiap sel di petak zoom 6.
    const gx = Array.from({ length: width }, (_, k) => ((CELL_DEG * (i0 + k + 0.5)) / 360) * world6);
    const gy = Array.from({ length: height }, (_, k) => {
      const sin = Math.sin(((90 - CELL_DEG * (j0 + k + 0.5)) * Math.PI) / 180);
      return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world6;
    });
    const tileX = [...new Set(gx.map((v) => Math.floor(v / TILE)))];
    const tileY = [...new Set(gy.map((v) => Math.floor(v / TILE)))];
    const sources = new Map();
    await Promise.all(
      tileX.flatMap((tx) => tileY.map(async (ty) => sources.set(`${tx}/${ty}`, await this._source(tx, ty)))),
    );
    const cells = new Float32Array(width * height);
    for (let j = 0; j < height; j++) {
      const ty = Math.floor(gy[j] / TILE);
      const py = Math.min(TILE - 1, Math.floor(gy[j] - ty * TILE));
      for (let i = 0; i < width; i++) {
        const tx = Math.floor(gx[i] / TILE);
        const source = sources.get(`${tx}/${ty}`);
        if (source) cells[j * width + i] = source[py * TILE + Math.min(TILE - 1, Math.floor(gx[i] - tx * TILE))];
      }
    }

    const out = new Float32Array(TILE * TILE);
    const cols = Array.from({ length: TILE }, (_, px) => colOf(lonOf(px)) - i0);
    for (let py = 0; py < TILE; py++) {
      const fy = rowOf(latOf(py)) - j0;
      for (let px = 0; px < TILE; px++) {
        const fx = cols[px];
        if (!this.options.smooth) {
          out[py * TILE + px] = cells[Math.round(fy) * width + Math.round(fx)];
          continue;
        }
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const at = (i, j) => cells[Math.min(height - 1, Math.max(0, j)) * width + Math.min(width - 1, Math.max(0, i))];
        const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
        const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
        out[py * TILE + px] = top * (1 - ty) + bottom * ty;
      }
    }
    return out;
  },
});

export function createImergLayer({ onError, smooth = true } = {}) {
  const group = L.layerGroup();
  // Batas atas detail yang digambar sendiri; lebih dekat dari ini diperbesar Leaflet.
  const options = { pane: 'warnings', maxNativeZoom: 12, maxZoom: 19, smooth, attribution: 'Hujan satelit: NASA GPM IMERG via GIBS' };
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
    else group.addLayer((tiles = new RainTiles({ ...options, url })));
  });
  return group;
}

export const imergLegend = () => `
  <p class="legend-note" data-legend-live="imerg">${escapeHtml(legendText.imerg)}</p>
  ${RAIN_CLASSES.map(
    (c) => `<div class="legend-row"><span class="swatch" style="background:${rainCss(c.mm)}"></span>${c.label} <span class="legend-dim">${c.range} mm/jam</span></div>`,
  ).join('')}
  <p class="legend-note">Rata-rata 30 menit dari satelit, terlambat ±4–6 jam (waktu data tertulis di atas). Kategori intensitas per jam mengikuti BMKG. Di zoom dekat warnanya dihaluskan antar-sel; resolusi asli data ±11 km. Hujan lokal yang singkat bisa terlewat.</p>`;

// ---------- Citra awan Himawari-9 (JMA) ----------

const CLOUDS_REFRESH_MS = 10 * 60_000;
const CLOUDS_FALLBACK_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png';

// Petak inframerah GIBS berupa gambar penuh; di browser permukaan tanpa awan
// dibuat transparan (lib/clouds.js) supaya peta dasar tetap terlihat. GIBS
// mengizinkan CORS, jadi piksel petak boleh dibaca kanvas. Petak yang belum
// terbit (404) diambil dari waktu sebelumnya (fallbackUrls dari server), supaya
// tidak bolong dan tampak seperti langit cerah.
// Awan digambar abu-abu kebiruan di peta dasar terang dan putih di peta dasar
// gelap, jadi petak digambar ulang saat nada peta dasar berganti.
const CloudTiles = L.GridLayer.extend({
  onAdd(map) {
    L.GridLayer.prototype.onAdd.call(this, map);
    this._light = this._isLight();
    map.on('basemapchange', this._onBasemap, this);
  },

  onRemove(map) {
    map.off('basemapchange', this._onBasemap, this);
    L.GridLayer.prototype.onRemove.call(this, map);
  },

  _isLight() {
    return this._map?.getContainer().dataset.tone === 'light';
  },

  _onBasemap() {
    const light = this._isLight();
    if (light === this._light) return;
    this._light = light;
    this.redraw();
  },

  createTile(coords, done) {
    const tile = L.DomUtil.create('canvas', 'leaflet-tile');
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    const urls = [this.options.url, ...this.options.fallbackUrls];
    const load = (index) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const context = tile.getContext('2d', { willReadFrequently: true });
          context.drawImage(image, 0, 0, size.x, size.y);
          const pixels = context.getImageData(0, 0, size.x, size.y);
          cloudsOnly(pixels.data, size.x, { light: this._isLight() });
          context.putImageData(pixels, 0, 0);
          done(null, tile);
        } catch (err) {
          done(err, tile);
        }
      };
      image.onerror = () =>
        index + 1 < urls.length ? load(index + 1) : done(new Error('Petak Himawari-9 gagal dimuat'), tile);
      image.src = L.Util.template(urls[index], coords);
    };
    load(0);
    return tile;
  },
  setUrls(url, fallbackUrls) {
    Object.assign(this.options, { url, fallbackUrls });
    return this.redraw();
  },
});

export function createCloudLayer({ onError } = {}) {
  const group = L.layerGroup();
  const options = {
    pane: 'warnings',
    maxNativeZoom: 6,
    maxZoom: 19,
    attribution: 'Citra awan: Himawari-9 (JMA) via NASA GIBS',
  };
  let tiles = null;
  let time = null;
  let timer = null;

  // Waktu citra terbaru dari server; petak hanya digambar ulang bila citranya baru.
  async function refresh() {
    let url;
    let fallbackUrls = [];
    let next;
    try {
      const now = await getJson('/api/clouds-now');
      url = now.tile_url;
      fallbackUrls = now.fallback_urls ?? [];
      next = now.time;
      const at = new Date(now.time);
      legendText.clouds = `Citra ${shortDate.format(at)}, ${clock.format(at).replace(':', '.')} WIB`;
    } catch (err) {
      // Waktu terbaru tidak diketahui: GIBS tetap bisa memberi citra terbarunya.
      url = CLOUDS_FALLBACK_URL;
      next = 'default';
      legendText.clouds = 'Citra terbaru Himawari-9';
      onError?.(err);
    }
    fillLegend('clouds', legendText.clouds);
    if (!tiles) group.addLayer((tiles = new CloudTiles({ ...options, url, fallbackUrls })));
    else if (next !== time) tiles.setUrls(url, fallbackUrls);
    time = next;
  }

  group.on('add', () => {
    refresh();
    timer ??= setInterval(refresh, CLOUDS_REFRESH_MS);
  });
  group.on('remove', () => {
    clearInterval(timer);
    timer = null;
  });
  return group;
}

// Kelas legenda: suhu wakil (°C) untuk contoh warna dan rentangnya.
const CLOUD_CLASSES = [
  { c: -20, label: 'Awan rendah–menengah', range: '0 s.d. −40 °C' },
  { c: -50, label: 'Awan hujan', range: '−40 s.d. −60 °C' },
  { c: -65, label: 'Awan hujan lebat', range: '−60 s.d. −70 °C' },
  { c: -80, label: 'Inti badai', range: '< −70 °C' },
];

export const cloudLegend = () => `
  <p class="legend-note" data-legend-live="clouds">${escapeHtml(legendText.clouds)}</p>
  ${CLOUD_CLASSES.map(
    (c) => `<div class="legend-row"><span class="swatch" style="background:${cloudCss(c.c, { light: true })}"></span>${c.label} <span class="legend-dim">${c.range}</span></div>`,
  ).join('')}
  <p class="legend-note">Suhu puncak awan dari kanal inframerah, tiap 10 menit, terlambat ±1 jam. Makin dingin makin tinggi awannya: awan tampil putih yang makin pekat, dan hanya puncak di bawah ±−40 °C (umumnya awan hujan konvektif) yang berwarna. Permukaan tanpa awan transparan. Petak yang belum terbit memakai citra 10–30 menit sebelumnya.</p>`;

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
