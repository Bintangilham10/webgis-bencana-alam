import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';

const TYPE_LABELS = { provinsi: 'Provinsi', kabupaten: 'Kabupaten', kota: 'Kota' };
const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

function resultHtml(result, index) {
  const detail =
    result.source === 'wilayah'
      ? TYPE_LABELS[result.type] ?? result.type
      : result.label.split(', ').slice(1, 4).join(', ');
  return `
    <button type="button" class="search-result" data-index="${index}">
      <strong>${escapeHtml(result.name)}</strong>
      <small>${escapeHtml(detail)}</small>
    </button>`;
}

// Pencarian dijalankan saat Enter/tombol ditekan, bukan per ketikan: kebijakan
// Nominatim melarang autocomplete.
export const SearchControl = L.Control.extend({
  options: { position: 'topleft', onSelect: () => {} },

  onAdd() {
    const form = L.DomUtil.create('form', 'search-control');
    form.setAttribute('role', 'search');
    form.innerHTML = `
      <div class="search-box">
        <input type="search" name="q" placeholder="Cari tempat atau kab/kota…" aria-label="Cari lokasi"
               autocomplete="off" minlength="2" maxlength="100" required />
        <button type="submit" aria-label="Cari">${SEARCH_ICON}</button>
      </div>
      <div class="search-results" hidden></div>`;
    L.DomEvent.disableClickPropagation(form);
    L.DomEvent.disableScrollPropagation(form);

    this._input = form.querySelector('input');
    this._panel = form.querySelector('.search-results');
    this._results = [];
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this._search();
    });
    form.addEventListener('keydown', (event) => this._onKeydown(event));
    this._panel.addEventListener('click', (event) => {
      const button = event.target.closest('.search-result');
      if (button) this._select(this._results[Number(button.dataset.index)]);
    });
    return form;
  },

  async _search() {
    const q = this._input.value.trim();
    if (q.length < 2) return;
    this._showMessage('Mencari…');
    try {
      const { results, warning } = await getJson(`/api/geocode?q=${encodeURIComponent(q)}`);
      this._results = results;
      const list = results.map(resultHtml).join('');
      const note = warning ? `<p class="search-note">${escapeHtml(warning)}</p>` : '';
      this._panel.innerHTML = list ? note + list : `${note}<p class="search-note">Tidak ditemukan. Coba nama kab/kota, kecamatan, atau tempat terkenal.</p>`;
      this._panel.hidden = false;
    } catch (err) {
      this._showMessage(err.message);
    }
  },

  _showMessage(text) {
    this._panel.innerHTML = `<p class="search-note">${escapeHtml(text)}</p>`;
    this._panel.hidden = false;
  },

  _select(result) {
    this._panel.hidden = true;
    this._input.value = result.name;
    this.options.onSelect(result);
  },

  // Panah atas/bawah berpindah antarhasil, Escape menutup daftar.
  _onKeydown(event) {
    const buttons = [...this._panel.querySelectorAll('.search-result')];
    const current = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      this._panel.hidden = true;
      this._input.focus();
    } else if (event.key === 'ArrowDown' && buttons.length) {
      event.preventDefault();
      buttons[Math.min(current + 1, buttons.length - 1)].focus();
    } else if (event.key === 'ArrowUp' && buttons.length) {
      event.preventDefault();
      if (current <= 0) this._input.focus();
      else buttons[current - 1].focus();
    }
  },
});
