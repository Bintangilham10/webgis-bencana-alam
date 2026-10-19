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

// Produk tambahan USGS yang diambil dari detail gempa: PAGER (perkiraan dampak) dan
// ground failure (perkiraan longsor dan likuefaksi akibat gempa). Di kawasan
// Indonesia keduanya ada untuk ±120 dan ±55 gempa per tahun (Okt 2025–Okt 2026).
export const DETAIL_PRODUCTS = ['losspager', 'ground-failure'];

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
  // types = daftar produk, mis. ",dyfi,ground-failure,losspager,origin,".
  const types = String(p.types ?? '').split(',');
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
    // Untuk sinkronisasi detail (jobs/sync-earthquakes.js), tidak disimpan di props.
    code: feature.id,
    revision: Number.isFinite(p.updated) ? p.updated : null,
    hasDetail: DETAIL_PRODUCTS.some((type) => types.includes(type)),
  };
}

export function extractEvents(json) {
  if (!Array.isArray(json?.features)) throw new Error('format tidak dikenal: features tidak ada');
  return json.features.filter((f) => isComplete(f) && inRegion(f.geometry.coordinates)).map(normalizeEvent);
}

export async function fetchUsgsEarthquakes({ feed = 'day' } = {}) {
  return { events: extractEvents(await fetchJson(FEEDS[feed])), errors: [] };
}

// Detail satu gempa lewat API FDSN (juga untuk gempa yang sudah keluar dari feed).
export const detailUrl = (code) =>
  `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${encodeURIComponent(code)}&format=geojson`;

const LEVELS = new Set(['green', 'yellow', 'orange', 'red']);
const level = (value) => (LEVELS.has(value) ? value : null);
// Properti produk USGS selalu berupa teks.
const number = (value) => (value === undefined || value === null || value === '' ? null : Number(value));
const finite = (value) => (Number.isFinite(number(value)) ? number(value) : null);
const round = (value, digits) => (value === null ? null : Number(value.toFixed(digits)));

// Produk pilihan USGS = elemen pertama; produk yang dihapus dilewati.
const preferred = (products, type) => products?.[type]?.find((product) => product.status !== 'DELETE') ?? null;

const bounds = (p, prefix) => {
  const values = ['minimum-latitude', 'minimum-longitude', 'maximum-latitude', 'maximum-longitude'].map((key) =>
    finite(p[`${prefix}${key}`]),
  );
  if (values.some((value) => value === null)) return null;
  const [south, west, north, east] = values;
  return [[south, west], [north, east]];
};

// PAGER: level dampak keseluruhan beserta ringkasan PDF. Level korban jiwa dan
// kerugian ekonomi ada di alerts.json (diambil terpisah, lihat fetchUsgsDetail).
export function parsePager(products) {
  const product = preferred(products, 'losspager');
  if (!product) return null;
  const p = product.properties ?? {};
  return {
    alert: level(p.alertlevel),
    max_mmi: finite(p.maxmmi),
    reviewed: p['review-status'] === 'reviewed',
    onepager_url: product.contents?.['onepager.pdf']?.url ?? null,
    alerts_url: product.contents?.['alerts.json']?.url ?? null,
  };
}

export function parsePagerAlerts(json) {
  return { fatality: level(json?.fatality?.level), economic: level(json?.economic?.level) };
}

// Ground failure: untuk longsor (model Nowicki Jessee 2018) dan likuefaksi
// (Zhu 2017), level, luas terdampak (Aggregate Hazard, km²), penduduk terpapar,
// dan gambar PNG proporsi area terdampak beserta batasnya untuk ditampilkan di peta.
export function parseGroundFailure(products) {
  const product = preferred(products, 'ground-failure');
  if (!product) return null;
  const p = product.properties ?? {};
  const hazard = (kind) => {
    const overlay = p[`${kind}-overlay`];
    return {
      alert: level(p[`${kind}-alert`]),
      hazard_alert: level(p[`${kind}-hazard-alert-color`]),
      population_alert: level(p[`${kind}-population-alert-color`]),
      area_km2: round(finite(p[`${kind}-hazard-alert-value`]), 1),
      population: finite(p[`${kind}-population-alert-value`]),
      overlay_url: (overlay && product.contents?.[overlay]?.url) ?? null,
      bounds: bounds(p, `${kind}-`),
    };
  };
  return {
    landslide: hazard('landslide'),
    liquefaction: hazard('liquefaction'),
    // Wilayah yang paling terdampak, untuk mengarahkan peta.
    focus: bounds(p, ''),
    // true: guncangan dihitung dari titik pusat gempa tanpa model bidang
    // patahan, jadi perkiraan untuk gempa besar bisa meleset.
    rupture_warning: p['rupture-warning'] === 'True',
    updated_at: Number.isFinite(product.updateTime) ? new Date(product.updateTime).toISOString() : null,
  };
}

export function parseDetail(json) {
  const products = json?.properties?.products;
  if (!products) throw new Error('format detail USGS tidak dikenal: properties.products tidak ada');
  return { pager: parsePager(products), ground_failure: parseGroundFailure(products) };
}

export async function fetchUsgsDetail(code, { getJson = fetchJson } = {}) {
  const detail = parseDetail(await getJson(detailUrl(code), { timeoutMs: 20_000 }));
  if (detail.pager?.alerts_url) {
    // Gagal mengambil alerts.json tidak menggagalkan detail; level keseluruhan tetap ada.
    try {
      Object.assign(detail.pager, parsePagerAlerts(await getJson(detail.pager.alerts_url, { timeoutMs: 15_000, retries: 0 })));
    } catch {
      Object.assign(detail.pager, { fatality: null, economic: null });
    }
  }
  if (detail.pager) delete detail.pager.alerts_url;
  return detail;
}
