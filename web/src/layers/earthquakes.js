import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatDateTime, formatDecimal, shortQuakeRegion, timeAgo } from '../lib/format.js';
import { icons } from '../lib/icons.js';
import { makeFocusable } from '../lib/marker-focus.js';
import { DEPTH_CLASSES, depthClass, magnitudeRadius, pillStyle } from '../lib/symbology.js';

// Zoom tujuan saat gempa diklik: sekitar ±150 km terlihat di layar desktop.
const FOCUS_ZOOM = 10;
const HOUR_MS = 3_600_000;
const RECENT_HOURS = 24;
const WEEK_HOURS = 168;
const OLDEST_FADE = 0.45;

// Umur gempa menentukan tampilannya: < 24 jam memancarkan gelombang, gempa
// yang lebih lama makin pudar sampai 7 hari. Gempa terbaru selalu penuh.
function quakeAge(p, now, latest) {
  const hours = (now - new Date(p.occurred_at)) / HOUR_MS;
  const recent = !latest && hours < RECENT_HOURS;
  const fade = latest || recent ? 1 : Math.max(OLDEST_FADE, 1 - (1 - OLDEST_FADE) * (hours / WEEK_HOURS));
  return { recent, fade };
}

// Cakram berlapis seukuran magnitudo (tepi terang, cincin warna kedalaman, inti
// gelap). Tiga elemen gelombang selalu ada; CSS menampilkannya sesuai kelas
// is-recent (2 gelombang) atau is-latest (3, merah). Status disimpan di HTML
// ikon karena Leaflet membuat ulang elemen ikon setiap lapisan dinyalakan lagi.
// Cakram kecil (< 14 px) tanpa cincin tengah supaya tetap terbaca.
function quakeIcon(p, { color, index, latest, recent, fade }) {
  const r = magnitudeRadius(p.magnitude);
  const d = Math.round(2 * r);
  const state = (latest ? ' is-latest' : recent ? ' is-recent' : '') + (d < 14 ? ' is-small' : '');
  return L.divIcon({
    className: 'quake-icon',
    html:
      `<span class="quake-symbol${state}" style="--c:${color};--i:${index};--fade:${fade.toFixed(2)}" role="img" aria-label="Gempa M ${formatDecimal(p.magnitude)}">` +
      '<i class="quake-wave"></i><i class="quake-wave"></i><i class="quake-wave"></i><i class="quake-disc"></i><i class="quake-band"></i><i class="quake-core"></i></span>',
    iconSize: [d, d],
    tooltipAnchor: [0, -r],
    popupAnchor: [0, -r],
  });
}

export function earthquakePopup(p) {
  const depth = depthClass(p.depth_class);
  const magnitude = formatDecimal(p.magnitude);
  const tsunami = p.tsunami
    ? `<p class="popup-alert">${icons.alert}<span>Berpotensi tsunami — segera ikuti arahan BMKG dan BPBD.</span></p>`
    : '';
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="mag-badge mag-badge--lg" style="${pillStyle(depth)}">${magnitude}</span>
        <div class="popup-heading">
          <h3>Gempa M ${magnitude}</h3>
          <p class="popup-sub">${timeAgo(p.occurred_at)}</p>
        </div>
      </div>
      <p class="popup-place">${escapeHtml(shortQuakeRegion(p.wilayah))}</p>
      ${tsunami}
      <dl class="popup-facts">
        <dt>Waktu</dt><dd>${formatDateTime(p.occurred_at)}</dd>
        <dt>Kedalaman</dt><dd>${p.depth_km} km (${escapeHtml(p.depth_class)})</dd>
        ${p.dirasakan ? `<dt>Dirasakan</dt><dd>${escapeHtml(p.dirasakan)} <span class="muted">skala MMI</span></dd>` : ''}
        ${!p.tsunami && p.potensi ? `<dt>Keterangan</dt><dd>${escapeHtml(p.potensi)}</dd>` : ''}
      </dl>
      ${p.shakemap ? `<a class="popup-link" href="${escapeHtml(p.shakemap)}" target="_blank" rel="noopener">Peta guncangan BMKG${icons.external}</a>` : ''}
      <p class="popup-source">Sumber: ${escapeHtml(p.source)}</p>
    </div>`;
}

// viewPadding() = ruang peta yang tertutup panel, supaya titik yang dituju
// mendarat di area yang terlihat.
export function createEarthquakeLayer(map, { viewPadding } = {}) {
  const group = L.featureGroup();
  const markers = new Map();
  const styles = new Map();
  const openers = new Map();
  let signature = '';

  // Setiap sinkronisasi, gempa yang melewati 24 jam berhenti bergelombang dan
  // gempa lama makin pudar. Elemen yang tampil diubah di tempat (tanpa animasi
  // muncul ulang); ikon baru disimpan untuk saat elemen dibuat ulang.
  function updateAges() {
    const now = Date.now();
    for (const [id, marker] of markers) {
      const style = styles.get(id);
      const { recent, fade } = quakeAge(style.props, now, style.latest);
      if (recent === style.recent && Math.abs(fade - style.fade) < 0.01) continue;
      Object.assign(style, { recent, fade });
      marker.options.icon = quakeIcon(style.props, style);
      const symbol = marker.getElement()?.firstElementChild;
      symbol?.classList.toggle('is-recent', recent);
      symbol?.style.setProperty('--fade', fade.toFixed(2));
    }
  }

  function render(collection) {
    // Popup yang sedang dibaca dibuka lagi setelah data diperbarui.
    const openId = [...markers].find(([, marker]) => marker.isPopupOpen())?.[0];
    group.clearLayers();
    markers.clear();
    styles.clear();
    openers.clear();
    const now = Date.now();
    const latestId = collection.features[0]?.properties.id;

    // Gempa besar digambar lebih dulu dan diberi urutan tumpuk lebih rendah,
    // supaya gempa kecil di atasnya tetap bisa diklik. Gempa terbaru paling atas.
    const byMagnitude = [...collection.features].sort((a, b) => b.properties.magnitude - a.properties.magnitude);
    byMagnitude.forEach(({ geometry, properties: p }, index) => {
      const [lon, lat] = geometry.coordinates;
      const latest = p.id === latestId;
      const style = { props: p, color: depthClass(p.depth_class).color, index, latest, ...quakeAge(p, now, latest) };
      const marker = L.marker([lat, lon], {
        pane: 'quakes',
        icon: quakeIcon(p, style),
        zIndexOffset: Math.round((10 - p.magnitude) * 1000) + (latest ? 20_000 : 0),
      }).bindTooltip(`M ${formatDecimal(p.magnitude)} · ${timeAgo(p.occurred_at)}`, { direction: 'top' });
      const open = makeFocusable(map, marker, { zoom: FOCUS_ZOOM, popup: () => earthquakePopup(p), viewPadding });
      styles.set(p.id, style);
      openers.set(p.id, open);
      markers.set(p.id, marker.addTo(group));
    });
    openers.get(openId)?.({ fly: false });
  }

  return {
    layer: group,
    async load() {
      const collection = await getJson('/api/earthquakes?days=7');
      const next = JSON.stringify(collection.features.map((f) => [f.properties.id, f.properties.magnitude, f.properties.depth_km]));
      if (next !== signature) {
        signature = next;
        render(collection);
      } else {
        updateAges();
      }
      return collection;
    },
    focus(id) {
      if (!markers.has(id)) return;
      if (!map.hasLayer(group)) group.addTo(map);
      openers.get(id)();
    },
  };
}

export function earthquakeLegend() {
  const sizes = [4, 5, 6, 7]
    .map((m) => {
      const d = 2 * magnitudeRadius(m);
      return `<span class="legend-size"><span class="quake-swatch" style="width:${d}px;height:${d}px"></span>M${m}</span>`;
    })
    .join('');
  const depths = DEPTH_CLASSES.map(
    (c) => `<div class="legend-row"><span class="quake-swatch" style="--c:${c.color}"></span>${c.label}</div>`,
  ).join('');
  return `<div class="legend-sizes">${sizes}</div>${depths}
    <div class="legend-row"><span class="quake-swatch quake-swatch--wave" style="--c:${DEPTH_CLASSES[0].color}"></span>Bergelombang: terjadi &lt; 24 jam</div>
    <div class="legend-row"><span class="quake-swatch quake-swatch--wave" style="--c:var(--danger)"></span>Gempa paling baru</div>
    <p class="legend-note">Makin pudar, makin lama terjadinya (sampai 7 hari).</p>`;
}
