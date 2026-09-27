import { fetchText, HttpError } from '../lib/http.js';
import { featureInfoUrl, layerName, pad2, parseFeatureInfo, wibDate } from '../lib/recorder.js';

// Prakiraan Wilayah Potensi Terjadi Gerakan Tanah bulanan PVMBG (Portal MBG).
// Satu GetFeatureInfo memberi potensi bulan itu (`zona_perki`) dan zona
// kerentanan gerakan tanah/ZKGT (`unsur`) di titik yang diminta.

export function monthOf(now) {
  const [year, month] = wibDate(now).split('-').map(Number);
  return { year, month };
}

const previousMonth = ({ year, month }) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });
export const monthLabel = ({ year, month }) => `${year}-${pad2(month)}`;

// Firewall situs ESDM membalas halaman "Request Rejected" dengan status 200,
// dan GeoServer membalas XML untuk layer yang rusak (mis. 2025-12).
export function parseFeatureInfoText(text) {
  if (/Request Rejected/i.test(text.slice(0, 500))) throw new Error('permintaan diblokir firewall situs ESDM');
  if (text.trimStart().startsWith('<')) throw new Error('layer prakiraan PVMBG bulan ini rusak di server sumber');
  return parseFeatureInfo(JSON.parse(text));
}

// Prakiraan bulan ini; pada awal bulan layer baru kadang belum terbit (404),
// maka dipakai bulan sebelumnya dan ditandai `current: false`.
export async function fetchLandslidePotential(lat, lon, now = new Date()) {
  const thisMonth = monthOf(now);
  for (const month of [thisMonth, previousMonth(thisMonth)]) {
    let text;
    try {
      text = await fetchText(featureInfoUrl(layerName(month), { lat, lon }), { timeoutMs: 15_000, retries: 0 });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) continue;
      throw err;
    }
    const info = parseFeatureInfoText(text);
    return {
      month: monthLabel(month),
      current: month === thisMonth,
      potensi: info?.potensi ?? null,
      zkgt: info?.zkgt ?? null,
    };
  }
  throw new Error('prakiraan PVMBG bulan ini dan bulan lalu belum tersedia');
}
