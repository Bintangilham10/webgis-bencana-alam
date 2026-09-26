// Panel samping berisi tampilan utama (tab) atau detail cek risiko. Di layar
// sempit panel menjadi lembar bawah (bottom sheet): ketuk atau geser pegangannya
// untuk memperluas/mengecilkan.
const MOBILE_QUERY = '(max-width: 767.98px)';
const EXPANDED_RATIO = 0.62;
const SWIPE_THRESHOLD_PX = 24;

export function createSidebar({ element, app, handle, mainView, detailView }) {
  const mobile = window.matchMedia(MOBILE_QUERY);
  const handleLabel = handle.querySelector('.visually-hidden');
  // Satu sumber untuk tinggi lembar yang diperluas: dipakai CSS dan viewPadding.
  element.style.setProperty('--sheet-expanded', `${EXPANDED_RATIO * 100}%`);
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
    // Tinggi bagian peta yang tertutup lembar bawah (0 di desktop, karena panel
    // berada di samping peta).
    coveredHeight({ expanded: asExpanded = expanded } = {}) {
      if (!mobile.matches) return 0;
      return asExpanded ? Math.round(app.clientHeight * EXPANDED_RATIO) : peekHeight();
    },
  };
}
