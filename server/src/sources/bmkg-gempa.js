import { fetchJson } from '../lib/http.js';
import { compactTimestamp } from '../lib/time.js';

export const FEEDS = {
  autogempa: 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json',
  gempaterkini: 'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json',
  gempadirasakan: 'https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json',
};

const SHAKEMAP_BASE_URL = 'https://data.bmkg.go.id/DataMKG/TEWS/';

// autogempa berisi satu objek, dua feed lainnya berisi array.
export function extractEvents(json) {
  const gempa = json?.Infogempa?.gempa;
  if (!gempa) throw new Error('format tidak dikenal: Infogempa.gempa tidak ada');
  return Array.isArray(gempa) ? gempa : [gempa];
}

// Satu gempa bisa muncul di beberapa feed dengan field berbeda (Potensi,
// Dirasakan, Shakemap); id dari waktu kejadian menyatukannya.
export function normalizeEvent(raw) {
  // BMKG menulis koordinat sebagai "lat,lon", kebalikan urutan GeoJSON.
  const [lat, lon] = String(raw.Coordinates).split(',').map(Number);
  const magnitude = Number.parseFloat(raw.Magnitude);
  const depthKm = Number.parseFloat(raw.Kedalaman);
  if (![lat, lon, magnitude, depthKm].every(Number.isFinite)) {
    throw new Error(`Data gempa BMKG tidak lengkap: ${JSON.stringify(raw)}`);
  }

  const props = {
    wilayah: raw.Wilayah,
    potensi: raw.Potensi,
    dirasakan: raw.Dirasakan,
    shakemap: raw.Shakemap ? SHAKEMAP_BASE_URL + raw.Shakemap : undefined,
  };
  return {
    id: `bmkg:${compactTimestamp(raw.DateTime)}`,
    source: 'bmkg',
    hazard: 'gempa',
    magnitude,
    depthKm,
    occurredAt: new Date(raw.DateTime).toISOString(),
    lat,
    lon,
    props: Object.fromEntries(Object.entries(props).filter(([, value]) => value)),
  };
}

export async function fetchBmkgEarthquakes() {
  const events = [];
  const errors = [];
  for (const [feed, url] of Object.entries(FEEDS)) {
    try {
      events.push(...extractEvents(await fetchJson(url)).map(normalizeEvent));
    } catch (err) {
      errors.push(`${feed}: ${err.message}`);
    }
  }
  if (errors.length === Object.keys(FEEDS).length) throw new Error(errors.join('; '));
  return { events, errors };
}
