import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, formatDecimal, formatNumber, timeAgo, usgsPlace } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { makeFocusable } from '../lib/marker-focus.js';
import { DEPTH_CLASSES, depthClass, GROUND_FAILURE_RAMP, magnitudeRadius, pillStyle, USGS_ALERTS } from '../lib/symbology.js';

// Gempa dari katalog USGS (Amerika Serikat) sebagai pembanding gempa BMKG. Feed
// publik BMKG hanya memuat M ≥ 5 dan gempa dirasakan, sedangkan USGS juga mencatat
// gempa ±M4–5 yang tidak dirasakan; sebaliknya gempa kecil yang dirasakan hanya
// ada di BMKG. Gempa yang sama di kedua katalog dicocokkan oleh server.

const FOCUS_ZOOM = 10;
const REFRESH_MS = 60_000;
// Cincin sedikit lebih besar dari cakram BMKG bermagnitudo sama, supaya tetap
// terlihat mengelilingi cakram itu bila gempanya tercatat di kedua katalog.
const RING_MARGIN = 8;
// Selalu di bawah cakram BMKG: klik di tengah cincin tetap membuka gempa BMKG.
const BELOW_BMKG = -30_000;

const ringDiameter = (magnitude) => Math.round(2 * magnitudeRadius(magnitude)) + RING_MARGIN;

function usgsIcon(p, index) {
  const d = ringDiameter(p.magnitude);
  return L.divIcon({
    className: 'usgs-icon',
    html: `<span class="usgs-symbol" style="--c:${depthClass(p.depth_class).color};--i:${index}" role="img" aria-label="Gempa USGS M ${formatDecimal(p.magnitude)}"></span>`,
    iconSize: [d, d],
    tooltipAnchor: [0, -d / 2],
    popupAnchor: [0, -d / 2],
  });
}

function bmkgComparison(match) {
  if (!match) {
    return 'Tidak ada di feed publik BMKG <span class="muted">(feed itu hanya memuat M ≥ 5 dan gempa dirasakan)</span>';
  }
  const seconds = formatDecimal(Math.abs(match.time_diff_s), 0);
  return `M ${formatDecimal(match.magnitude)} <span class="muted">· selisih ${seconds} detik, ${formatDecimal(match.distance_km, 0)} km</span>`;
}

// Pil level PAGER/ground failure: Hijau, Kuning, Oranye, Merah.
export function usgsAlertPill(level, prefix = '') {
  const style = USGS_ALERTS[level];
  return style ? `<span class="level-pill" style="${pillStyle(style)}">${prefix}${style.label}</span>` : '';
}

// PAGER: level keseluruhan, lalu level korban jiwa dan kerugian ekonomi bila ada.
function pagerFacts(pager) {
  if (!pager?.alert) return '';
  const parts = [
    pager.fatality && `korban jiwa ${USGS_ALERTS[pager.fatality]?.label.toLowerCase()}`,
    pager.economic && `kerugian ${USGS_ALERTS[pager.economic]?.label.toLowerCase()}`,
  ].filter(Boolean);
  return `<dt>Dampak</dt><dd>${usgsAlertPill(pager.alert)}${parts.length ? ` <span class="muted">${parts.join(' · ')}</span>` : ''}</dd>`;
}

const GROUND_FAILURE_KINDS = [
  { id: 'landslide', label: 'Longsor' },
  { id: 'liquefaction', label: 'Likuefaksi' },
];

// Perkiraan longsor dan likuefaksi akibat gempa. shown = jenis yang sedang
// digambar di peta untuk gempa ini (atau null).
function groundFailureSection(gf, shown) {
  if (!gf) return '';
  const rows = GROUND_FAILURE_KINDS.filter(({ id }) => gf[id]?.alert)
    .map(({ id, label }) => {
      const h = gf[id];
      const area = h.area_km2 === null ? '' : ` · ±${formatDecimal(h.area_km2)} km²`;
      const people = h.population === null ? '' : ` · ±${formatNumber(Math.round(h.population))} jiwa terpapar`;
      return `<dt>${label}</dt><dd>${usgsAlertPill(h.alert)}<span class="muted">${area}${people}</span></dd>`;
    })
    .join('');
  if (!rows) return '';
  const buttons = GROUND_FAILURE_KINDS.filter(({ id }) => gf[id]?.overlay_url && gf[id]?.bounds)
    .map(({ id, label }) => {
      const on = shown === id;
      return `<button type="button" class="btn btn-secondary gf-toggle" data-action="usgs-ground-failure" data-kind="${id}" aria-pressed="${on}">${on ? `Sembunyikan peta ${label.toLowerCase()}` : `Peta ${label.toLowerCase()}`}</button>`;
    })
    .join('');
  return `
      <div class="popup-gf">
        <p class="popup-gf-title">Perkiraan longsor dan likuefaksi akibat gempa</p>
        <dl class="popup-facts">${rows}</dl>
        ${gf.rupture_warning ? '<p class="popup-gf-note">Guncangan dihitung dari titik pusat gempa tanpa model bidang patahan, jadi perkiraan untuk gempa sebesar ini bisa meleset.</p>' : ''}
        ${buttons ? `<div class="gf-toggles">${buttons}</div>` : ''}
        <p class="popup-gf-note">Model USGS dari guncangan, lereng, dan jenis tanah; bukan laporan kejadian.</p>
      </div>`;
}

export function usgsPopup(p, { shownGroundFailure = null } = {}) {
  const depth = depthClass(p.depth_class);
  const magnitude = formatDecimal(p.magnitude);
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="mag-badge mag-badge--lg" style="${pillStyle(depth)}">${magnitude}</span>
        <div class="popup-heading">
          <h3>Gempa M ${magnitude}${p.mag_type ? ` <span class="muted">${escapeHtml(p.mag_type)}</span>` : ''}</h3>
          <p class="popup-sub">${timeAgo(p.occurred_at)} · katalog USGS</p>
        </div>
      </div>
      <p class="popup-place">${escapeHtml(usgsPlace(p.wilayah))}</p>
      <dl class="popup-facts">
        <dt>Waktu</dt><dd>${formatDateTime(p.occurred_at)}</dd>
        <dt>Kedalaman</dt><dd>${formatDecimal(p.depth_km)} km (${escapeHtml(p.depth_class)})</dd>
        <dt>BMKG</dt><dd>${bmkgComparison(p.bmkg)}</dd>
        <dt>Status</dt><dd>${p.status === 'reviewed' ? 'Sudah ditinjau seismolog USGS' : 'Otomatis, masih bisa berubah'}</dd>
        ${pagerFacts(p.pager ?? (p.alert ? { alert: p.alert } : null))}
      </dl>
      ${groundFailureSection(p.ground_failure, shownGroundFailure)}
      <div class="popup-links">
        ${p.url ? `<a class="popup-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Halaman gempa di USGS${icons.external}</a>` : ''}
        ${p.pager?.onepager_url ? `<a class="popup-link" href="${escapeHtml(p.pager.onepager_url)}" target="_blank" rel="noopener">Ringkasan dampak PAGER (PDF)${icons.external}</a>` : ''}
      </div>
      <p class="popup-source">Sumber: USGS (Amerika Serikat) · pembanding, bukan peringatan resmi</p>
    </div>`;
}

// Data dimuat saat lapisan dinyalakan dan diperbarui tiap menit selama menyala.
export function createUsgsLayer(map, { viewPadding, onLoad, onError } = {}) {
  const group = L.featureGroup();
  const markers = new Map();
  const openers = new Map();
  let signature = '';
  let timer = null;

  // Gambar perkiraan longsor atau likuefaksi satu gempa, dinyalakan dari tombol di
  // popup. Tetap tampil setelah popup ditutup, sampai tombolnya ditekan lagi, gempa
  // lain dipilih, atau lapisan USGS dimatikan.
  const overlay = L.layerGroup();
  let shown = null; // { id, kind }

  function showGroundFailure(p, kind) {
    overlay.clearLayers();
    const h = p.ground_failure?.[kind];
    if (!h?.overlay_url || !h.bounds) return;
    L.imageOverlay(h.overlay_url, h.bounds, {
      pane: 'warnings',
      opacity: 0.85,
      interactive: false,
      className: 'gf-overlay',
      attribution: 'Perkiraan longsor dan likuefaksi: USGS Ground Failure',
    }).addTo(overlay);
    shown = { id: p.id, kind };
    if (!map.hasLayer(overlay)) overlay.addTo(map);
  }

  function hideGroundFailure() {
    overlay.clearLayers();
    shown = null;
  }

  // Tombol di popup: satu jenis gambar per gempa, menekan tombol yang aktif menyembunyikannya.
  function wirePopup(popup, p) {
    for (const button of popup.getElement()?.querySelectorAll('[data-action="usgs-ground-failure"]') ?? []) {
      button.addEventListener('click', () => {
        const { kind } = button.dataset;
        if (shown?.id === p.id && shown.kind === kind) hideGroundFailure();
        else showGroundFailure(p, kind);
        popup.setContent(usgsPopup(p, { shownGroundFailure: shown?.id === p.id ? shown.kind : null }));
        wirePopup(popup, p);
      });
    }
  }

  function render(collection) {
    // Popup yang sedang dibaca dibuka lagi setelah data diperbarui.
    const openId = [...markers].find(([, marker]) => marker.isPopupOpen())?.[0];
    markers.clear();
    openers.clear();
    group.clearLayers();
    // Gempa besar lebih dulu dan di bawah, supaya cincin kecil di atasnya tetap bisa diklik.
    const byMagnitude = [...collection.features].sort((a, b) => b.properties.magnitude - a.properties.magnitude);
    byMagnitude.forEach(({ geometry, properties: p }, index) => {
      const [lon, lat] = geometry.coordinates;
      const marker = L.marker([lat, lon], {
        pane: 'quakes',
        icon: usgsIcon(p, index),
        zIndexOffset: Math.round((10 - p.magnitude) * 1000) + BELOW_BMKG,
      }).bindTooltip(`USGS M ${formatDecimal(p.magnitude)} · ${timeAgo(p.occurred_at)}`, { direction: 'top' });
      const popup = () => usgsPopup(p, { shownGroundFailure: shown?.id === p.id ? shown.kind : null });
      openers.set(p.id, makeFocusable(map, marker, { zoom: FOCUS_ZOOM, popup, viewPadding }));
      marker.on('popupopen', (event) => wirePopup(event.popup, p));
      markers.set(p.id, marker);
      group.addLayer(marker);
    });
    // Gambar gempa yang sudah keluar dari data 7 hari ikut dihapus.
    if (shown && !markers.has(shown.id)) hideGroundFailure();
    openers.get(openId)?.({ fly: false });
  }

  async function load() {
    try {
      const collection = await getJson('/api/earthquakes?days=7&source=usgs');
      // PAGER dan ground failure menyusul ±20–60 menit setelah gempa.
      const next = JSON.stringify(
        collection.features.map(({ properties: p }) => [
          p.id, p.magnitude, p.depth_km, p.status, p.bmkg?.id, p.alert, p.pager?.alert, p.ground_failure?.updated_at,
        ]),
      );
      if (next !== signature) {
        signature = next;
        render(collection);
      }
      onLoad?.(collection);
    } catch (err) {
      onError?.(err);
    }
  }

  group.on('add', () => {
    load();
    timer ??= setInterval(load, REFRESH_MS);
  });
  group.on('remove', () => {
    clearInterval(timer);
    timer = null;
    hideGroundFailure();
    map.removeLayer(overlay);
  });
  return { layer: group };
}

export function usgsLegend() {
  const sizes = [4, 5, 6, 7]
    .map((m) => {
      const d = ringDiameter(m);
      return `<span class="legend-size"><span class="usgs-swatch" style="width:${d}px;height:${d}px"></span>M${m}</span>`;
    })
    .join('');
  const depths = DEPTH_CLASSES.map(
    (c) => `<div class="legend-row"><span class="usgs-swatch" style="--c:${c.color}"></span>${c.label}</div>`,
  ).join('');
  const levels = Object.keys(USGS_ALERTS).map((level) => usgsAlertPill(level)).join(' ');
  return `<div class="legend-sizes">${sizes}</div>${depths}
    <p class="legend-note">Cincin kosong: katalog USGS (Amerika Serikat), pembanding gempa BMKG. Gempa yang tercatat di keduanya tampak sebagai cincin di sekeliling cakram BMKG; magnitudonya bisa berbeda ±0,2.</p>
    <p class="legend-subtitle">Dampak (PAGER) dan longsor/likuefaksi</p>
    <div class="legend-pills">${levels}</div>
    <p class="legend-note">Untuk gempa yang cukup besar, ±20–60 menit setelah kejadian. Dampak: perkiraan korban jiwa 0 / 1–99 / 100–999 / ≥ 1.000.</p>
    <div class="legend-ramp" aria-hidden="true">${GROUND_FAILURE_RAMP.map((c) => `<span style="background:${c.color}"></span>`).join('')}</div>
    <div class="legend-ramp-labels"><span>${GROUND_FAILURE_RAMP[0].label}</span><span>${GROUND_FAILURE_RAMP.at(-1).label} area</span></div>
    <p class="legend-note">Peta longsor/likuefaksi (tombol di popup gempa USGS): perkiraan proporsi area yang longsor atau mengalami likuefaksi.</p>`;
}
