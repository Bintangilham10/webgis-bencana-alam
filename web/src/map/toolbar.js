import L from 'leaflet';
import { escapeHtml } from '../lib/format.js';
import { icons } from '../lib/icons.js';

const toolButton = (name, label, icon, extra = '') =>
  `<button type="button" class="tool" data-tool="${name}" aria-label="${label}" title="${label}" ${extra}>${icon}</button>`;

// Gambar mini baru dimuat saat menu pertama kali dibuka (data-src).
const basemapOption = (basemap) => `
  <label class="basemap-option">
    <input type="radio" name="basemap" value="${basemap.id}"${basemap.active ? ' checked' : ''} />
    <img alt="" width="96" height="72" data-src="${escapeHtml(basemap.thumbnail)}" />
    <span>${escapeHtml(basemap.name)}</span>
  </label>`;

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
