import { escapeHtml } from '../lib/format.js';

// Panel dibangun dari daftar grup, jadi layer baru cukup didaftarkan di main.js.
// Grup `exclusive` berupa pilihan tunggal (mis. peta rawan: satu bahaya sekaligus
// supaya raster tidak saling menutupi).
export function createLayerPanel({ map, container, legendElement, groups }) {
  const active = new Set();

  const renderLegend = () => {
    const blocks = groups
      .flatMap((group) => group.items)
      .filter((item) => active.has(item) && item.legend)
      .map((item) => `<div class="legend-block"><h3>${escapeHtml(item.label)}</h3>${item.legend()}</div>`);
    legendElement.innerHTML = blocks.join('') || '<p class="muted">Tidak ada layer aktif.</p>';
  };

  const setActive = (item, on) => {
    if (on) {
      item.layer.addTo(map);
      active.add(item);
    } else {
      map.removeLayer(item.layer);
      active.delete(item);
    }
  };

  for (const group of groups) {
    const section = document.createElement('div');
    section.className = 'layer-group';
    section.innerHTML = `<h2>${escapeHtml(group.title)}${group.note ? ` <small>${escapeHtml(group.note)}</small>` : ''}</h2>`;

    const options = group.exclusive
      ? [{ label: 'Tidak ditampilkan', on: !group.items.some((item) => item.on) }, ...group.items]
      : group.items;

    for (const option of options) {
      const label = document.createElement('label');
      label.className = 'layer-toggle';
      const input = document.createElement('input');
      input.type = group.exclusive ? 'radio' : 'checkbox';
      input.name = `layer-${group.id}`;
      input.checked = Boolean(option.on);
      input.addEventListener('change', () => {
        if (group.exclusive) group.items.forEach((item) => setActive(item, item === option));
        else setActive(option, input.checked);
        renderLegend();
      });
      label.append(input, document.createTextNode(option.label));
      section.append(label);
      if (option.on && option.layer) setActive(option, true);
    }

    if (group.opacity !== undefined) {
      const label = document.createElement('label');
      label.className = 'opacity-control';
      label.textContent = 'Transparansi';
      const slider = document.createElement('input');
      Object.assign(slider, { type: 'range', min: 0.2, max: 1, step: 0.05, value: group.opacity });
      slider.addEventListener('input', () => group.items.forEach((item) => item.layer.setOpacity(Number(slider.value))));
      label.append(slider);
      section.append(label);
    }
    container.append(section);
  }
  renderLegend();
}
