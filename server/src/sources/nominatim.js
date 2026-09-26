import { fetchJson } from '../lib/http.js';

// Kebijakan Nominatim (OSM Foundation): maksimal 1 request/detik, identitas
// aplikasi jelas, dan tanpa pencarian otomatis per ketikan (autocomplete).
const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1_100;

let lastRequestAt = 0;
let queue = Promise.resolve();

// Antrean global: request berikutnya menunggu sampai jeda minimal terpenuhi.
function waitForTurn() {
  const turn = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  queue = turn;
  return turn;
}

export function toPlace(result) {
  const [south, north, west, east] = result.boundingbox.map(Number);
  return {
    source: 'osm',
    name: result.name || result.display_name.split(',')[0],
    label: result.display_name,
    type: result.addresstype ?? result.type,
    lat: Number(result.lat),
    lon: Number(result.lon),
    bounds: [[south, west], [north, east]],
  };
}

export async function searchNominatim(q) {
  await waitForTurn();
  const params = new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'id', limit: '5', 'accept-language': 'id' });
  const results = await fetchJson(`${SEARCH_URL}?${params}`, { timeoutMs: 10_000, retries: 0 });
  return results.map(toPlace);
}
