import { escapeHtml } from '../lib/format.js';

// Tab Lapisan dikelompokkan per fitur SIGAP (gempa, gunung api, hujan, …).
// Deretan tombol di atas memilih satu fitur; isinya dibagi jadi bagian
// (biasanya "Utama" untuk lembaga Indonesia dan "Pembanding" untuk data luar
// negeri). Layer baru cukup didaftarkan di main.js.
//
// Bagian biasa berupa sakelar; bagian `exclusive` berupa pilihan tunggal (chip).
// Item `rawan: true` (raster peta rawan) juga saling menggantikan walau berada
// di fitur berbeda, karena warnanya saling menutupi bila dinyalakan bersamaan.
// Satu item boleh muncul di beberapa fitur (mis. GDACS); sakelarnya ikut sinkron.
// Item dengan `on: true` menyala sejak awal. Legenda peta mengikuti layer aktif.
export function createLayerPanel({ map, container, legend, features, rawanOpacity }) {
  const active = new Set();
  const sections = features.flatMap((feature) => feature.sections);
  const items = [...new Set(sections.flatMap((section) => section.items))];
  const rawanItems = items.filter((item) => item.rawan);
  const exclusiveSectionOf = new Map(
    sections.filter((section) => section.exclusive).flatMap((section) => section.items.map((item) => [item, section])),
  );

  const switches = new Map(items.map((item) => [item, []]));
  const radios = new Map();
  const noneRadios = new Map();
  const tabs = new Map();
  const ranges = [];

  // Item lain yang harus padam saat `item` menyala.
  const rivals = (item) => {
    if (item.rawan) return rawanItems.filter((other) => other !== item);
    const section = exclusiveSectionOf.get(item);
    return section ? section.items.filter((other) => other !== item) : [];
  };

  const setActive = (item, on) => {
    if (on === active.has(item)) return;
    if (on) {
      rivals(item).forEach((other) => setActive(other, false));
      active.add(item);
      item.layer.addTo(map);
    } else {
      active.delete(item);
      map.removeLayer(item.layer);
    }
  };

  // Sakelar, pilihan, penanda jumlah di tombol fitur, dan legenda dibaca ulang
  // dari himpunan `active`, jadi selalu cocok dengan peta.
  function render() {
    for (const [item, inputs] of switches) inputs.forEach((input) => (input.checked = active.has(item)));
    for (const section of sections.filter((s) => s.exclusive)) {
      const chosen = section.items.find((item) => active.has(item));
      (chosen ? radios.get(chosen) : noneRadios.get(section)).checked = true;
    }
    for (const feature of features) {
      const count = new Set(feature.sections.flatMap((s) => s.items).filter((item) => active.has(item))).size;
      const badge = tabs.get(feature).querySelector('.feature-count');
      badge.textContent = count;
      badge.hidden = count === 0;
    }
    for (const { row, feature } of ranges) {
      row.hidden = !feature.sections.some((s) => s.items.some((item) => item.rawan && active.has(item)));
    }
    legend.setBlocks(
      items
        .filter((item) => active.has(item) && item.legend)
        .map((item) => ({ title: item.legendTitle ?? item.label, html: item.legend() })),
    );
  }

  // Lapisan juga bisa dinyalakan dari luar panel (menu filter di bilah alat,
  // pilihan di daftar Ikhtisar), jadi panel mengikuti peta.
  map.on('layeradd layerremove', ({ layer }) => {
    const item = items.find((candidate) => candidate.layer === layer);
    if (!item || map.hasLayer(layer) === active.has(item)) return;
    if (map.hasLayer(layer)) {
      active.add(item);
      rivals(item).forEach((other) => setActive(other, false));
    } else active.delete(item);
    render();
  });

  function switchList(section) {
    const list = document.createElement('ul');
    list.className = 'switch-list';
    for (const item of section.items) {
      const row = document.createElement('li');
      row.innerHTML = `
        <label class="switch-row">
          <span class="switch-symbol" aria-hidden="true">${item.symbol ?? ''}</span>
          <span class="switch-text">
            <span class="switch-label">${escapeHtml(item.label)}</span>
            ${item.description ? `<span class="switch-desc">${escapeHtml(item.description)}</span>` : ''}
          </span>
          <input type="checkbox" role="switch" class="switch" />
        </label>`;
      const input = row.querySelector('input');
      switches.get(item).push(input);
      input.addEventListener('change', () => {
        setActive(item, input.checked);
        render();
        // Warna peta rawan hanya bisa dibaca dengan legendanya.
        if (item.rawan && input.checked) legend.setExpanded(true);
      });
      list.append(row);
    }
    return list;
  }

  function choiceGroup(section) {
    const wrap = document.createElement('div');
    wrap.className = 'choice-chips';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', section.label ?? section.title);
    const options = [{ label: 'Tidak ada' }, ...section.items];
    wrap.innerHTML = options
      .map(
        (option, index) => `
          <label class="choice">
            <input type="radio" name="layer-${section.id}" value="${index}" />
            <span>${escapeHtml(option.label)}</span>
          </label>`,
      )
      .join('');
    const inputs = wrap.querySelectorAll('input');
    noneRadios.set(section, inputs[0]);
    section.items.forEach((item, index) => radios.set(item, inputs[index + 1]));
    wrap.addEventListener('change', (event) => {
      const chosen = options[Number(event.target.value)];
      section.items.forEach((item) => setActive(item, item === chosen));
      render();
      if (section.items.includes(chosen)) legend.setExpanded(true);
    });
    return wrap;
  }

  // Satu nilai transparansi untuk semua peta rawan; penggesernya muncul di
  // fitur yang peta rawannya sedang tampil.
  function opacityRow(feature) {
    const row = document.createElement('label');
    row.className = 'range-row';
    row.innerHTML = `
      Transparansi peta rawan
      <input type="range" min="0.2" max="1" step="0.05" value="${rawanOpacity}" />
      <output>${Math.round(rawanOpacity * 100)}%</output>`;
    row.querySelector('input').addEventListener('input', (event) => {
      const value = Number(event.target.value);
      rawanItems.forEach((item) => item.layer.setOpacity(value));
      for (const other of ranges) {
        other.row.querySelector('input').value = value;
        other.row.querySelector('output').textContent = `${Math.round(value * 100)}%`;
      }
    });
    ranges.push({ row, feature });
    return row;
  }

  const tabList = document.createElement('div');
  tabList.className = 'feature-tabs';
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', 'Fitur');
  const panels = document.createElement('div');

  function select(feature, { focus = false } = {}) {
    for (const [other, tab] of tabs) {
      const selected = other === feature;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tab.focus();
    }
  }

  for (const feature of features) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'feature-tab';
    tab.id = `feature-tab-${feature.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `feature-panel-${feature.id}`);
    tab.innerHTML = `
      ${feature.icon ?? ''}
      <span class="feature-name">${escapeHtml(feature.title)}</span>
      <span class="feature-count" hidden></span>`;
    tab.addEventListener('click', () => select(feature));
    tabs.set(feature, tab);
    tabList.append(tab);

    const panel = document.createElement('div');
    panel.className = 'feature-panel';
    panel.id = `feature-panel-${feature.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.hidden = true;
    panel.innerHTML = `
      <div class="feature-head">
        <h2 class="feature-title">${escapeHtml(feature.heading ?? feature.title)}</h2>
        ${feature.note ? `<span class="section-meta">${escapeHtml(feature.note)}</span>` : ''}
      </div>
      ${feature.description ? `<p class="section-note feature-desc">${escapeHtml(feature.description)}</p>` : ''}`;
    for (const section of feature.sections) {
      const block = document.createElement('section');
      block.className = 'section';
      if (section.title) {
        block.innerHTML = `
          <div class="section-head">
            <h3 class="section-title">${escapeHtml(section.title)}</h3>
            ${section.note ? `<span class="section-meta">${escapeHtml(section.note)}</span>` : ''}
          </div>`;
      }
      if (section.items.length) block.append(section.exclusive ? choiceGroup(section) : switchList(section));
      if (section.description) block.insertAdjacentHTML('beforeend', `<p class="section-note">${escapeHtml(section.description)}</p>`);
      panel.append(block);
    }
    if (feature.sections.some((s) => s.items.some((item) => item.rawan))) panel.append(opacityRow(feature));
    panels.append(panel);
  }

  // Panah kiri/kanan, Home, End berpindah antar tombol fitur (pola tablist).
  tabList.addEventListener('keydown', (event) => {
    const index = features.findIndex((feature) => tabs.get(feature) === document.activeElement);
    if (index < 0) return;
    const last = features.length - 1;
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(features[(next + features.length) % features.length], { focus: true });
  });

  container.append(tabList, panels);
  items.filter((item) => item.on).forEach((item) => setActive(item, true));
  select(features[0]);
  render();
}
