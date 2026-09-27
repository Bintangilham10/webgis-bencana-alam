import L from 'leaflet';
import { escapeHtml } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { cssVar } from '../lib/theme.js';

const toolButton = (name, label, icon, extra = '') =>
  `<button type="button" class="tool" data-tool="${name}" aria-label="${label}" title="${label}" ${extra}>${icon}</button>`;

// Tombol yang membuka menu di kiri bilah alat; satu menu terbuka sekaligus.
const MENUS = ['filter', 'basemap'];
// Jarak menu dari tepi bawah layar (di HP: dari lembar bawah) dan dari bilah atas.
const MENU_EDGE_GAP = 16;
const MENU_TOP_GAP = 8;
const MIN_MENU_HEIGHT = 200;
const MOBILE_QUERY = '(max-width: 767.98px)';
const px = (name) => parseFloat(cssVar(name)) || 0;

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

// Gambar mini diambil langsung dari server tile. Server bisa gagal sesaat atau
// menolak browser tertentu (server HOT menolak browser bawaan VS Code), jadi
// gambar yang gagal dicoba lagi. Bila tetap gagal, kotaknya diberi keterangan
// dan dicoba lagi saat menu dibuka lagi.
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
        img.src = src;
      }, THUMB_RETRY_MS[attempt++]);
      return;
    }
    attempt = 0;
    option.classList.add('is-broken');
    img.dataset.src = src;
  });
}

// Bilah alat di kanan peta dengan tombol seragam: zoom, seluruh Indonesia,
// cek risiko (lokasi saya / pilih titik), filter penanda, dan peta dasar.
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
        ${toolButton('filter', 'Filter penanda peta', icons.filter, 'aria-expanded="false" aria-controls="filter-menu"')}
        ${toolButton('basemap', 'Ganti peta dasar', icons.layers, 'aria-expanded="false" aria-controls="basemap-menu"')}
        <div id="filter-menu" class="map-menu filter-menu" role="group" aria-label="Filter penanda peta" hidden></div>
        <div id="basemap-menu" class="map-menu basemap-menu" role="radiogroup" aria-label="Peta dasar" hidden>
          <p class="map-menu__title">Peta dasar</p>
          ${this.options.basemaps.map(basemapOption).join('')}
        </div>
      </div>`;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);

    this._map = map;
    this._pick = el.querySelector('[data-tool="pick"]');
    this._menus = MENUS.map((name) => ({
      name,
      button: el.querySelector(`[data-tool="${name}"]`),
      menu: el.querySelector(`#${name}-menu`),
    }));
    // Isi menu filter dibuat oleh ui/marker-filter.js.
    this.filterMenu = el.querySelector('#filter-menu');
    this._basemapMenu = el.querySelector('#basemap-menu');
    this._basemapMenu.querySelectorAll('img').forEach(retryThumbnail);
    const zoomIn = el.querySelector('[data-tool="zoom-in"]');
    const zoomOut = el.querySelector('[data-tool="zoom-out"]');

    el.addEventListener('click', (event) => {
      const tool = event.target.closest('[data-tool]')?.dataset.tool;
      if (tool === 'zoom-in') map.zoomIn();
      else if (tool === 'zoom-out') map.zoomOut();
      else if (tool === 'home') this.options.onHome();
      else if (tool === 'locate') this.options.onLocate();
      else if (tool === 'pick') this.options.onPick();
      else if (MENUS.includes(tool)) this._toggleMenu(tool);
    });
    this._basemapMenu.addEventListener('change', (event) => this._setBasemap(event.target.value));

    this._onDocumentPointer = (event) => {
      if (!el.contains(event.target)) this._toggleMenu(null);
    };
    this._onKeydown = (event) => {
      const open = this._menus.find(({ menu }) => !menu.hidden);
      if (event.key === 'Escape' && open) {
        this._toggleMenu(null);
        open.button.focus();
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

  // Titik penanda di tombol filter selama ada penanda yang disembunyikan.
  setFiltered(filtered) {
    this._menus?.find(({ name }) => name === 'filter').button.classList.toggle('is-filtered', filtered);
  },

  // Membuka menu `name` (atau menutupnya bila sudah terbuka) dan menutup menu
  // lain; null menutup semua.
  _toggleMenu(name) {
    for (const { name: id, button, menu } of this._menus) {
      const open = id === name && menu.hidden;
      menu.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) this._showMenu(menu);
    }
  },

  _showMenu(menu) {
    for (const img of menu.querySelectorAll('img[data-src]')) {
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    }
    this._placeMenu(menu);
    const target = menu === this._basemapMenu ? menu.querySelector('input:checked') : menu.querySelector('input');
    target?.focus();
  },

  // Menu sejajar tombolnya. Bila tidak muat ke bawah (di HP terpotong lembar
  // bawah), menu dinaikkan secukupnya tanpa melewati bilah atas; sisanya digulir.
  _placeMenu(menu) {
    const bottomLimit = window.innerHeight - MENU_EDGE_GAP - (window.matchMedia(MOBILE_QUERY).matches ? px('--sheet-peek') : 0);
    const topLimit = px('--gap') + px('--topbar-h') + MENU_TOP_GAP;
    menu.style.top = '';
    menu.style.maxHeight = '';
    const { top } = menu.getBoundingClientRect();
    // Tinggi penuh = isi + garis tepi, +1 karena tinggi isi bisa pecahan piksel;
    // tanpa itu muncul scrollbar yang menyempitkan isi sehingga chip turun baris.
    const height = menu.scrollHeight + (menu.offsetHeight - menu.clientHeight) + 1;
    const shift = Math.min(Math.max(0, top + height - bottomLimit), Math.max(0, top - topLimit));
    menu.style.top = `${-shift}px`;
    menu.style.maxHeight = `${Math.max(MIN_MENU_HEIGHT, bottomLimit - top + shift)}px`;
  },

  _setBasemap(id) {
    for (const basemap of this.options.basemaps) {
      if (this._map.hasLayer(basemap.layer)) this._map.removeLayer(basemap.layer);
    }
    const basemap = this.options.basemaps.find((b) => b.id === id);
    if (!basemap) return;
    basemap.layer.addTo(this._map);
    this._map.fire('basemapchange', { basemap });
  },
});
