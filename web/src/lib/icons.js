// Ikon garis 24×24 yang mengikuti warna teks (currentColor). Dibuat sendiri
// supaya tidak menambah dependensi pustaka ikon.
const icon = (paths) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const icons = {
  activity: icon('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  alert: icon('<path d="M10.3 4 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>'),
  arrowLeft: icon('<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>'),
  building: icon('<path d="M5 21V4.5L12 2l7 2.5V21"/><path d="M3 21h18"/><path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01"/>'),
  check: icon('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  chevronDown: icon('<path d="m6 9 6 6 6-6"/>'),
  external: icon('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
  extent: icon('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>'),
  fault: icon('<path d="M13 2 9.5 8.5l4 3-3.5 5 2 5.5"/>'),
  info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.5h.01"/>'),
  layers: icon('<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>'),
  list: icon('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  locate: icon('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>'),
  map: icon('<path d="m9 4.5-6 2v13l6-2 6 2 6-2v-13l-6 2-6-2z"/><path d="M9 4.5v13M15 6.5v13"/>'),
  minus: icon('<path d="M5 12h14"/>'),
  moon: icon('<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>'),
  mountain: icon('<path d="m2.5 20 7-12.5 3.5 6 2.5-3.5 6 10z"/>'),
  phone: icon('<path d="M5 3.5h3.5l2 5-2.5 1.6a11 11 0 0 0 5.9 5.9l1.6-2.5 5 2V19a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2z"/>'),
  pin: icon('<path d="M12 21.5s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  quake: icon('<path d="M2 12h3.5l2-4.5 3 10 3-13 3 12 2-4.5H22"/>'),
  refresh: icon('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
  search: icon('<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/>'),
  sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
};
