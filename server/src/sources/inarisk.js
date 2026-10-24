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
// Layanan yang gagal ditandai bermasalah dan dilewati semua cek risiko. Tanpa ini,
// satu layanan yang mati (1 Okt 2026: cuaca ekstrem membalas HTTP 525 setelah ±26
// detik; 23–24 Okt: banjir dan longsor tidak menjawab semalaman) membuat cek risiko
// menunggu sampai batas waktu. Layanan itu dicoba lagi di latar belakang tiap
// PROBE_MS di satu titik, bukan lewat permintaan pengguna, jadi pengunjung tidak
// menunggu layanan yang sudah diketahui mati, sejarang apa pun mereka datang.
export const PROBE_MS = 2 * 60_000;
const PROBE_POINT = { lat: -6.9, lon: 107.6 };

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
// Tanpa coba ulang, karena pengguna sedang menunggu. schedule dapat diganti saat test.
export function createHazardIdentifier({ getJson = fetchJson, probeMs = PROBE_MS, schedule = setTimeout } = {}) {
  const outages = new Map();
  let probeTimer = null;
  const identify = async (service, lat, lon) =>
    parseIdentifyValue(await getJson(identifyUrl(service, lat, lon), { timeoutMs: IDENTIFY_TIMEOUT_MS, retries: 0 }));

  async function probe() {
    probeTimer = null;
    await Promise.all(
      [...outages.keys()].map(async (service) => {
        try {
          await identify(service, PROBE_POINT.lat, PROBE_POINT.lon);
          outages.delete(service);
        } catch (err) {
          outages.set(service, err.message.slice(0, 120));
        }
      }),
    );
    if (outages.size) scheduleProbe();
  }

  function scheduleProbe() {
    if (probeTimer) return;
    probeTimer = schedule(probe, probeMs);
    // Pemeriksaan latar tidak menahan proses tetap hidup (mis. saat test selesai).
    probeTimer?.unref?.();
  }

  return async function identifyHazards(lat, lon) {
    const entries = await Promise.all(
      HAZARDS.map(async ({ id, service }) => {
        if (outages.has(service)) {
          return [id, { index: null, error: `layanan InaRISK sedang bermasalah (${outages.get(service)}); dicoba lagi otomatis` }];
        }
        try {
          return [id, { index: await identify(service, lat, lon) }];
        } catch (err) {
          outages.set(service, err.message.slice(0, 120));
          scheduleProbe();
          return [id, { index: null, error: err.message }];
        }
      }),
    );
    return Object.fromEntries(entries);
  };
}

export const identifyHazards = createHazardIdentifier();
