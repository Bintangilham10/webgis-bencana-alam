import { faultDisplayName } from '../layers/reference.js';
import { capitalize, escapeHtml, formatDay, formatDecimal, formatNumber } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { HAZARD_CLASSES, pillStyle, VOLCANO_LEVELS, WARNING_LEVEL_STYLES } from '../lib/symbology.js';

const INDICATION_NAMES = { banjir: 'banjir', longsor: 'tanah longsor' };
// Skala batang hujan: batas bawah hujan ekstrem BMKG (mm/hari).
const RAIN_SCALE_MAX_MM = 150;
const BNPB_CLASS_BOUNDARIES = [1 / 3, 2 / 3];

const coordinateText = (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
const volcanoName = (nama) => (/^gunung\s/i.test(nama) ? nama : `Gunung ${nama}`);
const km = (value) => `${formatDecimal(value)}<small> km</small>`;

function header({ title, place = '', coords = '', status = '' }) {
  return `
    <header class="detail-header">
      <button type="button" class="icon-btn" data-action="close" aria-label="Kembali ke ikhtisar" title="Kembali">${icons.arrowLeft}</button>
      <div class="detail-heading">
        <p class="detail-eyebrow">Profil risiko lokasi</p>
        <h1 class="detail-title" tabindex="-1">${escapeHtml(title)}</h1>
        ${place ? `<p class="detail-place">${place}</p>` : ''}
        ${coords ? `<p class="detail-coords">${coords}</p>` : ''}
        <p class="detail-status" role="status">${escapeHtml(status)}</p>
      </div>
    </header>`;
}

// ---------- Status 3 hari (jawaban utama) ----------
function outlook(indications, rainError) {
  if (!indications.length) {
    return banner(null, 'Indikasi belum tersedia', rainError ? 'Prakiraan hujan gagal dimuat, jadi indikasi 3 hari tidak dapat dihitung.' : 'Tidak ada data prakiraan hujan.');
  }
  const top = Math.max(...indications.map((i) => i.level));
  if (top === 0) {
    return banner(0, 'Normal untuk 3 hari ke depan', 'Prakiraan hujan tidak memicu indikasi banjir atau tanah longsor di titik ini.');
  }
  const worst = indications.filter((i) => i.level === top);
  const names = worst.map((i) => INDICATION_NAMES[i.hazard] ?? i.hazard).join(' dan ');
  return banner(top, `${WARNING_LEVEL_STYLES[top].label}: potensi ${names}`, `${capitalize(worst[0].reason)}.`);
}

function banner(level, title, body) {
  const style = level === null ? { color: '#98a2b3', text: '#fff' } : WARNING_LEVEL_STYLES[level];
  return `
    <div class="outlook" style="--outlook:${style.color};--outlook-fg:${style.text}">
      <span class="outlook-icon">${level === 0 ? icons.check : icons.alert}</span>
      <div>
        <p class="outlook-title">${escapeHtml(title)}</p>
        <p class="outlook-body">${escapeHtml(body)}</p>
      </div>
    </div>`;
}

function indicationList(indications) {
  if (!indications.length) return '';
  return `
    <ul class="indication-list">
      ${indications
        .map((i) => {
          const style = WARNING_LEVEL_STYLES[i.level];
          return `
            <li>
              <span class="level-pill" style="${pillStyle(style)}">${style.label}</span>
              <span><strong>${capitalize(INDICATION_NAMES[i.hazard] ?? i.hazard)}</strong> — ${escapeHtml(i.reason)}</span>
            </li>`;
        })
        .join('')}
    </ul>
    <p class="section-note">Aturan awal v0 (hujan × kelas bahaya), belum dikalibrasi.</p>`;
}

// ---------- Profil bahaya ----------
function hazardSummary(hazards) {
  const notable = hazards.filter((h) => h.class && h.class.id !== 'rendah').sort((a, b) => b.index - a.index);
  if (!notable.length) return '<p class="hazard-summary">Tidak ada bahaya berkategori sedang atau tinggi di titik ini.</p>';
  const list = notable.map((h) => `${escapeHtml(h.label)} (${h.class.label.toLowerCase()})`).join(', ');
  return `<p class="hazard-summary"><strong>Perlu perhatian:</strong> ${list}</p>`;
}

// Batang = nilai indeks 0–1 dengan garis kelas BNPB di 1/3 dan 2/3. Angka dan
// label kelas selalu ditulis, jadi informasi tidak bergantung pada warna.
function meter(index, cls) {
  const fill = cls ? `<span class="meter-fill" style="width:${Math.max(3, Math.round(index * 100))}%;background:${cls.color}"></span>` : '';
  const ticks = BNPB_CLASS_BOUNDARIES.map((b) => `<span class="meter-tick" style="left:${(b * 100).toFixed(1)}%"></span>`).join('');
  return `<span class="meter" aria-hidden="true">${fill}${ticks}</span>`;
}

function hazardRow(h) {
  let value;
  let cls = null;
  if (h.error) value = '<span class="muted">Gagal dimuat</span>';
  else if (!h.class) value = '<span class="muted">Di luar zona bahaya</span>';
  else {
    cls = HAZARD_CLASSES.find((c) => c.id === h.class.id);
    value = `<span class="hazard-index">${formatDecimal(h.index, 3)}</span><span class="class-pill" style="${pillStyle(cls)}">${escapeHtml(h.class.label)}</span>`;
  }
  return `
    <li class="hazard-row">
      <div class="hazard-row__top"><span class="hazard-name">${escapeHtml(h.label)}</span><span class="hazard-value">${value}</span></div>
      ${meter(h.index, cls)}
    </li>`;
}

// ---------- Prakiraan hujan ----------
function rainDays(rain) {
  if (rain.error || !rain.days.length) return '<p class="empty-note">Prakiraan hujan sedang tidak tersedia.</p>';
  const days = rain.days
    .map((d) => {
      const mm = d.precipitation_mm;
      const width = mm > 0 ? Math.max(3, Math.min(100, (mm / RAIN_SCALE_MAX_MM) * 100)) : 0;
      return `
        <div class="rain-day">
          <span class="rain-date">${formatDay(d.date)}</span>
          <span class="rain-mm">${mm == null ? '–' : formatDecimal(mm)}<small> mm</small></span>
          <span class="rain-bar" aria-hidden="true"><span style="width:${width}%"></span></span>
          <span class="rain-cat">${escapeHtml(d.category?.label ?? 'Tidak hujan')}</span>
          ${d.probability_pct == null ? '' : `<span class="rain-prob">Peluang ${d.probability_pct}%</span>`}
        </div>`;
    })
    .join('');
  return `<div class="rain-days">${days}</div><p class="section-note">Batang dibandingkan dengan 150 mm/hari (batas hujan ekstrem BMKG).</p>`;
}

// ---------- Sekitar lokasi ----------
function nearbyRow({ icon, title, meta, distance }) {
  return `
    <li class="nearby-row">
      <span class="nearby-icon">${icon}</span>
      <span class="nearby-text"><span class="nearby-title">${title}</span><span class="nearby-meta">${meta}</span></span>
      ${distance == null ? '' : `<span class="nearby-distance">${km(distance)}</span>`}
    </li>`;
}

function nearby({ nearest_fault: fault, nearest_volcanoes: volcanoes, recent_quakes: quakes }) {
  const faultRows = fault
    ? nearbyRow({
        icon: icons.fault,
        title: escapeHtml(faultDisplayName(fault.nama)),
        meta: `Segmen ${escapeHtml(fault.segmen)} · magnitudo maks. M ${formatDecimal(fault.mmax)}`,
        distance: fault.distance_km,
      })
    : '<li class="empty-note">Tidak ada data sesar.</li>';
  const volcanoRows = volcanoes.length
    ? volcanoes
        .map((v) => {
          const level = VOLCANO_LEVELS[v.level];
          return nearbyRow({
            icon: `<span class="volcano-glyph volcano-glyph--sm" style="--level-color:${level.color}"></span>`,
            title: escapeHtml(volcanoName(v.nama)),
            meta: `<span class="level-pill" style="${pillStyle(level)}">${level.label}</span>`,
            distance: v.distance_km,
          });
        })
        .join('')
    : '<li class="empty-note">Tidak ada data gunung api.</li>';
  const quakeRow = nearbyRow({
    icon: icons.quake,
    title: quakes.count ? `${formatNumber(quakes.count)} gempa tercatat` : 'Tidak ada gempa tercatat',
    meta: quakes.count
      ? `Terbesar M ${formatDecimal(quakes.strongest.magnitude)}, berjarak ${formatDecimal(quakes.strongest.distance_km)} km`
      : `Dalam radius ${quakes.radius_km} km selama ${quakes.days} hari terakhir`,
  });

  return `
    <div class="nearby-group"><h3>Sesar aktif terdekat</h3><ul class="nearby-list">${faultRows}</ul></div>
    <div class="nearby-group"><h3>Gunung api terdekat</h3><ul class="nearby-list">${volcanoRows}</ul></div>
    <div class="nearby-group"><h3>Gempa ${quakes.days} hari terakhir, radius ${quakes.radius_km} km</h3><ul class="nearby-list">${quakeRow}</ul></div>
    <button type="button" class="btn btn-secondary btn-block" data-action="fit">${icons.map}Tampilkan jarak di peta</button>`;
}

function section(title, meta, body) {
  return `
    <section class="detail-section">
      <h2>${title}${meta ? ` <small>${meta}</small>` : ''}</h2>
      ${body}
    </section>`;
}

// lat/lon = titik yang diklik; location dari server memakai koordinat sel cache.
function profileHtml(profile, { label, lat = profile.location.lat, lon = profile.location.lon }) {
  const { location } = profile;
  const { wilayah } = location;
  // Judul hasil pencarian kab/kota ("Kabupaten Garut") tidak diulang di baris tempat.
  let place = 'Di luar batas kabupaten/kota (perairan?)';
  if (wilayah) place = label === wilayah.nama ? escapeHtml(wilayah.provinsi) : `${escapeHtml(wilayah.nama)}, ${escapeHtml(wilayah.provinsi)}`;
  const elevation = location.elevation_m == null ? '' : ` · ${formatNumber(Math.round(location.elevation_m))} m dpl`;
  return `
    ${header({ title: label ?? 'Titik pilihan', place, coords: `${coordinateText(lat, lon)}${elevation}` })}
    <div class="detail-body view-scroll">
      ${outlook(profile.indications, profile.rain.error)}
      ${indicationList(profile.indications)}
      ${section('Bahaya di titik ini', 'InaRISK BNPB', `${hazardSummary(profile.hazards)}<ul class="hazard-list">${profile.hazards.map(hazardRow).join('')}</ul>`)}
      ${section('Prakiraan hujan', 'Open-Meteo', rainDays(profile.rain))}
      ${section('Sekitar lokasi', '', nearby(profile))}
      ${section('Saran kesiapsiagaan', '', `<ul class="tip-list">${profile.recommendations.map((t) => `<li>${icons.check}<span>${escapeHtml(t)}</span></li>`).join('')}</ul>`)}
      <footer class="detail-footer">
        Indikasi sistem, bukan peringatan resmi — ikuti BMKG, PVMBG, dan BPBD setempat.
        Sumber: InaRISK BNPB, Open-Meteo (CC BY 4.0), PuSGeN 2024, MAGMA, BMKG. Aturan ${escapeHtml(profile.rules_version)}.
      </footer>
    </div>`;
}

function skeleton() {
  return `
    <div class="detail-body view-scroll" aria-busy="true">
      <div class="skeleton skeleton--banner"></div>
      <div class="skeleton skeleton--title"></div>
      ${'<div class="skeleton skeleton--meter"></div>'.repeat(5)}
      <div class="skeleton skeleton--title"></div>
      <div class="skeleton-grid">${'<div class="skeleton skeleton--card"></div>'.repeat(3)}</div>
    </div>`;
}

function stateCard(message, { retry = false } = {}) {
  return `
    <div class="detail-body view-scroll">
      <div class="state-card">
        <p>${escapeHtml(message)}</p>
        ${retry ? `<button type="button" class="btn btn-secondary" data-action="retry">${icons.refresh}Coba lagi</button>` : ''}
      </div>
    </div>`;
}

// Detail cek risiko menggantikan isi panel samping (seperti detail tempat di
// Google Maps), jadi peta di kanan tidak tertutup.
export function createRiskDetail(element, { sidebar, onClose, onFit, onRetry }) {
  element.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') onClose();
    else if (action === 'fit') onFit();
    else if (action === 'retry') onRetry();
  });

  function open(html) {
    const opening = element.hidden;
    // Mengganti isi menghapus elemen yang sedang fokus; kembalikan fokus ke judul.
    const hadFocus = element.contains(document.activeElement);
    element.innerHTML = html;
    element.classList.remove('is-refreshing');
    sidebar.showDetail();
    if (opening || hadFocus) element.querySelector('.detail-title')?.focus({ preventScroll: true });
  }

  return {
    // Hasil sebelumnya tetap tampil (diredupkan) selama hasil baru dimuat,
    // supaya tata letak tidak meloncat.
    showLoading({ lat, lon, label }) {
      if (!element.hidden && element.querySelector('.detail-body:not([aria-busy])')) {
        element.classList.add('is-refreshing');
        element.querySelector('.detail-status').textContent = 'Menganalisis lokasi baru…';
        return;
      }
      open(header({ title: label ?? 'Titik pilihan', coords: coordinateText(lat, lon), status: 'Menganalisis bahaya, cuaca, dan kedekatan…' }) + skeleton());
    },
    render: (profile, options = {}) => open(profileHtml(profile, options)),
    showError: (message) => open(header({ title: 'Cek risiko gagal' }) + stateCard(message, { retry: true })),
    showMessage: (message) => open(header({ title: 'Cek risiko lokasi' }) + stateCard(message)),
    hide() {
      element.innerHTML = '';
      element.classList.remove('is-refreshing');
      sidebar.showMain();
    },
  };
}
