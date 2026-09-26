// Tab sesuai pola ARIA "tabs": klik, atau panah kiri/kanan, Home, dan End.
// Penanda tab aktif meluncur ke tab yang dipilih.
export function createTabs(tablist, { onChange } = {}) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const indicator = document.createElement('span');
  indicator.className = 'tab-indicator no-transition';
  indicator.setAttribute('aria-hidden', 'true');
  tablist.prepend(indicator);

  function placeIndicator() {
    const tab = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    if (!tab?.offsetWidth) return;
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  // Posisi awal tanpa animasi; transisi baru aktif setelah frame pertama.
  placeIndicator();
  requestAnimationFrame(() => indicator.classList.remove('no-transition'));
  // Panel bisa tersembunyi (detail terbuka) lalu tampil lagi: hitung ulang saat ukuran berubah.
  new ResizeObserver(placeIndicator).observe(tablist);

  function select(tab, { focus = false } = {}) {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    }
    placeIndicator();
    if (focus) tab.focus();
    onChange?.(tab.id);
  }

  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tab);
  });

  tablist.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], { focus: true });
  });

  return { select: (id) => select(tabs.find((t) => t.id === id)) };
}
