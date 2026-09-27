import { fetchText } from '../lib/http.js';

// Hujan satelit NASA GPM IMERG (Early Run, rata-rata 30 menit) lewat NASA GIBS.
// Petak peta diambil langsung oleh browser; server hanya mencari waktu data
// terbaru supaya peta dan legendanya menyebut jam pengamatan yang sama.
export const IMERG_LAYER = 'IMERG_Precipitation_Rate_30min';
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const MATRIX_SET = 'GoogleMapsCompatible_Level6';
const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

export const imergTileUrl = (time) => `${GIBS}/${IMERG_LAYER}/default/${time}/${MATRIX_SET}/{z}/{y}/{x}.png`;

const iso = (date) => `${date.toISOString().slice(0, 19)}Z`;

// Domain waktu GIBS: rentang "awal/akhir/PT30M" dipisah koma; waktu terbaru =
// akhir rentang terakhir, mis. "2026-09-27/2026-09-27T11:30:00Z/PT30M".
export function latestTime(domainsXml) {
  const domain = domainsXml.match(/<Domain>([^<]+)<\/Domain>/)?.[1];
  const end = domain?.split(',').at(-1)?.split('/')[1]?.trim();
  if (!end || Number.isNaN(Date.parse(end))) throw new Error('Domain waktu GIBS tidak dikenal');
  return iso(new Date(end));
}

export async function fetchLatestImerg(now = new Date()) {
  const from = iso(new Date(now.getTime() - LOOKBACK_MS));
  const url = `${GIBS}/1.0.0/${IMERG_LAYER}/default/${MATRIX_SET}/all/${from}--${iso(now)}.xml`;
  const time = latestTime(await fetchText(url, { timeoutMs: 15_000 }));
  return { layer: IMERG_LAYER, time, tile_url: imergTileUrl(time) };
}
