import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateShort } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { makeFocusable } from '../lib/marker-focus.js';
import { pillStyle, USGS_ALERTS } from '../lib/symbology.js';

// Peringatan GDACS (Komisi Eropa JRC dan PBB OCHA) untuk Indonesia: banjir, gempa,
// gunung api, siklon tropis, kekeringan, dan kebakaran hutan. Level Hijau, Oranye,
// atau Merah = perkiraan dampak kemanusiaan, bukan level peringatan nasional.
// Penanda memakai ikon peta resmi GDACS (30 × 38 px, ujung pin di bawah tengah),
// dipilih dari jenis dan level kejadian supaya warnanya selalu sama dengan level.

const FOCUS_ZOOM = 8;
const REFRESH_MS = 15 * 60_000;
const ICON_BASE = 'https://www.gdacs.org/images/gdacs_icons/maps/';
const LEVEL_ORDER = { green: 0, orange: 1, red: 2 };
const LEVEL_FOLDER = { green: 'Green', orange: 'Orange', red: 'Red' };

export const gdacsIconUrl = (type, level) => `${ICON_BASE}${LEVEL_FOLDER[level] ?? 'Green'}/${type}.png`;

const pin = (url) =>
  L.icon({ iconUrl: url, iconSize: [30, 38], iconAnchor: [15, 38], popupAnchor: [0, -34], tooltipAnchor: [0, -34], className: 'gdacs-icon' });

// Tanggal GDACS dalam UTC; rentang ditulis per hari.
function period(p) {
  const from = p.from && formatDateShort(p.from.slice(0, 10));
  const to = p.to && formatDateShort(p.to.slice(0, 10));
  if (!from) return '';
  return !to || to === from ? from : `${from} – ${to}`;
}

export function gdacsPopup(p) {
  const style = USGS_ALERTS[p.level];
  return `
    <div class="popup">
      <div class="popup-head">
        <img class="gdacs-popup-icon" src="${gdacsIconUrl(p.type, p.level)}" width="30" height="38" alt="" />
        <div class="popup-heading">
          <h3>${escapeHtml(p.type_label)}${p.name ? ` ${escapeHtml(p.name)}` : ''}</h3>
          <p class="popup-sub">${p.current ? 'Masih berlangsung' : 'Sudah berakhir'} · peringatan GDACS</p>
        </div>
      </div>
      <dl class="popup-facts">
        <dt>Level</dt><dd><span class="level-pill" style="${pillStyle(style)}">${style.label}</span> <span class="muted">dampak ${['kecil', 'sedang', 'besar'][LEVEL_ORDER[p.level]]}</span></dd>
        <dt>Waktu</dt><dd>${escapeHtml(period(p))}</dd>
        ${p.severity ? `<dt>Keterangan</dt><dd>${escapeHtml(p.severity)}</dd>` : ''}
        ${p.countries?.length ? `<dt>Negara</dt><dd>${escapeHtml(p.countries.join(', '))}</dd>` : ''}
        ${p.origin ? `<dt>Data dari</dt><dd>${escapeHtml(p.origin)}</dd>` : ''}
      </dl>
      ${p.report_url ? `<a class="popup-link" href="${escapeHtml(p.report_url)}" target="_blank" rel="noopener">Laporan GDACS${icons.external}</a>` : ''}
      <p class="popup-source">Sumber: GDACS (Komisi Eropa–PBB) · pembanding, bukan peringatan resmi Indonesia</p>
    </div>`;
}

// Data dimuat saat lapisan dinyalakan dan diperbarui tiap 15 menit selama menyala.
export function createGdacsLayer(map, { viewPadding, onLoad, onError } = {}) {
  const group = L.featureGroup();
  let signature = '';
  let timer = null;

  function render(collection) {
    group.clearLayers();
    for (const { geometry, properties: p } of collection.features) {
      const [lon, lat] = geometry.coordinates;
      const marker = L.marker([lat, lon], {
        pane: 'quakes',
        icon: pin(gdacsIconUrl(p.type, p.level)),
        // Merah di atas Oranye di atas Hijau; yang berlangsung di atas yang selesai.
        zIndexOffset: 40_000 + LEVEL_ORDER[p.level] * 2_000 + (p.current ? 1_000 : 0),
        alt: `${p.type_label}, level ${USGS_ALERTS[p.level].label}`,
      }).bindTooltip(`${p.type_label} · ${USGS_ALERTS[p.level].label} · ${period(p)}`, { direction: 'top' });
      makeFocusable(map, marker, { zoom: FOCUS_ZOOM, popup: () => gdacsPopup(p), viewPadding });
      group.addLayer(marker);
    }
  }

  async function load() {
    try {
      const collection = await getJson('/api/gdacs');
      const next = JSON.stringify(collection.features.map(({ properties: p }) => [p.id, p.level, p.modified]));
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
  });
  return { layer: group };
}

export function gdacsLegend() {
  const levels = ['green', 'orange', 'red']
    .map((level, i) => {
      const style = USGS_ALERTS[level];
      return `<div class="legend-row"><img class="gdacs-legend-icon" src="${gdacsIconUrl('FL', level)}" width="15" height="19" alt="" /><span class="level-pill" style="${pillStyle(style)}">${style.label}</span> dampak ${['kecil', 'sedang', 'besar'][i]}</div>`;
    })
    .join('');
  return `${levels}
    <p class="legend-note">Peringatan GDACS (Komisi Eropa dan PBB) untuk Indonesia: Oranye dan Merah 12 bulan terakhir, Hijau 7 hari terakhir. Gambar di pin: banjir, gempa, gunung api, siklon tropis, kekeringan, atau kebakaran hutan. Level menunjukkan perkiraan dampak kemanusiaan, bukan level peringatan BMKG/PVMBG/BNPB.</p>`;
}
