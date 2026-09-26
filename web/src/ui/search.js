import { getJson } from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';
import { icons } from '../lib/icons.js';

const TYPE_LABELS = { provinsi: 'Provinsi', kabupaten: 'Kabupaten', kota: 'Kota' };
const EXAMPLES = ['Kota Bandung', 'Sleman', 'Kota Palu', 'Pantai Parangtritis'];

function resultHtml(result, index) {
  const isRegion = result.source === 'wilayah';
  const detail = isRegion ? TYPE_LABELS[result.type] ?? result.type : result.label.split(', ').slice(1, 4).join(', ');
  return `
    <button type="button" class="search-result" data-index="${index}">
      <span class="search-result__icon">${isRegion ? icons.building : icons.pin}</span>
      <span class="search-result__text"><strong>${escapeHtml(result.name)}</strong><small>${escapeHtml(detail)}</small></span>
    </button>`;
}

// Kotak pencarian di bilah atas. Pencarian dijalankan saat Enter/tombol Cari
// ditekan, bukan per ketikan: kebijakan Nominatim melarang autocomplete.
// Saat kosong, kotak menawarkan contoh pencarian.
export function createSearch(container, { onSelect }) {
  container.innerHTML = `
    <form class="search-form glass" role="search">
      ${icons.search}
      <input type="search" name="q" placeholder="Cari tempat atau kab/kota…" aria-label="Cari lokasi"
             autocomplete="off" minlength="2" maxlength="100" enterkeyhint="search" required />
      <button type="submit" class="search-submit">Cari</button>
    </form>
    <div class="search-results" hidden></div>`;

  const form = container.querySelector('form');
  const input = form.querySelector('input');
  const panel = container.querySelector('.search-results');
  let results = [];
  // Di layar sempit teks petunjuk dipersingkat supaya tidak terpotong.
  const narrow = window.matchMedia('(max-width: 479.98px)');
  const setPlaceholder = () => {
    input.placeholder = narrow.matches ? 'Cari tempat…' : 'Cari tempat atau kab/kota…';
  };
  setPlaceholder();
  narrow.addEventListener('change', setPlaceholder);

  const show = (html, mode) => {
    panel.innerHTML = html;
    panel.dataset.mode = mode;
    panel.hidden = false;
  };
  const hide = () => {
    panel.hidden = true;
  };

  const showExamples = () =>
    show(
      `<p class="search-note">Contoh pencarian</p>
       <div class="search-examples">${EXAMPLES.map((e) => `<button type="button" class="search-example" data-example="${escapeHtml(e)}">${escapeHtml(e)}</button>`).join('')}</div>`,
      'examples',
    );

  async function search(q) {
    if (q.length < 2) return;
    show('<p class="search-note">Mencari…</p>', 'status');
    try {
      const data = await getJson(`/api/geocode?q=${encodeURIComponent(q)}`);
      results = data.results;
      const note = data.warning ? `<p class="search-note">${escapeHtml(data.warning)}</p>` : '';
      show(
        results.length
          ? note + results.map(resultHtml).join('')
          : `${note}<p class="search-note">Tidak ditemukan. Coba nama kab/kota, kecamatan, atau tempat terkenal.</p>`,
        'results',
      );
    } catch (err) {
      show(`<p class="search-note">${escapeHtml(err.message)}</p>`, 'status');
    }
  }

  function select(result) {
    hide();
    input.value = result.name;
    input.blur();
    onSelect(result);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search(input.value.trim());
  });
  input.addEventListener('focus', () => {
    if (!input.value.trim()) showExamples();
  });
  input.addEventListener('input', () => {
    if (!input.value.trim()) showExamples();
    else if (panel.dataset.mode === 'examples') hide();
  });
  panel.addEventListener('click', (event) => {
    const example = event.target.closest('[data-example]');
    if (example) {
      input.value = example.dataset.example;
      search(input.value);
      return;
    }
    const button = event.target.closest('[data-index]');
    if (button) select(results[Number(button.dataset.index)]);
  });

  // Panah atas/bawah berpindah antarpilihan, Escape menutup daftar.
  container.addEventListener('keydown', (event) => {
    const buttons = [...panel.querySelectorAll('button')];
    const current = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      hide();
      input.focus();
    } else if (event.key === 'ArrowDown' && !panel.hidden && buttons.length) {
      event.preventDefault();
      buttons[Math.min(current + 1, buttons.length - 1)].focus();
    } else if (event.key === 'ArrowUp' && buttons.length && current !== -1) {
      event.preventDefault();
      if (current === 0) input.focus();
      else buttons[current - 1].focus();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (!container.contains(event.target)) hide();
  });
}
