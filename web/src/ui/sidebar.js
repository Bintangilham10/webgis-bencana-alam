// Panel samping berisi tampilan utama (tab) atau detail cek risiko. Di layar
// sempit panel menjadi lembar bawah (bottom sheet): ketuk atau geser pegangannya
// untuk memperluas/mengecilkan. Gerakannya diatur CSS (transform + pegas).
const MOBILE_QUERY = '(max-width: 767.98px)';
const EXPANDED_RATIO = 0.62;
const SWIPE_THRESHOLD_PX = 24;

export function createSidebar({ element, handle, mainView, detailView }) {
  const mobile = window.matchMedia(MOBILE_QUERY);
  const handleLabel = handle.querySelector('.visually-hidden');
  // Satu sumber untuk tinggi lembar yang diperluas: dipakai CSS dan viewPadding.
  element.style.setProperty('--sheet-ratio', String(EXPANDED_RATIO));
  let expanded = false;

  function setExpanded(value) {
    expanded = value;
    element.classList.toggle('is-expanded', value);
    handle.setAttribute('aria-expanded', String(value));
    handleLabel.textContent = value ? 'Perkecil panel' : 'Perluas panel';
  }

  let startY = null;
  let swiped = false;
  handle.addEventListener('pointerdown', (event) => {
    startY = event.clientY;
    swiped = false;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointerup', (event) => {
    if (startY === null) return;
    const dy = event.clientY - startY;
    startY = null;
    if (Math.abs(dy) >= SWIPE_THRESHOLD_PX) {
      swiped = true;
      setExpanded(dy < 0);
    }
  });
  handle.addEventListener('click', () => {
    if (!swiped) setExpanded(!expanded);
    swiped = false;
  });

  // Isi yang terlipat berada di bawah layar; perluas saat fokus keyboard masuk.
  element.addEventListener('focusin', (event) => {
    if (mobile.matches && !expanded && event.target !== handle) setExpanded(true);
  });

  const peekHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) || 0;

  return {
    isMobile: () => mobile.matches,
    isDetailOpen: () => !detailView.hidden,
    expand: () => mobile.matches && setExpanded(true),
    collapse: () => mobile.matches && setExpanded(false),
    showDetail() {
      mainView.hidden = true;
      detailView.hidden = false;
      if (mobile.matches) setExpanded(true);
    },
    showMain() {
      detailView.hidden = true;
      mainView.hidden = false;
    },
    // Tinggi bagian bawah peta yang tertutup lembar (0 di desktop: panel di samping).
    coveredHeight({ expanded: asExpanded = expanded } = {}) {
      if (!mobile.matches) return 0;
      return asExpanded ? Math.round(window.innerHeight * EXPANDED_RATIO) : peekHeight();
    },
  };
}
