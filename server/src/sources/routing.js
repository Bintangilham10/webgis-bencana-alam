import { fetchJson, HttpError, postJson } from '../lib/http.js';

// Rute jalan dari OpenStreetMap lewat layanan publik FOSSGIS (yang dipakai
// openstreetmap.org), tanpa kunci API: Valhalla sebagai utama (rute alternatif dan
// poligon yang dihindari), OSRM sebagai cadangan. Valhalla FOSSGIS membatasi
// keliling total poligon yang dihindari 10 km (dicek 23 Okt 2026).
export const ATTRIBUTION = 'Rute: Valhalla/OSRM (FOSSGIS), data jalan © OpenStreetMap contributors';
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
const OSRM_URL = { jalan_kaki: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot', motor: 'https://routing.openstreetmap.de/routed-car/route/v1/driving', mobil: 'https://routing.openstreetmap.de/routed-car/route/v1/driving' };
export const MAX_EXCLUDE_PERIMETER_M = 10_000;

export const MODES = { jalan_kaki: 'pedestrian', motor: 'motorcycle', mobil: 'auto' };

// Polyline Valhalla: presisi 6 desimal, urutan lat,lon → [lon, lat].
export function decodePolyline6(encoded) {
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    coordinates.push([lon / 1e6, lat / 1e6]);
  }
  return coordinates;
}

const valhallaRoute = (trip) => ({
  geometry: { type: 'LineString', coordinates: trip.legs.flatMap((leg) => decodePolyline6(leg.shape)) },
  distance_m: Math.round(trip.summary.length * 1000),
  duration_s: Math.round(trip.summary.time),
});

// Rute dari Valhalla; `exclude` = cincin [lon, lat] yang tidak boleh dilewati.
// null bila Valhalla tidak menemukan rute (HTTP 400), mis. tujuan terkurung zona.
export async function valhallaRoutes({ from, to, mode, alternates = 2, exclude = [] }, { post = postJson } = {}) {
  const payload = {
    locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
    costing: MODES[mode],
    alternates,
    directions_type: 'none',
    units: 'kilometers',
    ...(exclude.length && { exclude_polygons: exclude }),
  };
  try {
    const json = await post(VALHALLA_URL, payload, { timeoutMs: 20_000, retries: 0 });
    return [json.trip, ...(json.alternates ?? []).map((alt) => alt.trip)].filter(Boolean).map(valhallaRoute);
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) return null;
    throw err;
  }
}

export async function osrmRoutes({ from, to, mode }, { getJson = fetchJson } = {}) {
  const url = `${OSRM_URL[mode]}/${from.lon},${from.lat};${to.lon},${to.lat}?alternatives=2&overview=full&geometries=geojson`;
  try {
    const json = await getJson(url, { timeoutMs: 20_000, retries: 0 });
    if (json.code !== 'Ok') return null;
    return json.routes.map((r) => ({ geometry: r.geometry, distance_m: Math.round(r.distance), duration_s: Math.round(r.duration) }));
  } catch (err) {
    // OSRM menjawab 400 "NoRoute" bila tidak ada jalan yang menghubungkan.
    if (err instanceof HttpError && err.status === 400) return null;
    throw err;
  }
}
