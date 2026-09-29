import { escapeHtml } from '../lib/format.js';

// Tab Lapisan dibangun dari daftar grup, jadi layer baru cukup didaftarkan di
// main.js. Grup biasa berupa sakelar; grup `exclusive` berupa pilihan tunggal
// (chip) karena raster peta rawan saling menutupi bila dinyalakan bersamaan.
// Item dengan `on: true` menyala sejak awal (di grup exclusive: pilihan bawaan).
// Legenda peta mengikuti layer yang aktif.
export function createLayerPanel({ map, container, legend, groups }) {
  const active = new Set();
  const switches = new Map();
  // Grup exclusive: radio tiap item dan radio "Tidak ada".
  const radios = new Map();
  const noneRadios = new Map();
  const groupOf = new Map(groups.flatMap((group) => group.items.map((item) => [item, group])));

  const updateLegend = () =>
    legend.setBlocks(
      groups
        .flatMap((group) => group.items)
        .filter((item) => active.has(item) && item.legend)
        .map((item) => ({ title: item.legendTitle ?? item.label, html: item.legend() })),
    );

  const setActive = (item, on) => {
    if (on) {
      active.add(item);
      item.layer.addTo(map);
    } else {
      active.delete(item);
      map.removeLayer(item.layer);
    }
  };

  // Lapisan juga bisa dinyalakan dari luar panel (menu filter di bilah alat,
  // pilihan di daftar Ikhtisar), jadi sakelar, pilihan, dan legenda mengikuti peta.
  const items = groups.flatMap((group) => group.items);
  map.on('layeradd layerremove', ({ layer }) => {
    const item = items.find((candidate) => candidate.layer === layer);
    if (!item || map.hasLayer(layer) === active.has(item)) return;
    const group = groupOf.get(item);
    if (map.hasLayer(layer)) {
      active.add(item);
      // Tetap satu pilihan per grup exclusive.
      if (group.exclusive) group.items.filter((other) => other !== item && active.has(other)).forEach((other) => setActive(other, false));
    } else active.delete(item);
    const input = switches.get(item);
    if (input) input.checked = active.has(item);
    if (group.exclusive) {
      const chosen = group.items.find((candidate) => active.has(candidate));
      (chosen ? radios.get(chosen) : noneRadios.get(group)).checked = true;
    }
    updateLegend();
  });

  function switchList(group) {
    const list = document.createElement('ul');
    list.className = 'switch-list';
    for (const item of group.items) {
      const row = document.createElement('li');
      row.innerHTML = `
        <label class="switch-row">
          <span class="switch-symbol" aria-hidden="true">${item.symbol ?? ''}</span>
          <span class="switch-text">
            <span class="switch-label">${escapeHtml(item.label)}</span>
            ${item.description ? `<span class="switch-desc">${escapeHtml(item.description)}</span>` : ''}
          </span>
          <input type="checkbox" role="switch" class="switch"${item.on ? ' checked' : ''} />
        </label>`;
      const input = row.querySelector('input');
      switches.set(item, input);
      input.addEventListener('change', () => {
        setActive(item, input.checked);
        updateLegend();
      });
      if (item.on) setActive(item, true);
      list.append(row);
    }
    return list;
  }

  function choiceGroup(group) {
    const wrap = document.createElement('div');
    const options = [{ label: 'Tidak ada' }, ...group.items];
    const initial = Math.max(0, options.findIndex((option) => option.on));
    wrap.innerHTML = `
      <div class="choice-chips" role="radiogroup" aria-label="${escapeHtml(group.title)}">
        ${options
          .map(
            (option, index) => `
              <label class="choice">
                <input type="radio" name="layer-${group.id}" value="${index}"${index === initial ? ' checked' : ''} />
                <span>${escapeHtml(option.label)}</span>
              </label>`,
          )
          .join('')}
      </div>
      ${
        group.opacity === undefined
          ? ''
          : `<label class="range-row"${initial ? '' : ' hidden'}>
               Transparansi
               <input type="range" min="0.2" max="1" step="0.05" value="${group.opacity}" />
               <output>${Math.round(group.opacity * 100)}%</output>
             </label>`
      }`;

    const inputs = wrap.querySelectorAll('input[type="radio"]');
    noneRadios.set(group, inputs[0]);
    group.items.forEach((item, index) => radios.set(item, inputs[index + 1]));
    if (initial) setActive(options[initial], true);

    const range = wrap.querySelector('.range-row');
    wrap.querySelector('.choice-chips').addEventListener('change', (event) => {
      const chosen = options[Number(event.target.value)];
      const shown = group.items.includes(chosen);
      group.items.forEach((item) => setActive(item, item === chosen));
      if (range) range.hidden = !shown;
      updateLegend();
      // Warna peta rawan hanya bisa dibaca dengan legendanya.
      if (shown) legend.setExpanded(true);
    });
    range?.querySelector('input').addEventListener('input', (event) => {
      const value = Number(event.target.value);
      group.items.forEach((item) => item.layer.setOpacity(value));
      range.querySelector('output').textContent = `${Math.round(value * 100)}%`;
    });
    return wrap;
  }

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'section';
    section.innerHTML = `
      <div class="section-head">
        <h2 class="section-title">${escapeHtml(group.title)}</h2>
        ${group.note ? `<span class="section-meta">${escapeHtml(group.note)}</span>` : ''}
      </div>`;
    section.append(group.exclusive ? choiceGroup(group) : switchList(group));
    if (group.description) section.insertAdjacentHTML('beforeend', `<p class="section-note">${escapeHtml(group.description)}</p>`);
    container.append(section);
  }
  updateLegend();
}
