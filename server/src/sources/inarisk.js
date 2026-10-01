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

// Server BNPB kadang butuh ±8 detik saat "dingin", jadi batasnya 10 detik.
const IDENTIFY_TIMEOUT_MS = 10_000;
// Layanan yang gagal dilewati sementara. Tanpa ini, satu layanan yang mati
// (1 Okt 2026: cuaca ekstrem membalas HTTP 525 setelah ±26 detik) membuat setiap
// cek risiko menunggu sampai batas waktu.
export const OUTAGE_MS = 5 * 60_000;

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
// Tanpa coba ulang, karena pengguna sedang menunggu. Layanan yang baru saja gagal
// tidak diminta lagi selama OUTAGE_MS; permintaan pertama sesudahnya mencoba lagi.
export function createHazardIdentifier({ getJson = fetchJson, now = Date.now } = {}) {
  const outages = new Map();
  return async function identifyHazards(lat, lon) {
    const entries = await Promise.all(
      HAZARDS.map(async ({ id, service }) => {
        const outage = outages.get(service);
        if (outage && now() - outage.at < OUTAGE_MS) {
          return [id, { index: null, error: `layanan InaRISK sedang bermasalah (${outage.message}); dicoba lagi otomatis` }];
        }
        try {
          const json = await getJson(identifyUrl(service, lat, lon), { timeoutMs: IDENTIFY_TIMEOUT_MS, retries: 0 });
          const index = parseIdentifyValue(json);
          outages.delete(service);
          return [id, { index }];
        } catch (err) {
          outages.set(service, { at: now(), message: err.message.slice(0, 120) });
          return [id, { index: null, error: err.message }];
        }
      }),
    );
    return Object.fromEntries(entries);
  };
}

export const identifyHazards = createHazardIdentifier();
