import L from 'leaflet';
import { escapeHtml } from '../lib/format.js';
import { icons } from '../lib/icons.js';

// Legenda peta (elemen kartografi) melayang di kiri bawah peta. Isinya diatur
// panel lapisan sesuai layer yang aktif. Terlipat bawaan supaya tidak menutupi
// peta; tombolnya menunjukkan jumlah lapisan aktif. Buka-tutupnya beranimasi (CSS).
export const LegendControl = L.Control.extend({
  options: { position: 'bottomleft', collapsed: true },

  onAdd() {
    const el = L.DomUtil.create('section', 'map-legend glass');
    el.setAttribute('aria-label', 'Legenda peta');
    el.innerHTML = `
      <button type="button" class="map-legend__toggle" aria-expanded="false" aria-controls="map-legend-body">
        ${icons.list}<span>Legenda</span><span class="map-legend__count"></span>
        <span class="map-legend__chevron">${icons.chevronDown}</span>
      </button>
      <div class="map-legend__panel">
        <div class="map-legend__body" id="map-legend-body">
          <div class="map-legend__scroll"></div>
        </div>
      </div>`;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);

    this._el = el;
    this._toggle = el.querySelector('.map-legend__toggle');
    this._count = el.querySelector('.map-legend__count');
    this._content = el.querySelector('.map-legend__scroll');
    this._toggle.addEventListener('click', () => this.setExpanded(!el.classList.contains('is-open')));
    this.setExpanded(!this.options.collapsed);
    this._render();
    return el;
  },

  setExpanded(open) {
    if (!this._el) {
      this.options.collapsed = !open;
      return;
    }
    this._el.classList.toggle('is-open', open);
    this._toggle.setAttribute('aria-expanded', String(open));
  },

  setBlocks(blocks) {
    this._blocks = blocks;
    this._render();
  },

  _render() {
    if (!this._content) return;
    const blocks = this._blocks ?? [];
    this._count.textContent = blocks.length ? `${blocks.length} lapisan` : '';
    this._content.innerHTML = blocks.length
      ? blocks.map((b) => `<div class="legend-block"><h3>${b.icon ?? ''}${escapeHtml(b.title)}</h3>${b.html}</div>`).join('')
      : '<p class="legend-empty">Tidak ada lapisan aktif.</p>';
  },
});
