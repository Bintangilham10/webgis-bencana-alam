import L from 'leaflet';
import { escapeHtml } from '../lib/format.js';
import { icons } from '../lib/icons.js';

const toolButton = (name, label, icon, extra = '') =>
  `<button type="button" class="tool" data-tool="${name}" aria-label="${label}" title="${label}" ${extra}>${icon}</button>`;

// Jeda sebelum gambar mini yang gagal dimuat dicoba lagi.
const THUMB_RETRY_MS = [1_500, 4_000];
// Gambar transparen 1 px pengganti gambar mini yang gagal. Chrome tetap
// menggambar ikon gambar rusak walau atribut src dilepas.
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

// Gambar mini baru dimuat saat menu pertama kali dibuka (data-src).
const basemapOption = (basemap) => `
  <label class="basemap-option">
    <input type="radio" name="basemap" value="${basemap.id}"${basemap.active ? ' checked' : ''} />
    <img alt="" width="96" height="72" data-src="${escapeHtml(basemap.thumbnail)}" />
    <span>${escapeHtml(basemap.name)}</span>
  </label>`;

// Gambar mini diambil langsung dari server tile. Server relawan (misalnya HOT di
// OSM Prancis) kadang gagal sesaat, jadi gambar yang gagal dicoba lagi. Bila
// tetap gagal, kotaknya diberi keterangan dan dicoba lagi saat menu dibuka lagi.
function retryThumbnail(img) {
  const option = img.closest('.basemap-option');
  let attempt = 0;
  img.addEventListener('load', () => {
    if (img.getAttribute('src') === BLANK_IMAGE) return;
    attempt = 0;
    option.classList.remove('is-broken');
  });
  img.addEventListener('error', () => {
    const src = img.getAttribute('src');
    if (!src || src === BLANK_IMAGE) return;
    img.src = BLANK_IMAGE;
    if (attempt < THUMB_RETRY_MS.length) {
      setTimeout(() => {
        // Tema bisa berganti selama menunggu; gambar mini yang baru tidak ditimpa.
        if (img.getAttribute('src') === BLANK_IMAGE && !img.dataset.src) img.src = src;
      }, THUMB_RETRY_MS[attempt++]);
      return;
    }
    attempt = 0;
    option.classList.add('is-broken');
    img.dataset.src = src;
  });
}

// Bilah alat di kanan peta dengan tombol seragam: zoom, seluruh Indonesia,
// cek risiko (lokasi saya / pilih titik), dan pemilih peta dasar.
export const MapToolbar = L.Control.extend({
  options: { position: 'topright', basemaps: [], onHome() {}, onLocate() {}, onPick() {} },

  onAdd(map) {
    const el = L.DomUtil.create('div', 'map-toolbar');
    el.innerHTML = `
      <div class="tool-group glass">
        ${toolButton('zoom-in', 'Perbesar', icons.plus)}
        ${toolButton('zoom-out', 'Perkecil', icons.minus)}
        ${toolButton('home', 'Tampilkan seluruh Indonesia', icons.extent)}
      </div>
      <div class="tool-group glass">
        ${toolButton('locate', 'Cek risiko di lokasi saya', icons.locate)}
        ${toolButton('pick', 'Cek risiko: pilih titik di peta', icons.pin, 'aria-pressed="false"')}
      </div>
      <div class="tool-group glass">
        ${toolButton('basemap', 'Ganti peta dasar', icons.layers, 'aria-expanded="false" aria-controls="basemap-menu"')}
        <div id="basemap-menu" class="basemap-menu" role="radiogroup" aria-label="Peta dasar" hidden>
          <p class="basemap-menu__title">Peta dasar</p>
          ${this.options.basemaps.map(basemapOption).join('')}
        </div>
      </div>`;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);

    this._map = map;
    this._pick = el.querySelector('[data-tool="pick"]');
    this._menuButton = el.querySelector('[data-tool="basemap"]');
    this._menu = el.querySelector('.basemap-menu');
    this._menu.querySelectorAll('img').forEach(retryThumbnail);
    const zoomIn = el.querySelector('[data-tool="zoom-in"]');
    const zoomOut = el.querySelector('[data-tool="zoom-out"]');

    el.addEventListener('click', (event) => {
      const tool = event.target.closest('[data-tool]')?.dataset.tool;
      if (tool === 'zoom-in') map.zoomIn();
      else if (tool === 'zoom-out') map.zoomOut();
      else if (tool === 'home') this.options.onHome();
      else if (tool === 'locate') this.options.onLocate();
      else if (tool === 'pick') this.options.onPick();
      else if (tool === 'basemap') this._toggleMenu();
    });
    this._menu.addEventListener('change', (event) => this._setBasemap(event.target.value));

    this._onDocumentPointer = (event) => {
      if (!this._menu.hidden && !el.contains(event.target)) this._toggleMenu(false);
    };
    this._onKeydown = (event) => {
      if (event.key === 'Escape' && !this._menu.hidden) {
        this._toggleMenu(false);
        this._menuButton.focus();
      }
    };
    document.addEventListener('pointerdown', this._onDocumentPointer);
    document.addEventListener('keydown', this._onKeydown);

    this._updateZoom = () => {
      zoomIn.disabled = map.getZoom() >= map.getMaxZoom();
      zoomOut.disabled = map.getZoom() <= map.getMinZoom();
    };
    map.on('zoomend', this._updateZoom);
    this._updateZoom();
    return el;
  },

  onRemove(map) {
    document.removeEventListener('pointerdown', this._onDocumentPointer);
    document.removeEventListener('keydown', this._onKeydown);
    map.off('zoomend', this._updateZoom);
  },

  // Bisa dipanggil sebelum kontrol ditambahkan ke peta; saat itu belum ada tombol.
  setPicking(active) {
    this._pick?.setAttribute('aria-pressed', String(active));
  },

  // Gambar mini kanvas berganti mengikuti tema.
  setThumbnail(id, src) {
    const img = this._menu?.querySelector(`input[value="${id}"] + img`);
    if (!img) return;
    if (img.dataset.src) img.dataset.src = src;
    else img.src = src;
  },

  _toggleMenu(open = this._menu.hidden) {
    this._menu.hidden = !open;
    this._menuButton.setAttribute('aria-expanded', String(open));
    if (!open) return;
    for (const img of this._menu.querySelectorAll('img[data-src]')) {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    }
    this._menu.querySelector('input:checked')?.focus();
  },

  _setBasemap(id) {
    for (const basemap of this.options.basemaps) {
      if (this._map.hasLayer(basemap.layer)) this._map.removeLayer(basemap.layer);
    }
    this.options.basemaps.find((b) => b.id === id)?.layer.addTo(this._map);
  },
});
