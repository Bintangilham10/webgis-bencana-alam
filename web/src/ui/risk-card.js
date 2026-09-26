import { faultDisplayName } from '../layers/reference.js';
import { escapeHtml, formatDay, formatDecimal } from '../lib/format.js';
import { HAZARD_CLASSES, VOLCANO_LEVELS, WARNING_LEVEL_STYLES } from '../lib/symbology.js';

const HAZARD_NAMES = { banjir: 'Banjir', longsor: 'Tanah longsor' };

const coordinateText = (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

function header(title, subtitle, status = '') {
  return `
    <header class="risk-card__header">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p class="risk-card__subtitle">${subtitle}</p>
        <p class="risk-card__status" role="status">${escapeHtml(status)}</p>
      </div>
      <button type="button" class="risk-card__close" data-action="close" aria-label="Tutup profil risiko">×</button>
    </header>`;
}

// Panjang batang = nilai indeks (0–1); angka dan label kelas selalu ditulis,
// jadi informasi tidak bergantung pada warna saja.
function hazardRow(h) {
  let value;
  let bar = '';
  if (h.error) {
    value = '<span class="muted">Gagal dimuat dari InaRISK</span>';
  } else if (!h.class) {
    value = '<span class="muted">Di luar zona bahaya</span>';
  } else {
    const { rgb } = HAZARD_CLASSES.find((c) => c.id === h.class.id);
    bar = `<span class="meter-fill" style="width:${Math.round(h.index * 100)}%;background:rgb(${rgb.join(',')})"></span>`;
    // 3 desimal = presisi aturan kelas BNPB, jadi angka dan label selalu selaras.
    value = `<strong>${formatDecimal(h.index, 3)}</strong> ${escapeHtml(h.class.label)}`;
  }
  return `
    <li>
      <span class="hazard-name">${escapeHtml(h.label)}</span>
      <span class="meter" aria-hidden="true">${bar}</span>
      <span class="hazard-value">${value}</span>
    </li>`;
}

function indicationRow(i) {
  const style = WARNING_LEVEL_STYLES[i.level];
  return `
    <li>
      <span class="level-chip" style="background:${style.color};color:${style.text}">${escapeHtml(i.label)}</span>
      <span><strong>${HAZARD_NAMES[i.hazard] ?? escapeHtml(i.hazard)}</strong> — ${escapeHtml(i.reason)}</span>
    </li>`;
}

function rainTable(rain) {
  if (rain.error || !rain.days.length) return '<p class="muted">Prakiraan hujan sedang tidak tersedia.</p>';
  const cells = (render) => rain.days.map((d) => `<td>${render(d)}</td>`).join('');
  return `
    <table class="rain-table">
      <thead><tr>${rain.days.map((d) => `<th scope="col">${formatDay(d.date)}</th>`).join('')}</tr></thead>
      <tbody>
        <tr>${cells((d) => (d.precipitation_mm == null ? '–' : `<strong>${formatDecimal(d.precipitation_mm)} mm</strong>`))}</tr>
        <tr>${cells((d) => escapeHtml(d.category?.label ?? 'Tidak hujan'))}</tr>
        <tr class="muted">${cells((d) => (d.probability_pct == null ? '' : `peluang ${d.probability_pct}%`))}</tr>
      </tbody>
    </table>`;
}

function nearbyList(profile) {
  const fault = profile.nearest_fault;
  const volcanoes = profile.nearest_volcanoes;
  const quakes = profile.recent_quakes;
  const faultText = fault
    ? `${escapeHtml(faultDisplayName(fault.nama))} (segmen ${escapeHtml(fault.segmen)}) — <strong>${formatDecimal(fault.distance_km)} km</strong>, magnitudo maksimum M ${formatDecimal(fault.mmax)}`
    : 'Tidak ada data';
  const volcanoText = volcanoes.length
    ? volcanoes
        .map((v) => `${escapeHtml(v.nama)} <strong>${formatDecimal(v.distance_km)} km</strong> (${VOLCANO_LEVELS[v.level].label})`)
        .join('<br>')
    : 'Tidak ada data';
  const quakeText = quakes.count
    ? `${quakes.count} kejadian; terbesar M ${formatDecimal(quakes.strongest.magnitude)} berjarak ${formatDecimal(quakes.strongest.distance_km)} km`
    : 'Tidak ada gempa tercatat';
  return `
    <dl class="nearby">
      <dt>Sesar aktif terdekat</dt><dd>${faultText}</dd>
      <dt>Gunung api terdekat</dt><dd>${volcanoText}</dd>
      <dt>Gempa ${quakes.days} hari terakhir, radius ${quakes.radius_km} km</dt><dd>${quakeText}</dd>
    </dl>`;
}

// lat/lon = titik yang diklik; location dari server memakai koordinat sel cache.
function profileHtml(profile, { label, lat = profile.location.lat, lon = profile.location.lon }) {
  const { location } = profile;
  const place = location.wilayah
    ? `${escapeHtml(location.wilayah.nama)}, ${escapeHtml(location.wilayah.provinsi)}`
    : 'Di luar batas kabupaten/kota (perairan?)';
  const elevation = location.elevation_m == null ? '' : ` · elevasi ${formatDecimal(location.elevation_m, 0)} m dpl`;
  return `
    ${header(label ?? 'Profil risiko lokasi', `${place}<br><span class="muted">${coordinateText(lat, lon)}${elevation}</span>`)}
    <div class="risk-body">
      <section>
        <h3>Indeks bahaya <small>InaRISK BNPB</small></h3>
        <ul class="hazard-meters">${profile.hazards.map(hazardRow).join('')}</ul>
      </section>
      <section>
        <h3>Indikasi 3 hari ke depan</h3>
        <ul class="indications">${profile.indications.map(indicationRow).join('') || '<li class="muted">Tidak dapat dihitung tanpa prakiraan hujan.</li>'}</ul>
        <p class="risk-note">Aturan awal (hujan × kelas bahaya), belum dikalibrasi. Bukan peringatan resmi.</p>
      </section>
      <section>
        <h3>Prakiraan hujan <small>Open-Meteo</small></h3>
        ${rainTable(profile.rain)}
      </section>
      <section>
        <h3>Sekitar lokasi</h3>
        ${nearbyList(profile)}
        <button type="button" class="link-button" data-action="fit">Tampilkan jarak di peta</button>
      </section>
      <section>
        <h3>Saran kesiapsiagaan</h3>
        <ul class="tips">${profile.recommendations.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
      </section>
    </div>
    <footer class="risk-card__footer">
      Indikasi sistem, bukan peringatan resmi — ikuti BMKG, PVMBG, dan BPBD.
      Sumber: InaRISK BNPB, Open-Meteo (CC BY 4.0), PuSGeN 2024, MAGMA, BMKG. Aturan ${escapeHtml(profile.rules_version)}.
    </footer>`;
}

export function createRiskCard(element, { onClose, onFit }) {
  element.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') onClose();
    if (action === 'fit') onFit();
  });

  const show = (html) => {
    element.innerHTML = html;
    element.classList.remove('is-loading');
    element.hidden = false;
  };

  return {
    // Hasil sebelumnya tetap tampil (diredupkan) selama hasil baru dimuat,
    // supaya tata letak tidak meloncat.
    showLoading({ lat, lon, label }) {
      if (!element.hidden && element.querySelector('.risk-body')) {
        element.classList.add('is-loading');
        element.querySelector('.risk-card__status').textContent = 'Menganalisis lokasi baru…';
        return;
      }
      show(`${header(label ?? 'Profil risiko lokasi', coordinateText(lat, lon), 'Menganalisis lokasi… (indeks bahaya, cuaca, dan kedekatan)')}`);
    },
    render: (profile, options = {}) => show(profileHtml(profile, options)),
    showError: (message) => show(header('Cek risiko gagal', escapeHtml(message))),
    showMessage: (message) => show(header('Cek risiko lokasi', escapeHtml(message))),
    hide() {
      element.hidden = true;
      element.innerHTML = '';
    },
  };
}
