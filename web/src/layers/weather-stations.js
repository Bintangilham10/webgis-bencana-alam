import L from 'leaflet';
import { getJson } from '../lib/api.js';
import { escapeHtml, formatClock, formatDay, formatDayClock, formatDecimal } from '../lib/format.js';
import { makeFocusable } from '../lib/marker-focus.js';
import { pillStyle, RAIN_DAILY_CLASSES, RAIN_DRY, rainDailyClass } from '../lib/symbology.js';

// Hujan terukur di stasiun cuaca BMKG. Alat ukurnya di Indonesia; laporannya
// (SYNOP) dipertukarkan lewat jaringan WMO dan diambil server dari gerbang NOAA
// (Amerika Serikat). Tiap stasiun digambar sebagai angka mm hujan 24 jam
// terakhir, berwarna menurut kategori hujan harian BMKG. Semua stasiun memakai
// periode yang sama (sampai jam utama terakhir: 07.00, 13.00, 19.00, atau 01.00 WIB).

const FOCUS_ZOOM = 9;
const REFRESH_MS = 10 * 60_000;
// Grafik harian baru berarti bila ada beberapa hari; kurang dari itu cukup angka.
const MIN_CHART_DAYS = 3;
// Tinggi kolom penuh minimal setara 20 mm, supaya hujan ringan tidak tampak besar.
const MIN_SCALE_MM = 20;

const LIVE_KEY = 'stasiun-hujan';
let legendPeriod = 'Memuat laporan stasiun…';
function setLegendPeriod(text) {
  legendPeriod = text;
  for (const el of document.querySelectorAll(`[data-legend-live="${LIVE_KEY}"]`)) el.textContent = text;
}

// Angka di penanda: bulat mulai 10 mm, satu desimal di bawahnya, "–" tanpa laporan.
function rainNumber(rain) {
  if (!rain) return '–';
  return rain.mm >= 10 ? String(Math.round(rain.mm)) : formatDecimal(rain.mm);
}

// Urutan tumpuk terhadap penanda lain (gunung api, titik evakuasi): stasiun
// kering paling bawah, hujan ringan–sedang di bawah penanda lain, dan hujan
// lebat ke atas (≥ 50 mm) di atasnya supaya tidak tersembunyi.
const HEAVY_RAIN_MM = 50;
function stackOrder(rain) {
  if (!rain || rain.mm < 0.5) return -20_000;
  return (rain.mm >= HEAVY_RAIN_MM ? 5_000 : -10_000) + Math.round(rain.mm * 10);
}

const amountText = (rain) => (rain.trace ? 'tak terukur (< 0,1 mm)' : `${formatDecimal(rain.mm)} mm`);
const categoryText = (rain) => rain.category_label ?? 'Tidak hujan';
const isPartial = (rain) => Boolean(rain) && rain.hours < 24;

function stationIcon(p, index) {
  const partial = isPartial(p.rain) ? ' is-partial' : '';
  // Stasiun kering atau tanpa laporan digambar redup supaya yang menonjol hanya hujan.
  const dry = p.rain?.category ? '' : ' is-dry';
  const label = p.rain ? `${amountText(p.rain)} dalam ${p.rain.hours} jam` : 'tanpa laporan hujan';
  return L.divIcon({
    className: 'rain-station-icon',
    html: `<span class="rain-station${partial}${dry}" style="${pillStyle(rainDailyClass(p.rain?.category))};--i:${index}" role="img" aria-label="Stasiun ${escapeHtml(p.nama)}: ${label}">${rainNumber(p.rain)}</span>`,
    iconSize: [30, 18],
    tooltipAnchor: [0, -9],
    popupAnchor: [0, -9],
  });
}

function rainFact(p, until) {
  if (!p.rain) return '<dt>Hujan</dt><dd>Stasiun tidak melaporkan hujan pada jam ini</dd>';
  const partial = isPartial(p.rain) ? '<span class="muted"> · laporan sebelumnya belum lengkap</span>' : '';
  return `<dt>Hujan ${p.rain.hours} jam</dt>
    <dd><strong>${amountText(p.rain)}</strong> · ${escapeHtml(categoryText(p.rain))} <span class="muted">sampai ${formatDayClock(until)}</span>${partial}</dd>`;
}

function weatherFacts(p) {
  const rows = [];
  if (p.weather?.label) rows.push(`<dt>Cuaca</dt><dd>${escapeHtml(p.weather.label)} <span class="muted">${formatClock(p.observed_at)}</span></dd>`);
  if (Number.isFinite(p.temp_c)) rows.push(`<dt>Suhu</dt><dd>${formatDecimal(p.temp_c)} °C <span class="muted">${formatClock(p.observed_at)}</span></dd>`);
  if (p.metar) {
    const airport = p.metar.weather ?? 'Tanpa hujan atau badai';
    rows.push(`<dt>Bandara</dt><dd>${escapeHtml(airport)} <span class="muted">METAR ${formatClock(p.metar.observed_at)}</span></dd>`);
  }
  return rows.join('');
}

// Tanggal akhir periode 24 jam (07.00 WIB) → "Rab, 11/11" dan "11".
const wibDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
const wibDayNumber = new Intl.DateTimeFormat('id-ID', { day: 'numeric', timeZone: 'Asia/Jakarta' });
const dayLabel = (day) => formatDay(wibDate.format(new Date(day.until)));
const dayNumber = (day) => wibDayNumber.format(new Date(day.until));
const dayReadout = (day) => `${dayLabel(day)} · ${amountText(day)}`;

// Total harian sampai 7 hari: kolom satu warna (tingginya sudah menyatakan
// jumlah), angka hanya di kolom tertinggi dan terakhir, dan satu baris bacaan
// yang mengikuti kolom yang disentuh atau difokus.
function dailyChart(days) {
  if (days.length < MIN_CHART_DAYS) {
    const last = days.at(-1);
    return last ? `<p class="station-days__single">Hari hujan terakhir (24 jam sampai ${formatDayClock(last.until)}): <strong>${amountText(last)}</strong></p>` : '';
  }
  const scale = Math.max(MIN_SCALE_MM, ...days.map((day) => day.mm));
  const peak = days.reduce((max, day) => (day.mm > max.mm ? day : max));
  const last = days.at(-1);
  const columns = days
    .map((day) => {
      const labelled = (day === peak || day === last) && day.mm > 0;
      const value = labelled ? `<span class="station-days__value">${rainNumber(day)}</span>` : '';
      const height = ((day.mm / scale) * 100).toFixed(1);
      return `<button type="button" class="station-days__col" data-readout="${escapeHtml(dayReadout(day))}" aria-label="${escapeHtml(dayReadout(day))}">
          ${value}<span class="station-days__bar" style="--h:${height}"></span><span class="station-days__tick">${dayNumber(day)}</span>
        </button>`;
    })
    .join('');
  return `
    <figure class="station-days">
      <figcaption>Hujan harian <span class="muted">mm · 24 jam sampai 07.00 WIB tanggal itu</span></figcaption>
      <div class="station-days__plot">${columns}</div>
      <p class="station-days__readout" aria-live="polite">${escapeHtml(dayReadout(last))}</p>
    </figure>`;
}

export function stationPopup(p, until) {
  const place = [p.wilayah, p.provinsi].filter(Boolean).join(', ');
  return `
    <div class="popup">
      <div class="popup-head">
        <span class="rain-badge" style="${pillStyle(rainDailyClass(p.rain?.category))}">${rainNumber(p.rain)}<small>mm</small></span>
        <div class="popup-heading">
          <h3>Stasiun ${escapeHtml(p.nama)}</h3>
          <p class="popup-sub">${escapeHtml(place)}</p>
        </div>
      </div>
      <dl class="popup-facts">${rainFact(p, until)}${weatherFacts(p)}</dl>
      ${dailyChart(p.days)}
      <p class="popup-source">Ditakar di stasiun cuaca BMKG (nomor WMO ${escapeHtml(p.wmo)}). Laporan lewat jaringan WMO, diambil dari NOAA (Amerika Serikat).</p>
    </div>`;
}

// Kolom grafik yang disentuh atau difokus mengisi baris bacaan di bawahnya.
function wireChart(popup) {
  const figure = popup.getElement()?.querySelector('.station-days');
  const readout = figure?.querySelector('.station-days__readout');
  if (!readout) return;
  const show = (event) => {
    const column = event.target.closest('.station-days__col');
    if (column) readout.textContent = column.dataset.readout;
  };
  figure.addEventListener('pointerover', show);
  figure.addEventListener('focusin', show);
  figure.addEventListener('click', show);
}

// Data dimuat saat lapisan dinyalakan dan diperbarui tiap 10 menit selama menyala.
export function createWeatherStationLayer(map, { viewPadding, onLoad, onError } = {}) {
  const group = L.featureGroup();
  const markers = new Map();
  const openers = new Map();
  let signature = '';
  let timer = null;

  function render(collection) {
    const { until } = collection.meta;
    // Popup yang sedang dibaca dibuka lagi setelah data diperbarui.
    const openId = [...markers].find(([, marker]) => marker.isPopupOpen())?.[0];
    markers.clear();
    openers.clear();
    group.clearLayers();
    collection.features.forEach(({ geometry, properties: p }, index) => {
      const [lon, lat] = geometry.coordinates;
      const amount = p.rain ? `${amountText(p.rain)} / ${p.rain.hours} jam` : 'tanpa laporan hujan';
      const marker = L.marker([lat, lon], { icon: stationIcon(p, index), zIndexOffset: stackOrder(p.rain) }).bindTooltip(
        `${escapeHtml(p.nama)} · ${amount}`,
        { direction: 'top' },
      );
      openers.set(p.wmo, makeFocusable(map, marker, { zoom: FOCUS_ZOOM, popup: () => stationPopup(p, until), viewPadding }));
      marker.on('popupopen', (event) => wireChart(event.popup));
      markers.set(p.wmo, marker);
      group.addLayer(marker);
    });
    openers.get(openId)?.({ fly: false });
  }

  async function load() {
    try {
      const collection = await getJson('/api/weather-stations');
      const { until, reporting } = collection.meta;
      setLegendPeriod(until ? `Sampai ${formatDayClock(until)} · ${reporting} stasiun melapor` : 'Belum ada laporan stasiun');
      const next = JSON.stringify([
        until,
        collection.features.map(({ properties: p }) => [p.wmo, p.rain?.mm, p.rain?.hours, p.observed_at, p.weather?.code, p.metar?.observed_at]),
      ]);
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

const legendRow = (c) =>
  `<div class="legend-row"><span class="rain-pill" style="${pillStyle(c)}"></span>${c.label} <span class="legend-dim">${c.range} mm</span></div>`;

export const weatherStationLegend = () => `
  <p class="legend-note" data-legend-live="${LIVE_KEY}">${escapeHtml(legendPeriod)}</p>
  ${[...RAIN_DAILY_CLASSES].reverse().map(legendRow).join('')}
  ${legendRow(RAIN_DRY)}
  <div class="legend-row"><span class="rain-pill rain-pill--partial"></span>Putus-putus: kurang dari 24 jam</div>
  <p class="legend-note">Angka = mm hujan yang ditakar penakar hujan di stasiun cuaca BMKG selama 24 jam terakhir, dengan kategori hujan harian BMKG. Stasiun melapor tiap 6 jam lewat jaringan WMO; SIGAP mengambilnya dari NOAA (Amerika Serikat) ±20 menit kemudian. Ini hasil ukur di satu titik, bukan prakiraan.</p>`;
