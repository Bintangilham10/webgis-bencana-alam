import { escapeHtml } from '../lib/format.js';
import { icons } from '../lib/icons.js';

// Tab Lapisan dibangun dari daftar grup, jadi layer baru cukup didaftarkan di
// main.js. Grup biasa berupa sakelar; grup `exclusive` berupa pilihan tunggal
// (petak berikon) karena raster peta rawan saling menutupi bila dinyalakan
// bersamaan. Legenda peta mengikuti layer yang aktif.
export function createLayerPanel({ map, container, legend, groups }) {
  const active = new Set();

  const updateLegend = () =>
    legend.setBlocks(
      groups
        .flatMap((group) => group.items)
        .filter((item) => active.has(item) && item.legend)
        .map((item) => ({ title: item.legendTitle ?? item.label, icon: item.icon, html: item.legend() })),
    );

  const setActive = (item, on) => {
    if (on) {
      item.layer.addTo(map);
      active.add(item);
    } else {
      map.removeLayer(item.layer);
      active.delete(item);
    }
  };

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
    const options = [{ label: 'Tidak ada', icon: icons.none }, ...group.items];
    wrap.innerHTML = `
      <div class="choice-grid" role="radiogroup" aria-label="${escapeHtml(group.title)}">
        ${options
          .map(
            (option, index) => `
              <label class="choice">
                <input type="radio" name="layer-${group.id}" value="${index}"${index === 0 ? ' checked' : ''} />
                <span>${option.icon ?? ''}${escapeHtml(option.label)}</span>
              </label>`,
          )
          .join('')}
      </div>
      ${
        group.opacity === undefined
          ? ''
          : `<label class="range-row" hidden>
               Transparansi
               <input type="range" min="0.2" max="1" step="0.05" value="${group.opacity}" />
               <output>${Math.round(group.opacity * 100)}%</output>
             </label>`
      }`;

    const range = wrap.querySelector('.range-row');
    wrap.querySelector('.choice-grid').addEventListener('change', (event) => {
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
