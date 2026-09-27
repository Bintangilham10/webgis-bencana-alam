import { volcanoSwatch } from '../layers/volcanoes.js';
import { escapeHtml } from '../lib/format.js';
import { DEPTH_CLASSES, VOLCANO_LEVELS } from '../lib/symbology.js';

// Magnitudo minimum (0 = semua) dan rentang waktu gempa dalam jam. Rentang
// terpanjang sama dengan data yang dimuat (7 hari), jadi berarti tanpa filter.
const MAGNITUDES = [0, 4, 5, 6];
const PERIODS = [
  { hours: 24, label: '24 jam' },
  { hours: 72, label: '3 hari' },
  { hours: 168, label: '7 hari' },
];
const ALL_HOURS = PERIODS.at(-1).hours;
const LEVEL_IDS = Object.keys(VOLCANO_LEVELS).map(Number);

const chip = ({ type, name, value, checked, label, title, symbol = '' }) => `
  <label class="filter-chip"${title ? ` title="${escapeHtml(title)}"` : ''}>
    <input type="${type}" name="${name}" value="${value}"${checked ? ' checked' : ''} />
    <span>${symbol}${escapeHtml(label)}</span>
  </label>`;

const field = (legend, chips) => `
  <fieldset class="filter-field">
    <legend>${legend}</legend>
    <div class="filter-chips">${chips.join('')}</div>
  </fieldset>`;

const quakeFields = () =>
  field(
    'Kedalaman',
    DEPTH_CLASSES.map((c) =>
      chip({
        type: 'checkbox',
        name: 'depth',
        value: c.id,
        checked: true,
        label: c.label.replace(/\s*\(.*\)$/, ''),
        title: c.label,
        symbol: `<span class="quake-swatch" style="--c:${c.color}"></span>`,
      }),
    ),
  ) +
  field(
    'Magnitudo',
    MAGNITUDES.map((m) => chip({ type: 'radio', name: 'magnitude', value: m, checked: m === 0, label: m ? `M ≥ ${m}` : 'Semua' })),
  ) +
  field(
    'Waktu',
    PERIODS.map((p) => chip({ type: 'radio', name: 'period', value: p.hours, checked: p.hours === ALL_HOURS, label: p.label })),
  );

const volcanoFields = () =>
  field(
    'Tingkat aktivitas',
    LEVEL_IDS.map((id) =>
      chip({
        type: 'checkbox',
        name: 'level',
        value: id,
        checked: true,
        label: VOLCANO_LEVELS[id].short,
        title: VOLCANO_LEVELS[id].label,
        symbol: volcanoSwatch(id),
      }),
    ),
  );

// Menu filter di bilah alat: menyalakan/mematikan penanda gempa dan gunung api
// serta menyaringnya menurut kedalaman, magnitudo, waktu, dan tingkat
// aktivitas. Filter hanya mengubah peta; daftar dan angka di Ikhtisar tetap
// lengkap. onChange(filtered) memberi tahu apakah ada penanda yang disembunyikan.
export function createMarkerFilter({ map, container, earthquakes, volcanoes, onChange }) {
  const groups = [
    {
      id: 'quakes',
      label: 'Gempa bumi',
      source: earthquakes,
      symbol: `<span class="quake-swatch" style="--c:${DEPTH_CLASSES[0].color}"></span>`,
      fields: quakeFields(),
    },
    { id: 'volcanoes', label: 'Gunung api', source: volcanoes, symbol: volcanoSwatch(3), fields: volcanoFields() },
  ];

  container.innerHTML = `
    <p class="map-menu__title">Filter penanda</p>
    ${groups
      .map(
        (g) => `
          <section class="filter-group">
            <label class="filter-head">
              <span class="filter-head__symbol" aria-hidden="true">${g.symbol}</span>
              <span class="filter-head__text">
                <span class="filter-head__label">${g.label}</span>
                <span class="filter-head__count" data-count="${g.id}"></span>
              </span>
              <input type="checkbox" role="switch" class="switch" data-layer="${g.id}" aria-label="Tampilkan ${g.label.toLowerCase()}" />
            </label>
            <fieldset class="filter-body" data-body="${g.id}">${g.fields}</fieldset>
          </section>`,
      )
      .join('')}
    <button type="button" class="filter-reset">Tampilkan semua</button>`;
  const reset = container.querySelector('.filter-reset');

  const checked = (name) => [...container.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
  const chosen = (name) => Number(checked(name)[0]);
  const isDefault = () =>
    checked('depth').length === DEPTH_CLASSES.length &&
    chosen('magnitude') === 0 &&
    chosen('period') === ALL_HOURS &&
    checked('level').length === LEVEL_IDS.length;

  function applyFilters() {
    const hours = chosen('period');
    earthquakes.setFilter({
      depths: new Set(checked('depth')),
      minMagnitude: chosen('magnitude'),
      maxHours: hours === ALL_HOURS ? Infinity : hours,
    });
    volcanoes.setFilter({ levels: new Set(checked('level').map(Number)) });
  }

  // Sakelar, jumlah penanda yang tampil, dan tombol "Tampilkan semua" mengikuti
  // keadaan peta.
  function refresh() {
    for (const { id, source } of groups) {
      const on = map.hasLayer(source.layer);
      const { shown, total, loaded } = source.counts();
      container.querySelector(`[data-layer="${id}"]`).checked = on;
      container.querySelector(`[data-body="${id}"]`).disabled = !on;
      container.querySelector(`[data-count="${id}"]`).textContent = !on
        ? 'Disembunyikan'
        : !loaded
          ? 'Memuat…'
          : shown === total
            ? `${total} ditampilkan`
            : `${shown} dari ${total} ditampilkan`;
    }
    const filtered = !isDefault() || groups.some(({ source }) => !map.hasLayer(source.layer));
    reset.disabled = !filtered;
    onChange?.(filtered);
  }

  container.addEventListener('change', (event) => {
    const group = groups.find(({ id }) => id === event.target.dataset.layer);
    if (!group) applyFilters();
    else if (event.target.checked) group.source.layer.addTo(map);
    else map.removeLayer(group.source.layer);
    refresh();
  });

  reset.addEventListener('click', () => {
    for (const input of container.querySelectorAll('.filter-body input')) input.checked = input.defaultChecked;
    applyFilters();
    for (const { source } of groups) source.layer.addTo(map);
    refresh();
  });

  // Lapisan juga bisa dinyalakan dari tab Lapisan atau daftar di Ikhtisar, dan
  // isi lapisan berubah setelah data diperbarui atau penanda dipilih dari daftar.
  map.on('layeradd layerremove', ({ layer }) => {
    if (groups.some(({ source }) => source.layer === layer)) refresh();
  });
  for (const { source } of groups) source.layer.on('filterchange', refresh);

  refresh();
}
