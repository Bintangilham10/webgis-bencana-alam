import L from 'leaflet';
import { escapeHtml } from '../lib/format.js';
import { icons } from '../lib/icons.js';

// Legenda peta (elemen kartografi) melayang di kiri bawah peta. Isinya diatur
// panel lapisan sesuai layer yang aktif. Terlipat bawaan supaya tidak menutupi
// peta; tombolnya menunjukkan jumlah lapisan aktif.
export const LegendControl = L.Control.extend({
  options: { position: 'bottomleft', collapsed: true },

  onAdd() {
    const el = L.DomUtil.create('section', 'map-legend');
    el.setAttribute('aria-label', 'Legenda peta');
    el.innerHTML = `
      <button type="button" class="map-legend__toggle" aria-expanded="false">
        ${icons.list}<span>Legenda</span><span class="map-legend__count"></span>
        <span class="map-legend__chevron">${icons.chevronDown}</span>
      </button>
      <div class="map-legend__body" hidden></div>`;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);

    this._toggle = el.querySelector('.map-legend__toggle');
    this._count = el.querySelector('.map-legend__count');
    this._body = el.querySelector('.map-legend__body');
    this._toggle.addEventListener('click', () => this.setExpanded(this._body.hidden));
    this.setExpanded(!this.options.collapsed);
    this._render();
    return el;
  },

  setExpanded(open) {
    if (!this._body) {
      this.options.collapsed = !open;
      return;
    }
    this._toggle.setAttribute('aria-expanded', String(open));
    this._body.hidden = !open;
  },

  setBlocks(blocks) {
    this._blocks = blocks;
    this._render();
  },

  _render() {
    if (!this._body) return;
    const blocks = this._blocks ?? [];
    this._count.textContent = blocks.length ? `${blocks.length} lapisan` : '';
    this._body.innerHTML = blocks.length
      ? blocks.map((b) => `<div class="legend-block"><h3>${escapeHtml(b.title)}</h3>${b.html}</div>`).join('')
      : '<p class="legend-empty">Tidak ada lapisan aktif.</p>';
  },
});
