// Tema gelap (bawaan) dan terang. Pilihan pengguna disimpan di localStorage;
// index.html sudah menerapkannya sebelum halaman digambar supaya tidak berkedip.
const STORAGE_KEY = 'sigap-theme';
const THEME_COLORS = { dark: '#141518', light: '#ffffff' };
const TRANSITION_MS = 450;

const listeners = new Set();
let transitionTimer;

export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

export function setTheme(theme) {
  const root = document.documentElement;
  // Kelas sementara ini memberi transisi warna yang halus saat berganti tema.
  root.classList.add('theme-transition');
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Penyimpanan diblokir (mode privat): tema tetap berlaku untuk sesi ini.
  }
  listeners.forEach((listener) => listener(theme));
  clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), TRANSITION_MS);
}

export function onThemeChange(listener) {
  listeners.add(listener);
}

// Nilai variabel CSS tema aktif, untuk layer canvas yang tidak bisa diwarnai lewat CSS.
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
