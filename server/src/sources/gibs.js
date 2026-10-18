import { fetchText } from '../lib/http.js';

// Citra satelit lewat NASA GIBS: hujan NASA GPM IMERG (Early Run, rata-rata 30
// menit) dan awan inframerah Himawari-9 milik JMA Jepang (tiap 10 menit). Petak
// peta diambil langsung oleh browser; server hanya mencari waktu data terbaru
// supaya peta dan legendanya menyebut jam pengamatan yang sama.
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const DAY_MS = 24 * 60 * 60 * 1000;

export const IMERG = { layer: 'IMERG_Precipitation_Rate_30min', matrixSet: 'GoogleMapsCompatible_Level6', lookbackMs: 2 * DAY_MS };
// Kanal 13 (inframerah ±10,4 µm): suhu puncak awan, siang maupun malam.
export const HIMAWARI = { layer: 'Himawari_AHI_Band13_Clean_Infrared', matrixSet: 'GoogleMapsCompatible_Level6', lookbackMs: DAY_MS };

export const tileUrl = ({ layer, matrixSet }, time) => `${GIBS}/${layer}/default/${time}/${matrixSet}/{z}/{y}/{x}.png`;

const iso = (date) => `${date.toISOString().slice(0, 19)}Z`;

// Domain waktu GIBS: rentang "awal/akhir/PT30M" dipisah koma; waktu terbaru =
// akhir rentang terakhir, mis. "2026-09-27/2026-09-27T11:30:00Z/PT30M".
export function latestTime(domainsXml) {
  const domain = domainsXml.match(/<Domain>([^<]+)<\/Domain>/)?.[1];
  const end = domain?.split(',').at(-1)?.split('/')[1]?.trim();
  if (!end || Number.isNaN(Date.parse(end))) throw new Error('Domain waktu GIBS tidak dikenal');
  return iso(new Date(end));
}

async function fetchLatest(product, now) {
  const from = iso(new Date(now.getTime() - product.lookbackMs));
  const url = `${GIBS}/1.0.0/${product.layer}/default/${product.matrixSet}/all/${from}--${iso(now)}.xml`;
  const time = latestTime(await fetchText(url, { timeoutMs: 15_000 }));
  return { layer: product.layer, time, tile_url: tileUrl(product, time) };
}

export const fetchLatestImerg = (now = new Date()) => fetchLatest(IMERG, now);
export const fetchLatestHimawari = (now = new Date()) => fetchLatest(HIMAWARI, now);
