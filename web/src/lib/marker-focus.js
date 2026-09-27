import { flyToPoint } from './motion.js';

const HIGHLIGHT_MS = 1_600;
const POPUP_MAX_WIDTH = 320;
// Di layar sempit popup dipersempit supaya tidak menabrak bilah alat kanan.
const POPUP_SIDE_ROOM = 120;
// Satu peta hanya menunggu satu popup: klik penanda lain membatalkan yang lama.
const pendingOpen = new WeakMap();

// Klik penanda (atau Enter saat difokus keyboard): peta terbang mendekat, lalu
// popup dibuka setelah peta berhenti dan penanda disorot sebentar. Popup
// diikat saat dibuka dan dilepas saat ditutup, jadi klik berikutnya kembali
// lewat animasi terbang, bukan langsung membuka popup.
// Mengembalikan open({ fly }) untuk dipanggil dari daftar di panel samping.
export function makeFocusable(map, marker, { zoom, popup, viewPadding = () => ({}) }) {
  function show() {
    const maxWidth = Math.min(POPUP_MAX_WIDTH, window.innerWidth - POPUP_SIDE_ROOM);
    marker.bindPopup(popup(), { maxWidth }).openPopup();
    highlight(marker);
  }

  function open({ fly = true } = {}) {
    if (marker.isPopupOpen()) return;
    const pending = pendingOpen.get(map);
    if (pending) map.off('moveend', pending);
    if (!fly) {
      show();
      return;
    }
    map.closePopup();
    pendingOpen.set(map, show);
    // Didaftarkan sebelum terbang: tanpa animasi, moveend langsung terpicu.
    map.once('moveend', show);
    flyToPoint(map, marker.getLatLng(), Math.max(map.getZoom(), zoom), viewPadding());
  }

  marker.on('click', () => open());
  marker.on('keypress', (event) => {
    if (event.originalEvent.key === 'Enter') open();
  });
  marker.on('popupclose', () => marker.unbindPopup());
  return open;
}

// Cincin biru (warna pilihan) memancar dua kali dari penanda yang dituju.
function highlight(marker) {
  const symbol = marker.getElement()?.firstElementChild;
  if (!symbol) return;
  symbol.classList.remove('is-focused');
  void symbol.offsetWidth; // mulai ulang animasi bila penanda yang sama dipilih lagi
  symbol.classList.add('is-focused');
  setTimeout(() => symbol.classList.remove('is-focused'), HIGHLIGHT_MS);
}
