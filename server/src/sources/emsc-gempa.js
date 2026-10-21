import { fetchText } from '../lib/http.js';
import { REGION } from './usgs-gempa.js';

// API FDSN membalas HTTP 204 tanpa isi bila tidak ada gempa dalam rentang itu.
async function fetchFdsnJson(url, options) {
  const text = await fetchText(url, options);
  return text.trim() ? JSON.parse(text) : { type: 'FeatureCollection', features: [] };
}

// Katalog gempa EMSC (European-Mediterranean Seismological Centre) lewat API
// FDSN. Di kawasan Indonesia sebagian besar gempanya berasal dari katalog BMKG
// (1.160 dari 1.344 gempa, 19 Sep–19 Okt 2026), termasuk gempa kecil mulai ±M1
// yang tidak dimuat feed publik BMKG (hanya M ≥ 5 dan gempa dirasakan). Sisanya
// dari EMSC sendiri, USGS (NEIC), MetMalaysia (MMD), GFZ, dan lainnya.
const QUERY_URL = 'https://www.seismicportal.eu/fdsnws/event/1/query';
const DAY_MS = 24 * 60 * 60 * 1000;
// Rentang yang diminta: 1 hari untuk sinkronisasi rutin, 8 hari untuk mengisi
// celah saat server lama mati (dipilih di jobs/sync-earthquakes.js).
export const FEED_DAYS = { day: 1, week: 8 };

export const eventUrl = (unid) => `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(unid)}`;

export function queryUrl({ feed = 'day', now = Date.now() } = {}) {
  const params = new URLSearchParams({
    minlat: String(REGION.south),
    maxlat: String(REGION.north),
    minlon: String(REGION.west),
    maxlon: String(REGION.east),
    starttime: new Date(now - FEED_DAYS[feed] * DAY_MS).toISOString().slice(0, 19),
    format: 'json',
    limit: '5000',
  });
  return `${QUERY_URL}?${params}`;
}

export function normalizeEvent(feature) {
  const p = feature?.properties ?? {};
  // Kedalaman di geometry bertanda negatif; di properties positif (km).
  const values = [p.lat, p.lon, p.depth, p.mag].map(Number);
  if (!p.unid || !p.time || !values.every(Number.isFinite)) return null;
  const [lat, lon, depthKm, magnitude] = values;
  const props = {
    wilayah: p.flynn_region,
    // Lembaga yang menentukan lokasi dan magnitudo, mis. BMKG.
    auth: p.auth,
    mag_type: p.magtype,
    url: eventUrl(p.unid),
  };
  return {
    id: `emsc:${p.unid}`,
    source: 'emsc',
    hazard: 'gempa',
    magnitude,
    depthKm,
    occurredAt: new Date(p.time).toISOString(),
    lat,
    lon,
    props: Object.fromEntries(Object.entries(props).filter(([, value]) => value)),
  };
}

export function extractEvents(json) {
  if (!Array.isArray(json?.features)) throw new Error('format EMSC tidak dikenal: features tidak ada');
  return json.features.map(normalizeEvent).filter(Boolean);
}

export async function fetchEmscEarthquakes({ feed = 'day', now = Date.now(), getJson = fetchFdsnJson } = {}) {
  return { events: extractEvents(await getJson(queryUrl({ feed, now }), { timeoutMs: 30_000 })), errors: [] };
}
