import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatClock, formatDasarian, formatDecimal, formatDay, timeAgo } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { NO_DATA_STYLE, pillStyle, WARNING_LEVEL_STYLES } from '../lib/symbology.js';

// Tab Sintesis: status tiap kab/kota dari data resmi (server: routes/sintesis.js),
// peta koroplet status, daftar wilayah yang perlu perhatian, matriks komponen,
// cara hitung per wilayah, dan analisis pendukung.

const REFRESH_MS = 5 * 60_000;
const LIST_SIZE = 12;
const MATRIX_SIZE = 15;
const LEVELS = WARNING_LEVEL_STYLES.map((s) => s.label);
const COMPONENTS = [
  { key: 'cews', name: 'BMKG CEWS', long: 'Peringatan hujan BMKG (CEWS)' },
  { key: 'cap', name: 'BMKG CAP', long: 'Peringatan dini cuaca BMKG (CAP)' },
  { key: 'gunungapi', name: 'Gunung api', long: 'Gunung api PVMBG (MAGMA)' },
  { key: 'gempa', name: 'Gempa', long: 'Gempa BMKG 24 jam' },
];
const COMPONENT = Object.fromEntries(COMPONENTS.map((c) => [c.key, c]));
const INDIKASI = [
  { key: 'hujan', name: 'Hujan' },
  { key: 'banjir', name: 'Banjir' },
  { key: 'longsor', name: 'Longsor' },
];

const shortName = (nama) => nama.replace(/^Kabupaten /, 'Kab. ');
const levelStyle = (level) => (level == null ? NO_DATA_STYLE : WARNING_LEVEL_STYLES[level]);
const pill = (level, label) => `<span class="level-pill" style="${pillStyle(levelStyle(level))}">${escapeHtml(label ?? levelStyle(level).label)}</span>`;
const regionLabel = (r) => (r.state === 'belum_pasti' ? 'Belum pasti' : r.state === 'tanpa_data' ? 'Tanpa data' : LEVELS[r.status]);

// Status yang dipakai tampilan: resmi, atau gabungan dengan indikasi SIGAP.
const shownLevel = (r, view) => (view === 'gabungan' ? r.gabungan : r.status);
const raisedByIndikasi = (r, view) => view === 'gabungan' && r.indikasi !== null && r.indikasi > (r.status ?? 0);

// Kotak hitungan tiap kab/kota (jumlah semua kotak = jumlah kab/kota). Belum
// pasti tetap belum pasti kecuali indikasi menaikkannya di tampilan gabungan.
function bucket(r, view) {
  if (r.state !== 'pasti' && !raisedByIndikasi(r, view)) return 'belum_pasti';
  return ['normal', 'waspada', 'siaga', 'awas'][shownLevel(r, view)];
}

// Penentu yang berupa level resmi (CEWS, atau gunung api di kab/kota lokasinya);
// selain itu aturan SIGAP di atas data resmi.
function isOfficial(r) {
  return r.drivers.some(
    (driver) => driver === 'cews' || (driver === 'gunungapi' && r.bukti.gunungapi.some((v) => v.lokasi && v.level === r.status)),
  );
}

// Kab/kota tampil sebagai level (bukan belum pasti/tanpa data) di tampilan ini.
const isSure = (r, view) => r.state === 'pasti' || raisedByIndikasi(r, view);

// Urutan daftar: level, kejadian sekarang dulu, jumlah komponen menyala, indikasi, nama.
function compareRegions(view) {
  const active = (r) => COMPONENTS.filter((c) => r.c[c.key] > 0).length;
  return (a, b) =>
    (shownLevel(b, view) ?? -1) - (shownLevel(a, view) ?? -1) ||
    (b.sekarang ?? 0) - (a.sekarang ?? 0) ||
    active(b) - active(a) ||
    (b.indikasi ?? -1) - (a.indikasi ?? -1) ||
    a.nama.localeCompare(b.nama, 'id');
}

function driverChips(r) {
  const chips = [];
  const b = r.bukti;
  if (r.c.cews > 0) chips.push(['resmi', `CEWS ${LEVELS[r.c.cews]}`]);
  for (const a of b.cap.slice(0, 1)) chips.push(['aturan', `CAP ${a.severity} s.d. ${formatClock(a.expires).replace(' WIB', '')}`]);
  for (const v of b.gunungapi.slice(0, 1)) chips.push([v.lokasi ? 'resmi' : 'aturan', `G. ${v.nama} L${v.level_magma}${v.lokasi ? '' : ` · ${formatDecimal(v.jarak_km)} km`}`]);
  for (const q of b.gempa.slice(0, 1)) chips.push(['aturan', `M${formatDecimal(q.magnitude)} · ${formatDecimal(q.jarak_km, 0)} km · ${timeAgo(q.occurred_at)}`]);
  return chips.map(([kind, text]) => `<span class="sx-chip sx-chip--${kind}">${escapeHtml(text)}</span>`).join('');
}

function horizonText(r, cewsPrevious) {
  const fmt = (v) => (v === null ? 'belum pasti' : LEVELS[v]);
  return `Sekarang ${fmt(r.sekarang)} · Prakiraan ${fmt(r.prakiraan)}${cewsPrevious && r.prakiraan !== null ? ' (CEWS dasarian lalu)' : ''}`;
}

function regionRow(r, view, selected, cewsPrevious) {
  const level = shownLevel(r, view);
  const raised = raisedByIndikasi(r, view);
  const sure = isSure(r, view);
  const label = sure ? LEVELS[level] : regionLabel(r);
  return `
    <li>
      <button type="button" class="sx-row${selected ? ' is-selected' : ''}" data-region="${escapeHtml(r.kode)}" aria-pressed="${selected}">
        <span class="sx-row__level">${sure ? pill(level, label) : `<span class="level-pill sx-pill--unknown">${escapeHtml(label)}</span>`}${raised ? '<span class="sx-row__note">naik karena indikasi</span>' : r.minimal ? '<span class="sx-row__note" title="Ada sumber tanpa data; status bisa lebih tinggi">minimal</span>' : ''}</span>
        <span class="sx-row__text">
          <span class="sx-row__title">${escapeHtml(shortName(r.nama))} <span class="sx-row__prov">${escapeHtml(r.provinsi)}</span></span>
          <span class="sx-chips">${driverChips(r)}</span>
          <span class="sx-row__meta">${horizonText(r, cewsPrevious)}</span>
        </span>
        ${r.indikasi === null ? '' : `<span class="sx-ind" style="--c:${levelStyle(r.indikasi).color}">Indikasi ${LEVELS[r.indikasi]}</span>`}
      </button>
    </li>`;
}

function matrixCell(value, driver) {
  if (value === null) return '<td><span class="sx-cell sx-cell--nd" title="Tidak ada data">–</span></td>';
  const style = levelStyle(value);
  const css = value > 0 ? `background:${style.color};color:${style.text}` : '';
  return `<td><span class="sx-cell${value === 0 ? ' sx-cell--zero' : ''}${driver ? ' sx-cell--driver' : ''}" style="${css}">${value}</span></td>`;
}

function matrixHtml(rows) {
  if (!rows.length) return '';
  return `
    <div class="sx-section">
      <h3 class="sx-title">Matriks komponen</h3>
      <p class="sx-note">0–3 = Normal–Awas. Garis putih = komponen penentu status. "–" = tidak ada data (tidak dianggap aman).</p>
      <div class="sx-table-wrap">
        <table class="sx-table">
          <thead>
            <tr class="sx-table__group"><th scope="col"></th><th scope="colgroup" colspan="5">Resmi (BMKG · PVMBG)</th><th scope="colgroup" colspan="4">Indikasi SIGAP 3 hari</th></tr>
            <tr>
              <th scope="col"><span class="visually-hidden">Kab/kota</span></th>
              ${COMPONENTS.map((c) => `<th scope="col">${c.key === 'gunungapi' ? 'Gn. api' : c.name.replace('BMKG ', '')}</th>`).join('')}
              <th scope="col" class="sx-strong">Status</th>
              ${INDIKASI.map((h) => `<th scope="col">${h.name}</th>`).join('')}
              <th scope="col" class="sx-strong">Indikasi</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r) => `<tr>
                  <th scope="row"><button type="button" class="sx-link" data-region="${escapeHtml(r.kode)}">${escapeHtml(shortName(r.nama))}</button></th>
                  ${COMPONENTS.map((c) => matrixCell(r.c[c.key], r.drivers.includes(c.key))).join('')}
                  ${matrixCell(r.status)}
                  ${INDIKASI.map((h) => matrixCell(r.ind[h.key])).join('')}
                  ${matrixCell(r.indikasi)}
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function evidenceText(r, key, data) {
  const b = r.bukti;
  const v = r.c[key];
  if (v === null) {
    if (key === 'cews') return 'Tidak ada data: produk dasarian belum terbit atau gagal dimuat dari BMKG.';
    return 'Tidak ada data: sinkronisasi sumber ini gagal terlalu lama.';
  }
  if (key === 'cews') {
    const cews = data.sources.cews;
    const which = cews.sebelumnya
      ? `dasarian sebelumnya (${formatDasarian(cews.dasarian, { short: true })}), karena dasarian berjalan belum diterbitkan BMKG`
      : `dasarian ${formatDasarian(cews.dasarian, { short: true })}`;
    return v > 0 ? `Tercantum ${LEVELS[v]} di peringatan curah hujan tinggi ${which}.` : `Tidak tercantum di peringatan ${which}.`;
  }
  if (key === 'cap') {
    if (!b.cap.length) return 'Tidak ada peringatan yang sedang berlaku.';
    return b.cap.map((a) => `${a.event} (${a.severity} → ${LEVELS[a.level]}), berlaku s.d. ${formatClock(a.expires)}`).join('; ');
  }
  if (key === 'gunungapi') {
    if (!b.gunungapi.length) return 'Tidak ada gunung api Waspada ke atas di kab/kota ini atau dalam radiusnya.';
    return b.gunungapi
      .map((g) => `G. ${g.nama} Level ${['I', 'II', 'III', 'IV'][g.level_magma - 1]} → ${LEVELS[g.level]}, ${g.lokasi ? 'berada di kab/kota ini' : `${formatDecimal(g.jarak_km)} km dari batasnya`}${g.erupsi ? ' · sedang erupsi' : ''}`)
      .join('; ');
  }
  if (!b.gempa.length) return 'Tidak ada gempa BMKG 24 jam terakhir dalam radius aturan.';
  return b.gempa
    .map((q) => `M${formatDecimal(q.magnitude)} ${formatDecimal(q.jarak_km, 0)} km dari batas, ${timeAgo(q.occurred_at)}${q.tsunami ? ', berpotensi tsunami' : ''} → ${LEVELS[q.level]} (${q.aturan}, ≤ ${q.radius_km} km)`)
    .join('; ');
}

const PROVENANCE = {
  cews: 'Level resmi BMKG · prakiraan 10 hari',
  cap: 'Data resmi BMKG + aturan SIGAP · sekarang (±2 jam)',
  gunungapi: 'Level resmi PVMBG (lokasi gunung) atau aturan radius SIGAP · sekarang',
  gempa: 'Data resmi BMKG + aturan jarak SIGAP · 24 jam terakhir',
};

function detailHtml(r, data) {
  const n = (v) => (v === null ? 'ND' : v);
  const why =
    r.state === 'tanpa_data'
      ? 'Semua sumber tanpa data, jadi status tidak dapat ditentukan.'
      : r.state === 'belum_pasti'
        ? `Belum pasti: komponen yang ada Normal, tetapi ${COMPONENTS.filter((c) => r.c[c.key] === null)
            .map((c) => c.name)
            .join(', ')} tanpa data.`
        : r.status > 0
          ? `${LEVELS[r.status]} karena ${r.drivers.map((d) => COMPONENT[d].long).join(' dan ')}${isOfficial(r) ? ' (ada level resmi)' : ' (aturan SIGAP pada data resmi)'}.`
          : 'Normal: tidak ada komponen yang menyala.';
  const ind = r.bukti.indikasi;
  const minimalNote = r.minimal
    ? ` Ini batas bawah: ${COMPONENTS.filter((c) => r.c[c.key] === null).map((c) => c.name).join(', ')} tanpa data, jadi status sebenarnya bisa lebih tinggi.`
    : '';
  return `
    <div class="sx-detail" aria-labelledby="sx-detail-title">
      <div class="sx-detail__head">
        <div>
          <span class="sx-label">Cara hitung</span>
          <h3 id="sx-detail-title" class="sx-detail__title">${escapeHtml(shortName(r.nama))}</h3>
          <span class="sx-note">${escapeHtml(r.provinsi)}</span>
        </div>
        <div class="sx-detail__actions">
          ${r.state === 'pasti' ? pill(r.status) : `<span class="level-pill sx-pill--unknown">${regionLabel(r)}</span>`}
          <button type="button" class="icon-btn" data-action="sx-close" aria-label="Tutup cara hitung">${icons.close}</button>
        </div>
      </div>
      <p class="sx-why">${escapeHtml(why + minimalNote)}</p>
      <pre class="sx-formula">Status   = max( max(CEWS ${n(r.c.cews)}, CAP ${n(r.c.cap)}), Gempa ${n(r.c.gempa)}, Gunung api ${n(r.c.gunungapi)} ) = ${r.status ?? '–'}
Indikasi = max(hujan ${n(r.ind.hujan)}, banjir ${n(r.ind.banjir)}, longsor ${n(r.ind.longsor)}) = ${r.indikasi ?? '–'}
Gabungan = max(Status, Indikasi) = ${r.gabungan ?? '–'}</pre>
      <div class="sx-comps">
        ${COMPONENTS.map(
          (c) => `
          <div class="sx-card${r.drivers.includes(c.key) ? ' is-driver' : ''}">
            <div class="sx-card__head"><span class="sx-card__title">${c.long}</span>${r.c[c.key] === null ? '<span class="sx-chip sx-chip--nd">tanpa data</span>' : pill(r.c[c.key])}</div>
            <p class="sx-card__text">${escapeHtml(evidenceText(r, c.key, data))}</p>
            <p class="sx-card__meta">${PROVENANCE[c.key]}</p>
          </div>`,
        ).join('')}
      </div>
      <div class="sx-card">
        <div class="sx-card__head"><span class="sx-card__title">Indikasi SIGAP 3 hari</span>${r.indikasi === null ? '<span class="sx-chip sx-chip--nd">belum tersedia</span>' : pill(r.indikasi)}</div>
        ${
          ind
            ? `<ul class="sx-ind-list">${INDIKASI.map((h) => {
                const x = ind[h.key];
                if (!x) return '';
                return `<li><span>${h.name}</span>${x.level === null ? '<span class="sx-chip sx-chip--nd">tanpa data</span>' : pill(x.level)}<span class="sx-card__meta">${escapeHtml(x.reason ?? '')}${x.level > 0 && x.peak_date ? ` · puncak ${escapeHtml(formatDay(x.peak_date))}` : ''}</span></li>`;
              }).join('')}</ul>`
            : '<p class="sx-card__text">Indikasi untuk kab/kota ini belum dihitung.</p>'
        }
        <p class="sx-card__meta">Indikasi sistem (hujan ECMWF × zona bahaya InaRISK), belum dikalibrasi; tidak ikut status resmi.</p>
      </div>
      ${
        r.kerentanan
          ? `<div class="sx-card"><span class="sx-card__title">Kerentanan dasar (konteks, tidak mengubah status)</span>
              <p class="sx-card__text">Zona bahaya tinggi InaRISK: banjir ${formatDecimal(r.kerentanan.banjir_tinggi_pct ?? 0)}% dan tanah longsor ${formatDecimal(r.kerentanan.longsor_tinggi_pct ?? 0)}% dari luas wilayah (raster ±550 m).</p></div>`
          : ''
      }
      <div class="sx-detail__buttons">
        <button type="button" class="btn btn-secondary" data-action="sx-fly" data-region="${escapeHtml(r.kode)}">${icons.extent}Lihat di peta</button>
        <button type="button" class="btn btn-secondary" data-action="sx-copy" data-region="${escapeHtml(r.kode)}">${icons.list}Salin ringkasan</button>
      </div>
    </div>`;
}

function summaryText(r, data) {
  const lines = [
    `${r.nama} (${r.provinsi}): ${regionLabel(r)}`,
    ...COMPONENTS.map((c) => `- ${c.long}: ${r.c[c.key] === null ? 'tanpa data' : LEVELS[r.c[c.key]]}`),
    `- Indikasi SIGAP 3 hari: ${r.indikasi === null ? 'belum tersedia' : LEVELS[r.indikasi]} (bukan peringatan resmi)`,
    `Dihitung ${formatClock(data.computed_at)} · SIGAP ${data.rules_version}`,
  ];
  return lines.join('\n');
}

function sourceChips(data, now) {
  const s = data.sources;
  const chip = (name, state, detail) => `<span class="sx-source sx-source--${state}"><span class="sx-dot"></span>${name}<span class="sx-source__age">${escapeHtml(detail)}</span></span>`;
  const sync = (src) => (src.last_ok_at ? timeAgo(src.last_ok_at, now) : 'belum pernah');
  const cews = s.cews.error
    ? chip('BMKG CEWS', 'bad', 'gagal dimuat')
    : !s.cews.published
      ? chip('BMKG CEWS', 'warn', 'dasarian belum terbit')
      : s.cews.sebelumnya
        ? chip('BMKG CEWS', 'warn', `dasarian sebelumnya (${formatDasarian(s.cews.dasarian, { short: true })}); dasarian berjalan belum terbit`)
        : chip('BMKG CEWS', s.cews.unmatched.length ? 'warn' : 'ok', `${formatDasarian(s.cews.dasarian, { short: true })}${s.cews.unmatched.length ? ` · ${s.cews.unmatched.length} nama belum cocok` : ''}`);
  const indikasi = s.indikasi.error
    ? chip('Indikasi SIGAP', 'bad', 'belum tersedia')
    : chip('Indikasi SIGAP', s.indikasi.window?.expired ? 'warn' : 'ok', s.indikasi.window?.expired ? 'kedaluwarsa' : timeAgo(s.indikasi.finished_at, now));
  return [
    chip('BMKG CAP', s.cap.stale ? 'bad' : 'ok', sync(s.cap)),
    chip('BMKG Gempa', s.gempa.stale ? 'bad' : 'ok', sync(s.gempa)),
    chip('MAGMA', s.gunungapi.stale ? 'bad' : 'ok', sync(s.gunungapi)),
    cews,
    indikasi,
  ].join('');
}

const DRIVER_LABEL = {
  cews: 'BMKG · peringatan hujan 10 hari (CEWS)',
  cap: 'BMKG · peringatan cuaca beberapa jam (CAP)',
  gempa: 'BMKG · gempa 24 jam terakhir',
  gunungapi: 'PVMBG · status gunung api (MAGMA)',
};
// Nama pendek penentu untuk kalimat ringkasan.
const DRIVER_SHORT = { cews: 'peringatan hujan BMKG (CEWS)', cap: 'peringatan cuaca BMKG (CAP)', gempa: 'gempa BMKG', gunungapi: 'status gunung api PVMBG' };
const GDACS_COMPONENT_LABEL = { hidromet: 'peringatan hujan BMKG', gunungapi: 'gunung api PVMBG', gempa: 'gempa BMKG' };
const GDACS_COLOR = { green: '#2e7d32', orange: '#ef6c00', red: '#c62828' };

// Peringatan GDACS terbaru dan komponen SIGAP setara di kab/kota terdekat.
function gdacsCard(g) {
  if (g.error) return `<p class="sx-note">GDACS belum dapat dihubungi (${escapeHtml(g.error)}).</p>`;
  if (!g.events.length) return '<p class="sx-card__text">Tidak ada peringatan GDACS di Indonesia yang berlangsung atau dimulai 7 hari terakhir.</p>';
  const compared = g.events.filter((e) => e.hasil !== 'tidak_dibandingkan');
  const sejalan = compared.filter((e) => e.hasil === 'sejalan').length;
  return `<p class="sx-card__text"><strong>${g.events.length}</strong> peringatan GDACS berlangsung atau dimulai 7 hari terakhir. Dari ${compared.length} yang bisa dibandingkan, <strong>${sejalan}</strong> sejalan dengan data SIGAP untuk jenis bahaya yang sama.</p>
    <ul class="sx-cmp">${g.events
      .map((e) => {
        const MARK = { sejalan: ['is-agree', 'sejalan'], berbeda: ['is-differ', 'berbeda'], tidak_dibandingkan: ['is-neutral', 'tidak dibandingkan'] }[e.hasil];
        const where = e.wilayah ? `<button type="button" class="sx-link" data-region="${escapeHtml(e.kode)}">${escapeHtml(shortName(e.wilayah))}</button>` : 'di luar kab/kota (laut)';
        const sigap =
          e.tipe === 'EQ' || e.tipe === 'TS'
            ? e.gempa_bmkg !== null
              ? `Juga tercatat BMKG (M${formatDecimal(e.gempa_bmkg)})`
              : 'Tidak ditemukan di gempa BMKG'
            : !e.wilayah
              ? 'Di laut, tidak ada kab/kota dalam 50 km'
              : !e.komponen
                ? 'SIGAP tidak punya komponen setara'
                : `SIGAP: ${e.sigap_level === null ? 'tanpa data' : LEVELS[e.sigap_level]} (${escapeHtml(GDACS_COMPONENT_LABEL[e.komponen])})`;
        return `<li class="sx-cmp__item">
          <span class="sx-cmp__badge" style="--c:${GDACS_COLOR[e.level]}">${escapeHtml(e.level_label)}</span>
          <span class="sx-cmp__text"><strong>${escapeHtml(e.jenis)}${e.nama ? ` ${escapeHtml(e.nama)}` : ''}</strong> · ${where}${e.berlangsung ? ' · masih berlangsung' : ` · ${escapeHtml(formatDay(e.mulai.slice(0, 10)))}`}
            <span class="sx-card__meta">${sigap}${e.laporan ? ` · <a href="${escapeHtml(e.laporan)}" target="_blank" rel="noopener">laporan GDACS</a>` : ''}</span></span>
          <span class="sx-cmp__mark ${MARK[0]}">${MARK[1]}</span>
        </li>`;
      })
      .join('')}</ul>
    <p class="sx-note">Hijau = dampak kecil, jadi tidak bertentangan dengan SIGAP Normal; Oranye/Merah dianggap berbeda bila SIGAP Normal. Gempa dicocokkan dengan gempa BMKG yang sama (selisih ≤ 2 menit, ≤ 100 km). Level GDACS adalah perkiraan dampak kemanusiaan (Komisi Eropa JRC dan PBB OCHA), bukan level peringatan nasional, jadi wajar bila tidak selalu sama.</p>`;
}

// Hujan terukur 24 jam di stasiun BMKG dibandingkan dengan peringatan hujan resmi.
function rainCard(h) {
  if (!h || h.error) return `<p class="sx-note">Hujan terukur belum tersedia${h?.error ? ` (${escapeHtml(h.error)})` : ''}.</p>`;
  if (!h.stasiun) return '<p class="sx-note">Belum ada laporan stasiun 24 jam yang lengkap.</p>';
  const heavy = h.lebat.length
    ? `<ul class="sx-cmp">${h.lebat
        .map((r) => {
          const agree = r.hidromet > 0;
          return `<li class="sx-cmp__item">
            <span class="sx-cmp__badge" style="--c:#2563eb">${formatDecimal(r.mm, 0)} mm</span>
            <span class="sx-cmp__text"><strong>Stasiun ${escapeHtml(r.stasiun)}</strong> · <button type="button" class="sx-link" data-region="${escapeHtml(r.kode)}">${escapeHtml(shortName(r.wilayah))}</button>
              <span class="sx-card__meta">${escapeHtml(r.kategori_label)} · CEWS ${r.cews === null ? 'tanpa data' : LEVELS[r.cews]}, CAP ${r.cap === null ? 'tanpa data' : LEVELS[r.cap]}</span></span>
            <span class="sx-cmp__mark ${agree ? 'is-agree' : 'is-differ'}">${agree ? 'ada peringatan' : 'tanpa peringatan'}</span>
          </li>`;
        })
        .join('')}</ul>`
    : '';
  return `<p class="sx-card__text">Dalam 24 jam sampai ${formatClock(h.sampai)}, <strong>${h.hujan}</strong> dari ${h.stasiun} stasiun BMKG mencatat hujan; <strong>${h.lebat.length}</strong> di antaranya hujan lebat (≥ 50 mm)${h.lebat.length ? `, dan ${h.lebat_berperingatan} berada di kab/kota yang sedang ada peringatan hujan BMKG` : ''}.</p>
    ${heavy}
    <p class="sx-card__text">Sebaliknya, ada ${h.berperingatan} stasiun di kab/kota yang sedang ada peringatan hujan; <strong>${h.berperingatan_hujan}</strong> di antaranya benar-benar mencatat hujan sedang ke atas (≥ 20 mm).</p>
    <p class="sx-note">Pemeriksaan lapangan, bukan verifikasi resmi: satu stasiun hanya mewakili sekitarnya, dan peringatan CEWS berlaku 10 hari, bukan hanya 24 jam terakhir.</p>`;
}

// Ringkasan dalam kalimat biasa untuk dibaca pertama kali.
function summaryHtml(data, view) {
  const regions = data.regions;
  const n = (key) => regions.filter((r) => bucket(r, view) === key).length;
  const attention = regions.filter((r) => isSure(r, view) && shownLevel(r, view) > 0);
  const parts = [];
  if (!attention.length) {
    parts.push(`Tidak ada kab/kota berstatus Waspada ke atas dari ${regions.length} kab/kota.`);
  } else {
    const levels = [['awas', 'Awas'], ['siaga', 'Siaga'], ['waspada', 'Waspada']].filter(([key]) => n(key)).map(([key, label]) => `<strong>${n(key)}</strong> ${label}`);
    parts.push(`Dari ${regions.length} kab/kota, ${levels.join(', ')}.`);
    // Provinsi dengan kab/kota Waspada ke atas terbanyak.
    const byProvince = new Map();
    for (const r of attention) byProvince.set(r.provinsi, (byProvince.get(r.provinsi) ?? 0) + 1);
    const top = [...byProvince].sort((a, b) => b[1] - a[1]).slice(0, 3);
    parts.push(`Terbanyak di ${top.map(([p, c]) => `${escapeHtml(p)} (${c})`).join(', ')}.`);
    // Sumber yang paling banyak menentukan.
    const drivers = Object.entries(data.analisis.penentu).sort((a, b) => b[1] - a[1]);
    if (drivers[0]?.[1]) parts.push(`Penyebab terbanyak: ${DRIVER_SHORT[drivers[0][0]]} (${drivers[0][1]} kab/kota)${drivers[1]?.[1] ? `, lalu ${DRIVER_SHORT[drivers[1][0]]} (${drivers[1][1]})` : ''}.`);
    // Wilayah tertinggi.
    const highest = attention.filter((r) => shownLevel(r, view) === Math.max(...attention.map((x) => shownLevel(x, view)))).slice(0, 3);
    parts.push(`Tertinggi (${LEVELS[shownLevel(highest[0], view)]}): ${highest.map((r) => `<button type="button" class="sx-link" data-region="${escapeHtml(r.kode)}">${escapeHtml(shortName(r.nama))}</button>`).join(', ')}${attention.filter((r) => shownLevel(r, view) === shownLevel(highest[0], view)).length > highest.length ? ', dan lainnya' : ''}.`);
  }
  if (n('belum_pasti')) parts.push(`<strong>${n('belum_pasti')}</strong> kab/kota belum pasti karena ada sumber resmi tanpa data.`);
  const cews = data.sources.cews;
  if (cews.sebelumnya) parts.push(`Peringatan hujan CEWS memakai dasarian sebelumnya (${formatDasarian(cews.dasarian, { short: true })}) karena dasarian berjalan belum diterbitkan BMKG.`);
  if (view === 'gabungan') parts.push('Tampilan ini ikut menghitung Indikasi SIGAP (belum dikalibrasi, bukan peringatan resmi).');
  return `<div class="sx-summary"><span class="sx-label">Ringkasan</span><p>${parts.join(' ')}</p></div>`;
}

// Arti warna dan garis di peta status.
function legendHtml() {
  const swatch = (level) => `<span class="sx-swatch" style="background:${WARNING_LEVEL_STYLES[level].color}"></span>`;
  return `<div class="sx-legend" aria-label="Arti warna peta">
    ${[3, 2, 1, 0].map((l) => `<span>${swatch(l)}${LEVELS[l]}</span>`).join('')}
    <span><span class="sx-swatch sx-swatch--nd"></span>Belum pasti</span>
    <span><span class="sx-swatch sx-swatch--dash"></span>Garis putus: aturan SIGAP (radius gunung api/gempa, CAP) atau naik karena indikasi</span>
  </div>`;
}

// Rekap jumlah kab/kota per level di tiap provinsi; klik untuk menyaring daftar.
function provinceHtml(data, view, showAllProvinces) {
  const rows = new Map();
  for (const r of data.regions) {
    if (!rows.has(r.induk)) rows.set(r.induk, { kode: r.induk, nama: r.provinsi, awas: 0, siaga: 0, waspada: 0, normal: 0, belum_pasti: 0, total: 0 });
    const row = rows.get(r.induk);
    row[bucket(r, view)]++;
    row.total++;
  }
  const sorted = [...rows.values()].sort((a, b) => b.awas - a.awas || b.siaga - a.siaga || b.waspada - a.waspada || a.nama.localeCompare(b.nama, 'id'));
  const shown = showAllProvinces ? sorted : sorted.slice(0, 10);
  const cell = (n, level) => (n ? `<span class="sx-cell" style="background:${WARNING_LEVEL_STYLES[level].color};color:${WARNING_LEVEL_STYLES[level].text}">${n}</span>` : '<span class="sx-cell sx-cell--zero">0</span>');
  return `<div class="sx-section">
    <h3 class="sx-title">Rekap per provinsi <span class="sx-count">${sorted.length} provinsi</span></h3>
    <p class="sx-note">Jumlah kab/kota per status. Klik nama provinsi untuk melihat kab/kotanya.</p>
    <div class="sx-table-wrap"><table class="sx-table">
      <thead><tr><th scope="col">Provinsi</th><th scope="col">Awas</th><th scope="col">Siaga</th><th scope="col">Waspada</th><th scope="col">Normal</th><th scope="col">Belum pasti</th></tr></thead>
      <tbody>${shown
        .map(
          (p) => `<tr><th scope="row"><button type="button" class="sx-link" data-province="${escapeHtml(p.kode)}" data-province-name="${escapeHtml(p.nama)}">${escapeHtml(p.nama)}</button></th>
            <td>${cell(p.awas, 3)}</td><td>${cell(p.siaga, 2)}</td><td>${cell(p.waspada, 1)}</td>
            <td><span class="sx-cell sx-cell--zero">${p.normal}</span></td><td><span class="sx-cell sx-cell--zero">${p.belum_pasti}</span></td></tr>`,
        )
        .join('')}</tbody>
    </table></div>
    ${sorted.length > 10 ? `<button type="button" class="sx-more" data-action="sx-provinces">${showAllProvinces ? 'Tampilkan 10 teratas' : `Tampilkan semua ${sorted.length} provinsi`}</button>` : ''}
  </div>`;
}

function analysisHtml(data, regions) {
  const a = data.analisis;
  const k = a.indikasi_vs_cews;
  const agreementCard = k.n
    ? `<div class="sx-ct">
         <span></span><span class="sx-ct__h">CEWS ≥ Waspada</span><span class="sx-ct__h">CEWS Normal</span>
         <span class="sx-ct__h sx-ct__row">Indikasi ≥ W</span><span class="sx-ct__v is-agree">${k.both}</span><span class="sx-ct__v">${k.onlyA}</span>
         <span class="sx-ct__h sx-ct__row">Indikasi 0</span><span class="sx-ct__v">${k.onlyB}</span><span class="sx-ct__v is-agree">${k.neither}</span>
       </div>
       <p class="sx-note">Cohen κ = <strong>${k.kappa === null ? '–' : formatDecimal(k.kappa, 2)}</strong> · n = ${k.n} kab/kota. Kesepakatan, bukan akurasi: keduanya prakiraan dengan horizon berbeda.</p>`
    : '<p class="sx-note">Belum bisa dihitung: indikasi SIGAP atau CEWS belum tersedia.</p>';

  // Gempa BMKG yang juga tercatat (terverifikasi) di katalog luar negeri.
  const g = a.gempa;
  const CATALOG_NAMES = { usgs: 'USGS (Amerika)', emsc: 'EMSC (Eropa)', gfz: 'GFZ (Jerman)' };
  const pct = (n) => Math.round((100 * n) / Math.max(1, g.n));
  const quakeCard = g.n
    ? `<p class="sx-card__text">Dari <strong>${g.n} gempa BMKG</strong> M ≥ 5 (2–9 hari lalu), <strong>${g.terverifikasi}</strong> (${pct(g.terverifikasi)}%) juga tercatat di paling sedikit satu katalog luar negeri.</p>
       ${g.catalogs
         .map(
           (c) => `<div class="sx-stat"><div class="sx-stat__row"><span>${CATALOG_NAMES[c.source]}</span><strong>${c.n ? `${c.matched} dari ${c.n}` : 'belum ada data'}</strong></div><span class="sx-bar__track"><i style="width:${c.n ? (100 * c.matched) / c.n : 0}%"></i></span></div>`,
         )
         .join('')}
       <p class="sx-note">Dianggap gempa yang sama bila selisih waktu ≤ 60 detik dan pusat ≤ 100 km. Median selisih magnitudo dengan USGS ${g.catalogs[0].median_dm ?? '–'}, waktu ${g.catalogs[0].median_dt_s ?? '–'} detik. Katalog luar sering baru lengkap setelah 1–2 hari, jadi gempa 2 hari terakhir belum dihitung. Pembagi tiap katalog hanya gempa BMKG sejak data pertama katalog itu tersimpan di SIGAP.</p>`
    : '<p class="sx-note">Belum ada gempa BMKG M ≥ 5 berumur 2–9 hari untuk dibandingkan.</p>';

  // Berapa kab/kota Waspada ke atas yang statusnya ditentukan tiap sumber resmi.
  const attention = regions.filter((r) => r.status > 0).length;
  const driverCard = `<p class="sx-card__text">Dari <strong>${attention} kab/kota</strong> Waspada ke atas, status masing-masing ditentukan oleh:</p>
    ${Object.entries(a.penentu)
      .sort((x, y) => y[1] - x[1])
      .map(
        ([key, v]) => `<div class="sx-stat"><div class="sx-stat__row"><span>${DRIVER_LABEL[key]}</span><strong>${v} kab/kota</strong></div><span class="sx-bar__track"><i style="width:${(100 * v) / Math.max(1, attention)}%"></i></span></div>`,
      )
      .join('')}
    <p class="sx-note">Satu kab/kota bisa ditentukan dua sumber sekaligus bila levelnya sama, jadi jumlahnya bisa lebih dari ${attention}.</p>`;

  // Kerentanan dasar: seberapa luas wilayah yang berada di zona bahaya tinggi InaRISK.
  const exposed = regions
    .filter((r) => r.kerentanan)
    .map((r) => ({ r, pct: (r.kerentanan.banjir_tinggi_pct ?? 0) + (r.kerentanan.longsor_tinggi_pct ?? 0) }))
    .sort((x, y) => y.pct - x.pct)
    .slice(0, 5);
  const exposureCard = exposed.length
    ? `<p class="sx-card__text">Kab/kota dengan bagian wilayah terluas di zona bahaya <strong>tinggi</strong> InaRISK BNPB (banjir + tanah longsor):</p>
       ${exposed.map(({ r, pct }) => `<div class="sx-kv"><button type="button" class="sx-link" data-region="${escapeHtml(r.kode)}">${escapeHtml(shortName(r.nama))}</button><strong>${formatDecimal(pct)}% luas</strong></div>`).join('')}
       <p class="sx-note">Ini paparan jangka panjang (peta rawan), bukan kejadian sekarang, jadi tidak mengubah status.</p>`
    : `<p class="sx-card__text">Seberapa luas tiap kab/kota berada di zona bahaya tinggi banjir dan tanah longsor (peta rawan InaRISK BNPB). Paparan jangka panjang, tidak mengubah status.</p>
       <p class="sx-note">Belum tersedia: data zona bahaya InaRISK belum dimuat ke database ini (perintah server: npm run seed -- bahaya).</p>`;

  return `
    <div class="sx-section">
      <h3 class="sx-title">Analisis pendukung</h3>
      <div class="sx-grid">
        <div class="sx-card"><span class="sx-card__title">Indikasi SIGAP vs CEWS BMKG</span>${agreementCard}</div>
        <div class="sx-card"><span class="sx-card__title">Gempa BMKG terverifikasi katalog luar</span>${quakeCard}</div>
        <div class="sx-card"><span class="sx-card__title">Sumber yang menentukan status</span>${driverCard}</div>
        <div class="sx-card"><span class="sx-card__title">Hujan terukur di stasiun BMKG vs peringatan hujan</span>${rainCard(a.hujan_terukur)}</div>
        <div class="sx-card"><span class="sx-card__title">Peringatan GDACS (Komisi Eropa–PBB) vs SIGAP</span>${gdacsCard(a.gdacs)}</div>
        <div class="sx-card"><span class="sx-card__title">Kerentanan dasar</span>${exposureCard}</div>
      </div>
    </div>`;
}

function methodHtml(data) {
  return `
    <details class="sx-method">
      <summary>Metode dan aturan (${escapeHtml(data.rules_version)})</summary>
      <ul>
        <li><strong>Status</strong> = max( max(CEWS, CAP), Gempa, Gunung api ). CEWS dan CAP digabung dulu supaya hujan tidak dihitung dua kali.</li>
        <li><strong>CEWS</strong>: level BMKG untuk kab/kota itu (dasarian berjalan).</li>
        <li><strong>CAP</strong>: ${escapeHtml(data.rules.cap)}.</li>
        <li><strong>Gempa</strong> (BMKG 24 jam, jarak dari batas wilayah): ${data.rules.gempa.map(escapeHtml).join('; ')}.</li>
        <li><strong>Gunung api</strong>: ${escapeHtml(data.rules.gunungapi)}.</li>
        <li><strong>Belum pasti</strong>: komponen yang ada Normal tetapi ada sumber tanpa data. Sumber yang gagal tidak pernah dianggap aman.</li>
        <li><strong>Indikasi SIGAP</strong> ditampilkan di samping status dan hanya ikut dihitung di tampilan "Resmi + Indikasi SIGAP".</li>
      </ul>
      <p class="sx-note">${escapeHtml(data.attribution)}</p>
    </details>`;
}

// flyTo(bounds) menerbangkan peta ke [[s, w], [n, e]]; hideWhileShown = lapisan
// kab/kota lain yang disembunyikan selama tab ini terbuka (dikembalikan sesudahnya).
export function createSintesis({ container, map, flyTo, hideWhileShown = [], onError }) {
  let data = null;
  let byKode = new Map();
  let view = 'resmi';
  let selected = null;
  let showAll = false;
  let expanded = false;
  let showAllProvinces = false;
  let province = null;
  // Isi kotak cari apa adanya; dipangkas hanya saat menyaring.
  let search = '';
  let visible = false;
  let timer = null;
  let hidden = [];

  // ---------- Peta koroplet status ----------
  const renderer = L.canvas({ pane: 'warnings' });
  function styleOf(feature) {
    const r = byKode.get(feature.properties.kode);
    const isSelected = selected === feature.properties.kode;
    if (!r || !isSure(r, view)) {
      return { renderer, color: NO_DATA_STYLE.color, weight: isSelected ? 3 : 0.8, opacity: 0.8, dashArray: '3 3', fillColor: NO_DATA_STYLE.color, fillOpacity: 0.18 };
    }
    const level = shownLevel(r, view);
    const { color } = WARNING_LEVEL_STYLES[level];
    const dashed = raisedByIndikasi(r, view) || (level > 0 && !isOfficial(r));
    if (level === 0) return { renderer, color, weight: isSelected ? 3 : 0.5, opacity: isSelected ? 1 : 0.35, dashArray: null, fillColor: color, fillOpacity: 0.1 };
    return {
      renderer,
      color: isSelected ? '#ffffff' : color,
      weight: isSelected ? 3 : 1.4,
      opacity: 0.95,
      dashArray: dashed && !isSelected ? '5 4' : null,
      fillColor: color,
      fillOpacity: raisedByIndikasi(r, view) ? 0.25 : 0.5,
    };
  }
  const layer = L.geoJSON(null, {
    pane: 'warnings',
    style: styleOf,
    onEachFeature(feature, path) {
      path.bindTooltip(
        () => {
          const r = byKode.get(feature.properties.kode);
          return `${escapeHtml(feature.properties.nama)} · ${r ? escapeHtml(regionLabel(r)) : 'memuat…'}`;
        },
        { sticky: true, className: 'boundary-tooltip' },
      );
      path.on('click', () => select(feature.properties.kode, { fly: false }));
    },
  });
  let geometry = null;
  function restyle() {
    layer.setStyle(styleOf);
    // Kab/kota berlevel lebih tinggi (dan yang dipilih) digambar paling atas.
    const raised = [];
    layer.eachLayer((path) => {
      const r = byKode.get(path.feature.properties.kode);
      const level = r ? (shownLevel(r, view) ?? 0) : 0;
      raised.push([path.feature.properties.kode === selected ? 9 : level, path]);
    });
    raised.sort((a, b) => a[0] - b[0]).forEach(([level, path]) => level > 0 && path.bringToFront());
  }
  function showLayer() {
    hidden = hideWhileShown.filter((l) => map.hasLayer(l));
    hidden.forEach((l) => map.removeLayer(l));
    map.addLayer(layer);
    geometry ??= getJson('/api/wilayah?tingkat=kabkota')
      .then((collection) => {
        layer.addData(collection);
        restyle();
      })
      .catch((err) => {
        geometry = null;
        onError?.(err);
      });
  }
  function hideLayer() {
    map.removeLayer(layer);
    hidden.forEach((l) => map.addLayer(l));
    hidden = [];
  }

  // ---------- Panel ----------
  const query = () => search.trim().toLowerCase();
  const isAttention = (r) => (shownLevel(r, view) ?? 0) > 0;

  function listRegions() {
    const all = [...data.regions].sort(compareRegions(view));
    if (province) return all.filter((r) => r.induk === province.kode);
    const q = query();
    if (q) return all.filter((r) => r.nama.toLowerCase().includes(q) || r.provinsi.toLowerCase().includes(q));
    return showAll ? all : all.filter(isAttention);
  }

  // Daftar dan matriks digambar ulang sendiri saat mengetik, supaya kotak cari
  // (beserta kursor dan IME) tidak ikut diganti.
  function resultsHtml() {
    const q = query();
    const regions = listRegions();
    const limited = !q && !province && !showAll && !expanded;
    const shown = limited ? regions.slice(0, LIST_SIZE) : regions;
    const heading = province ? `Provinsi ${escapeHtml(province.nama)}` : q ? 'Hasil pencarian' : showAll ? 'Semua kab/kota' : 'Perlu perhatian';
    return `
      <div class="sx-section">
        <h3 class="sx-title">${heading} <span class="sx-count">${regions.length} kab/kota</span></h3>
        ${shown.length ? `<ul class="sx-list">${shown.map((r) => regionRow(r, view, r.kode === selected, data.sources.cews.sebelumnya)).join('')}</ul>` : `<p class="empty-note">${q ? 'Tidak ada kab/kota yang cocok.' : 'Tidak ada kab/kota Waspada ke atas.'}</p>`}
        ${limited && regions.length > LIST_SIZE ? `<button type="button" class="sx-more" data-action="sx-more">Tampilkan ${regions.length - LIST_SIZE} lagi</button>` : ''}
        ${province ? `<button type="button" class="sx-more" data-action="sx-clear-province">Kembali ke daftar perlu perhatian</button>` : ''}
        ${q || province ? '' : `<button type="button" class="sx-more" data-action="sx-all">${showAll ? 'Hanya yang perlu perhatian' : `Tampilkan semua ${data.regions.length} kab/kota`}</button>`}
      </div>
      ${matrixHtml((q || showAll ? regions : regions.filter(isAttention)).slice(0, MATRIX_SIZE))}`;
  }

  function renderResults() {
    const results = container.querySelector('.sx-results');
    if (results) results.innerHTML = resultsHtml();
  }

  function render() {
    if (!data) return;
    const now = Date.now();
    const c = data.counts;
    const tiles = [
      ['awas', 3, 'Awas'],
      ['siaga', 2, 'Siaga'],
      ['waspada', 1, 'Waspada'],
      ['normal', 0, 'Normal'],
      ['belum_pasti', null, 'Belum pasti'],
    ];
    const official = (level) => data.regions.filter((r) => r.state === 'pasti' && r.status === level && isOfficial(r)).length;
    const region = selected ? byKode.get(selected) : null;
    // Fokus kotak cari dipertahankan hanya bila memang sedang dipakai.
    const searchFocused = document.activeElement?.dataset?.action === 'sx-search';
    // Tombol yang sedang difokus (pilihan tampilan, tombol aksi, wilayah) difokus lagi sesudah digambar ulang.
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused && ['view', 'action', 'region', 'province'].find((k) => focused.dataset?.[k] !== undefined);
    const focusSelector = focusKey && !searchFocused ? `[data-${focusKey}="${CSS.escape(focused.dataset[focusKey])}"]` : null;

    container.innerHTML = `
      <div class="sx-head">
        <div>
          <h2 class="sx-h">Status wilayah</h2>
          <span class="sx-note">${data.regions.length} kab/kota · dihitung ${formatClock(data.computed_at)} · ${escapeHtml(data.rules_version)}</span>
        </div>
        <div class="sx-seg" role="group" aria-label="Cara menghitung status">
          <button type="button" data-view="resmi" aria-pressed="${view === 'resmi'}">Resmi</button>
          <button type="button" data-view="gabungan" aria-pressed="${view === 'gabungan'}">Resmi + Indikasi SIGAP</button>
        </div>
      </div>

      ${summaryHtml(data, view)}

      <div class="sx-tiles">
        ${tiles
          .map(([key, level, label]) => {
            const n = data.regions.filter((r) => bucket(r, view) === key).length;
            const sub = level > 0 && view === 'resmi' ? `${official(level)} resmi · ${n - official(level)} aturan` : key === 'belum_pasti' ? 'ada sumber tanpa data' : '';
            const bar = level === null ? 'sx-tile__bar--nd' : '';
            return `<div class="sx-tile"><span class="sx-tile__bar ${bar}" style="${level === null ? '' : `background:${WARNING_LEVEL_STYLES[level].color}`}"></span>
              <span class="sx-tile__n">${n}</span><span class="sx-tile__label">${label}</span>${sub ? `<span class="sx-tile__sub">${sub}</span>` : ''}</div>`;
          })
          .join('')}
      </div>
      ${c.naik_karena_indikasi ? `<p class="sx-note">${view === 'resmi' ? `<strong>+${c.naik_karena_indikasi} kab/kota</strong> naik level bila Indikasi SIGAP ikut dihitung.` : 'Garis putus-putus di peta: naik karena indikasi SIGAP atau aturan SIGAP.'}</p>` : ''}

      ${legendHtml()}

      <div class="sx-sources" aria-label="Kesegaran sumber">${sourceChips(data, now)}</div>

      ${region ? detailHtml(region, data) : ''}

      <label class="sx-search">${icons.search}<span class="visually-hidden">Cari kab/kota</span><input type="search" placeholder="Cari kab/kota atau provinsi" data-action="sx-search" /></label>
      <div class="sx-results">${resultsHtml()}</div>
      ${provinceHtml(data, view, showAllProvinces)}
      ${analysisHtml(data, data.regions)}
      ${methodHtml(data)}`;
    const input = container.querySelector('[data-action="sx-search"]');
    input.value = search;
    if (searchFocused) {
      input.focus();
      input.setSelectionRange(search.length, search.length);
    } else if (focusSelector) {
      container.querySelector(focusSelector)?.focus({ preventScroll: true });
    }
  }

  function select(kode, { fly = true } = {}) {
    selected = kode;
    render();
    restyle();
    const r = byKode.get(kode);
    if (fly && r) flyTo(r.bounds);
    const detail = container.querySelector('.sx-detail');
    detail?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    detail?.querySelector('[data-action="sx-close"]')?.focus({ preventScroll: true });
  }

  container.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      view = viewButton.dataset.view;
      render();
      restyle();
      return;
    }
    const button = event.target.closest('[data-action]');
    const action = button?.dataset.action;
    const kode = event.target.closest('[data-region]')?.dataset.region;
    if (action === 'sx-close') {
      selected = null;
      render();
      restyle();
    } else if (action === 'sx-fly') {
      flyTo(byKode.get(kode).bounds);
    } else if (action === 'sx-copy') {
      const label = button.lastChild;
      const copied = navigator.clipboard ? navigator.clipboard.writeText(summaryText(byKode.get(kode), data)) : Promise.reject(new Error('clipboard'));
      copied.then(
        () => (label.textContent = 'Tersalin'),
        () => (label.textContent = 'Gagal menyalin'),
      );
    } else if (action === 'sx-clear-province') {
      province = null;
      renderResults();
    } else if (action === 'sx-provinces') {
      showAllProvinces = !showAllProvinces;
      render();
    } else if (event.target.closest('[data-province]')) {
      // Tampilkan semua kab/kota provinsi itu (kode induk, bukan pencarian nama:
      // "Papua" tidak boleh ikut memuat Papua Barat dan lainnya).
      const button = event.target.closest('[data-province]');
      province = { kode: button.dataset.province, nama: button.dataset.provinceName };
      search = '';
      container.querySelector('[data-action="sx-search"]').value = '';
      renderResults();
      container.querySelector('.sx-search').scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else if (action === 'sx-more') {
      expanded = true;
      renderResults();
    } else if (action === 'sx-all') {
      showAll = !showAll;
      expanded = false;
      renderResults();
    } else if (kode) {
      select(kode);
    }
  });
  container.addEventListener('input', (event) => {
    if (event.target.dataset.action !== 'sx-search') return;
    search = event.target.value;
    province = null;
    renderResults();
  });

  async function refresh() {
    try {
      data = await getJson('/api/sintesis');
      byKode = new Map(data.regions.map((r) => [r.kode, r]));
      render();
      restyle();
    } catch (err) {
      if (!data) container.innerHTML = `<p class="empty-note">Status wilayah gagal dimuat. ${escapeHtml(err.message ?? '')}</p>`;
      onError?.(err);
    }
  }

  return {
    show() {
      if (visible) return;
      visible = true;
      showLayer();
      if (!data) container.innerHTML = '<p class="empty-note">Menghitung status 514 kab/kota…</p>';
      refresh();
      timer = setInterval(refresh, REFRESH_MS);
    },
    hide() {
      if (!visible) return;
      visible = false;
      clearInterval(timer);
      hideLayer();
    },
    refresh,
  };
}
