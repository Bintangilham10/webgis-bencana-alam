import L from 'leaflet';

const LOCATE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const PICK_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-7.2 7-12.5A7 7 0 0 0 5 9.5C5 14.8 12 22 12 22z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v4.5M12 12.8v.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

// Dua tombol alat di bawah zoom: lokasi pengguna dan mode pilih titik cek risiko.
export const ToolsControl = L.Control.extend({
  options: { position: 'topleft', onLocate: () => {}, onPick: () => {} },

  onAdd() {
    const bar = L.DomUtil.create('div', 'leaflet-bar tools-control');
    bar.innerHTML = `
      <a href="#" role="button" data-tool="locate" title="Cek risiko di lokasi saya" aria-label="Cek risiko di lokasi saya">${LOCATE_ICON}</a>
      <a href="#" role="button" data-tool="pick" title="Cek risiko: pilih titik di peta" aria-label="Cek risiko: pilih titik di peta" aria-pressed="false">${PICK_ICON}</a>`;
    L.DomEvent.disableClickPropagation(bar);
    bar.addEventListener('click', (event) => {
      const tool = event.target.closest('[data-tool]')?.dataset.tool;
      if (!tool) return;
      event.preventDefault();
      if (tool === 'locate') this.options.onLocate();
      else this.options.onPick();
    });
    this._pick = bar.querySelector('[data-tool="pick"]');
    return bar;
  },

  // Bisa dipanggil sebelum kontrol ditambahkan ke peta; saat itu belum ada tombol.
  setPicking(active) {
    this._pick?.classList.toggle('is-active', active);
    this._pick?.setAttribute('aria-pressed', String(active));
  },
});
