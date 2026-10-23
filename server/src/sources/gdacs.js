import { fetchText } from '../lib/http.js';
import { REGION } from './usgs-gempa.js';

// GDACS (Global Disaster Alert and Coordination System), sistem peringatan
// bencana Komisi Eropa (JRC) dan PBB (OCHA): gempa, tsunami, banjir, gunung api,
// siklon tropis, kekeringan, dan kebakaran hutan beserta level Hijau, Oranye,
// atau Merah menurut perkiraan dampak kemanusiaannya. Data boleh dipakai ulang
// dengan mencantumkan GDACS.
const SEARCH_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
export const ATTRIBUTION = 'Peringatan bencana: GDACS (Komisi Eropa JRC dan PBB OCHA)';

const DAY_MS = 24 * 60 * 60 * 1000;
// Oranye dan Merah (peringatan sungguhan) setahun terakhir. Hijau (dampak kecil)
// hanya 7 hari terakhir, karena di Indonesia ±170 per bulan, kebanyakan titik
// api dan gempa yang sudah tampil di lapisan gempa.
export const ALERT_DAYS = 365;
export const GREEN_DAYS = 7;
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

export const EVENT_TYPES = {
  EQ: 'Gempa bumi',
  TS: 'Tsunami',
  FL: 'Banjir',
  VO: 'Erupsi gunung api',
  TC: 'Siklon tropis',
  DR: 'Kekeringan',
  WF: 'Kebakaran hutan dan lahan',
};
const LEVELS = { Green: 'green', Orange: 'orange', Red: 'red' };

const day = (date) => date.toISOString().slice(0, 10);
// Waktu GDACS tanpa zona waktu = UTC.
const utc = (value) => (value ? new Date(/Z|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`).toISOString() : null);
const gdacsUrl = (value) => (typeof value === 'string' && /^https:\/\/www\.gdacs\.org\//.test(value) ? value : null);
// Banjir GDACS selalu berketerangan "Magnitude 0", yang tidak berarti apa-apa.
const severityText = (text) => (text && !/^magnitude 0(\.0+)?$/i.test(text) ? text : null);

// Kejadian lintas negara bisa bertitik di negara lain, mis. banjir Indonesia–
// Malaysia–Thailand Desember 2025 di Bangkok; yang di luar kawasan Indonesia dilewati.
const inRegion = ({ lon, lat }) => lat >= REGION.south && lat <= REGION.north && lon >= REGION.west && lon <= REGION.east;

// Ikon pin tidak diambil dari field `icon` GDACS: ikon itu mengikuti episode
// terakhir dan bisa berbeda dari level kejadian (mis. banjir Oranye berikon Hijau).
// Web menurunkannya dari jenis dan level (layers/gdacs.js).
export function normalizeEvent(feature) {
  const p = feature?.properties ?? {};
  const [lon, lat] = feature?.geometry?.coordinates ?? [];
  const level = LEVELS[p.alertlevel];
  if (!EVENT_TYPES[p.eventtype] || !level || ![lon, lat].every(Number.isFinite)) return null;
  return {
    id: `${p.eventtype}-${p.eventid}`,
    type: p.eventtype,
    type_label: EVENT_TYPES[p.eventtype],
    level,
    name: p.eventname || null,
    from: utc(p.fromdate),
    to: utc(p.todate),
    current: p.iscurrent === 'true',
    severity: severityText(p.severitydata?.severitytext?.trim()),
    countries: (p.affectedcountries ?? []).map((c) => c.countryname).filter(Boolean),
    // Sumber pemicu GDACS, mis. GLOFAS untuk banjir.
    origin: p.source || null,
    report_url: gdacsUrl(p.url?.report),
    modified: utc(p.datemodified),
    lon,
    lat,
  };
}

export function extractEvents(json) {
  if (!Array.isArray(json?.features)) throw new Error('format GDACS tidak dikenal: features tidak ada');
  return json.features.map(normalizeEvent).filter((event) => event && inRegion(event));
}

// GDACS membalas HTTP 204 tanpa isi bila tidak ada kejadian, juga untuk halaman
// sesudah halaman terakhir.
async function fetchGdacsJson(url, options) {
  const text = await fetchText(url, options);
  return text.trim() ? JSON.parse(text) : { type: 'FeatureCollection', features: [] };
}

// Satu kejadian bisa muncul lagi di halaman lain atau sebagai episode baru; yang
// dipakai adalah versi yang paling akhir diubah.
function latestById(events) {
  const byId = new Map();
  for (const event of events) {
    const seen = byId.get(event.id);
    if (!seen || (event.modified ?? '') > (seen.modified ?? '')) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => (b.from ?? '').localeCompare(a.from ?? ''));
}

async function search(params, getJson) {
  const events = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({ ...params, country: 'Indonesia', pagesize: String(PAGE_SIZE), pagenumber: String(page) });
    const json = await getJson(`${SEARCH_URL}?${query}`, { timeoutMs: 30_000 });
    const batch = extractEvents(json);
    events.push(...batch);
    if ((json.features?.length ?? 0) < PAGE_SIZE) break;
  }
  return events;
}

export async function fetchGdacsEvents({ now = new Date(), getJson = fetchGdacsJson } = {}) {
  const todate = day(new Date(now.getTime() + DAY_MS));
  const [alerts, green] = await Promise.all([
    search({ fromdate: day(new Date(now.getTime() - ALERT_DAYS * DAY_MS)), todate, alertlevel: 'Orange;Red' }, getJson),
    search({ fromdate: day(new Date(now.getTime() - GREEN_DAYS * DAY_MS)), todate, alertlevel: 'Green' }, getJson),
  ]);
  // Hijau tanpa gempa: gempa sudah ada di lapisan gempa BMKG, USGS, dan EMSC.
  return latestById([...alerts, ...green.filter((e) => e.type !== 'EQ')]);
}
