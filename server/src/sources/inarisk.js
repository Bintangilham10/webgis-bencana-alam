import { fetchJson } from '../lib/http.js';

const SERVICE_URL = 'https://gis.bnpb.go.id/server/rest/services/inarisk';

// Lima bahaya fokus sistem; id sama dengan layer peta di web/src/layers/hazards.js.
export const HAZARDS = [
  { id: 'gempa', label: 'Gempa bumi', service: 'INDEKS_BAHAYA_GEMPABUMI' },
  { id: 'cuaca', label: 'Cuaca ekstrem', service: 'INDEKS_BAHAYA_CUACAEKSTRIM' },
  { id: 'banjir', label: 'Banjir', service: 'INDEKS_BAHAYA_BANJIR' },
  { id: 'longsor', label: 'Tanah longsor', service: 'INDEKS_BAHAYA_TANAHLONGSOR' },
  { id: 'gunungapi', label: 'Gunung api', service: 'INDEKS_BAHAYA_GUNUNGAPI' },
];

// "NoData" = titik di luar zona bahaya (bukan data hilang).
export function parseIdentifyValue(json) {
  const value = json?.value;
  if (value === undefined) throw new Error(`Respons identify tidak dikenal: ${JSON.stringify(json).slice(0, 200)}`);
  if (value === 'NoData') return null;
  const index = Number.parseFloat(value);
  if (!Number.isFinite(index)) throw new Error(`Nilai indeks tidak valid: ${value}`);
  return index;
}

function identifyUrl(service, lat, lon) {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    returnGeometry: 'false',
    returnCatalogItems: 'false',
    f: 'json',
  });
  return `${SERVICE_URL}/${service}/ImageServer/identify?${params}`;
}

// Kelima layanan diminta paralel. Satu layanan yang gagal/lambat tidak
// menggagalkan yang lain: hasilnya ditandai error dan sisanya tetap dipakai.
// Tanpa coba ulang: pengguna sedang menunggu, dan server BNPB kadang butuh
// ±8 detik saat "dingin" sehingga coba ulang bisa melipatgandakan waktu tunggu.
export async function identifyHazards(lat, lon) {
  const entries = await Promise.all(
    HAZARDS.map(async ({ id, service }) => {
      try {
        const json = await fetchJson(identifyUrl(service, lat, lon), { timeoutMs: 15_000, retries: 0 });
        return [id, { index: parseIdentifyValue(json) }];
      } catch (err) {
        return [id, { index: null, error: err.message }];
      }
    }),
  );
  return Object.fromEntries(entries);
}
