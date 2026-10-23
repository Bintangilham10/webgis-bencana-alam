import { fetchText } from '../lib/http.js';

// Titik evakuasi dan fasilitas penting dari OpenStreetMap lewat Overpass API.
// Satu query nasional (±18 ribu objek, ±6 MB, ±2 menit) cukup seminggu sekali;
// pencarian terdekat dilakukan PostGIS. Server Overpass publik sering penuh
// ("at capacity"), jadi beberapa server dicoba bergantian. Data © OpenStreetMap
// contributors, ODbL.
export const ATTRIBUTION = 'Titik evakuasi dan fasilitas: © OpenStreetMap contributors (ODbL)';
export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Tag evakuasi yang dipakai di Indonesia (taginfo Geofabrik, Okt 2026):
// evacuation_center=yes (skema InaSAFE/HOT, ±970), emergency=assembly_point
// (±280), emergency="rekomendasi titik pengungsian" (±250, ejaan beragam), dan
// social_facility=shelter (±130). amenity=shelter sengaja tidak dipakai karena
// sebagian besar berupa gazebo dan halte.
export const QUERY = `[out:json][timeout:240];
area["ISO3166-1"="ID"][admin_level=2]->.id;
(
  nwr["emergency"="assembly_point"](area.id);
  nwr["emergency"~"pengungsian",i](area.id);
  nwr["evacuation_center"="yes"](area.id);
  nwr["social_facility"="shelter"](area.id);
  nwr["amenity"~"^(hospital|clinic|police|fire_station)$"](area.id);
);
out center tags;`;

const AMENITY_CATEGORY = { hospital: 'rumah_sakit', clinic: 'klinik', police: 'polisi', fire_station: 'pemadam' };

// social_facility=shelter juga dipakai untuk penampungan tunawisma (34 dari 127,
// Okt 2026) dan pengungsi luar negeri; hanya yang tidak dikhususkan untuk kelompok
// lain (sebagian besar posko dan titik pengungsian bencana) yang dipakai.
const DISASTER_SHELTER_FOR = new Set([undefined, 'displaced', 'victim', 'disaster']);

// Tempat evakuasi didahulukan: sekolah atau rumah sakit yang ditandai sebagai
// tempat evakuasi masuk kategori evakuasi.
export function categoryOf(tags = {}) {
  const shelter = tags.social_facility === 'shelter' && DISASTER_SHELTER_FOR.has(tags['social_facility:for']);
  if (tags.evacuation_center === 'yes' || /pengungsian/i.test(tags.emergency ?? '') || shelter) return 'evakuasi';
  if (tags.emergency === 'assembly_point') return 'titik_kumpul';
  return AMENITY_CATEGORY[tags.amenity] ?? null;
}

// Tag yang ikut disimpan untuk popup; sisanya dibuang supaya tabel tetap kecil.
const KEPT_TAGS = ['name', 'amenity', 'leisure', 'building', 'emergency', 'evacuation_center', 'healthcare', 'operator', 'addr:full', 'addr:street', 'capacity', 'phone'];

export function extractFacilities(json) {
  if (!Array.isArray(json?.elements)) throw new Error('format Overpass tidak dikenal: elements tidak ada');
  // Overpass menulis galat waktu proses di `remark` dan tetap mengirim hasil sebagian.
  if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(`Overpass: ${json.remark}`);
  return json.elements
    .map((e) => {
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      const category = categoryOf(e.tags);
      if (!category || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const tags = Object.fromEntries(KEPT_TAGS.filter((key) => e.tags[key]).map((key) => [key, e.tags[key]]));
      return { id: `${e.type}/${e.id}`, category, name: e.tags.name?.trim() || null, tags, lat, lon };
    })
    .filter(Boolean);
}

export async function fetchFacilities({ getText = fetchText, endpoints = ENDPOINTS } = {}) {
  const errors = [];
  for (const url of endpoints) {
    try {
      const body = new URLSearchParams({ data: QUERY });
      const text = await getText(`${url}?${body}`, { timeoutMs: 300_000, retries: 0 });
      return extractFacilities(JSON.parse(text));
    } catch (err) {
      errors.push(`${new URL(url).host}: ${err.message}`);
    }
  }
  throw new Error(`Semua server Overpass gagal (${errors.join('; ')})`);
}
