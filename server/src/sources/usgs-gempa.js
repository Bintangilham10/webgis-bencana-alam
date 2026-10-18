import { fetchJson } from '../lib/http.js';

// Katalog gempa USGS (Amerika Serikat) sebagai pembanding BMKG. Data USGS berstatus
// public domain. Feed GeoJSON diperbarui tiap menit; feed harian (±20 KB) cukup
// untuk sinkronisasi rutin, feed mingguan (±250 KB) untuk mengisi celah saat server
// lama mati (dipilih di jobs/sync-earthquakes.js).
const FEED_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
export const FEEDS = {
  day: `${FEED_BASE}2.5_day.geojson`,
  week: `${FEED_BASE}2.5_week.geojson`,
};

// Sama dengan kawasan cek risiko (routes/risk.js). Di kawasan ini USGS mencatat
// gempa mulai ±M3,9, jadi feed M2,5+ dipakai supaya gempa di bawah M4,5 ikut.
export const REGION = { south: -12, north: 7, west: 94, east: 142 };

const inRegion = ([lon, lat]) =>
  lat >= REGION.south && lat <= REGION.north && lon >= REGION.west && lon <= REGION.east;

// Gempa tanpa magnitudo atau koordinat (jarang, biasanya baru dibuat) dilewati.
const isComplete = (feature) => {
  const [lon, lat, depthKm] = feature?.geometry?.coordinates ?? [];
  return [lon, lat, depthKm, feature?.properties?.mag, feature?.properties?.time].every(Number.isFinite);
};

// Penanda `tsunami` USGS sengaja tidak disimpan: itu hanya tanda gempa besar di
// laut, bukan peringatan. Peringatan tsunami untuk Indonesia tetap dari BMKG.
export function normalizeEvent(feature) {
  const [lon, lat, depthKm] = feature.geometry.coordinates;
  const p = feature.properties;
  const props = {
    wilayah: p.place,
    mag_type: p.magType,
    status: p.status,
    alert: p.alert,
    url: p.url,
  };
  return {
    id: `usgs:${feature.id}`,
    source: 'usgs',
    hazard: 'gempa',
    magnitude: p.mag,
    depthKm,
    occurredAt: new Date(p.time).toISOString(),
    lat,
    lon,
    props: Object.fromEntries(Object.entries(props).filter(([, value]) => value)),
  };
}

export function extractEvents(json) {
  if (!Array.isArray(json?.features)) throw new Error('format tidak dikenal: features tidak ada');
  return json.features.filter((f) => isComplete(f) && inRegion(f.geometry.coordinates)).map(normalizeEvent);
}

export async function fetchUsgsEarthquakes({ feed = 'day' } = {}) {
  return { events: extractEvents(await fetchJson(FEEDS[feed])), errors: [] };
}
