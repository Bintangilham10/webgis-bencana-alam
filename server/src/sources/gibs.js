import { fetchText, urlExists } from '../lib/http.js';

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

// Durasi ISO 8601 di domain waktu, mis. "PT10M", dalam milidetik.
function durationMs(text) {
  const parts = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text?.trim() ?? '');
  if (!parts) return Number.NaN;
  const [days, hours, minutes, seconds] = parts.slice(1).map((value) => Number(value ?? 0));
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

// Domain waktu GIBS: rentang "awal/akhir/periode" dipisah koma, mis.
// "2026-09-27/2026-09-27T11:30:00Z/PT30M". Hasilnya `count` waktu terbaru, dari
// yang paling baru; jeda di antara rentang (mis. Himawari tidak memotret pukul
// 02.40 dan 14.40 UTC) ikut terlewati.
export function recentTimes(domainsXml, count) {
  const domain = domainsXml.match(/<Domain>([^<]+)<\/Domain>/)?.[1];
  const times = [];
  for (const range of (domain?.split(',') ?? []).reverse()) {
    const [start, end = start, period] = range.split('/');
    const from = Date.parse(start);
    const step = durationMs(period);
    let time = Date.parse(end);
    if (Number.isNaN(time)) break;
    if (!(step > 0) || Number.isNaN(from)) times.push(time);
    else for (; time >= from && times.length < count; time -= step) times.push(time);
    if (times.length >= count) break;
  }
  if (!times.length) throw new Error('Domain waktu GIBS tidak dikenal');
  return times.slice(0, count).map((time) => iso(new Date(time)));
}

export const latestTime = (domainsXml) => recentTimes(domainsXml, 1)[0];

// Waktu baru bisa masuk domain sebelum petaknya selesai dibuat. Himawari, 23 Okt
// 2026: petak 10.30Z baru lengkap ±35 menit kemudian, sementara 10.20Z masih
// bolong. Jadi dipakai waktu terbaru yang petak ujinya (z/y/x di atas Sumatra,
// Jawa, Kalimantan, Sulawesi, Maluku, dan Papua pada zoom peta 4–6) sudah ada,
// paling jauh CANDIDATES langkah ke belakang. Beberapa waktu sebelumnya dikirim
// sebagai cadangan untuk petak yang tetap belum ada (web/src/layers/landslide.js).
const PROBE_TILES = [
  '4/8/12', '4/8/13',
  '5/15/24', '5/16/25', '5/15/26', '5/16/27', '5/16/28',
  '6/31/49', '6/33/50', '6/32/51', '6/32/53', '6/32/57',
];
const CANDIDATES = 3;
const FALLBACKS = 3;

async function tilesReady(product, time, tileExists) {
  const ready = await Promise.all(
    PROBE_TILES.map((zyx) =>
      tileExists(`${GIBS}/${product.layer}/default/${time}/${product.matrixSet}/${zyx}.png`, { timeoutMs: 10_000 }).catch(() => false),
    ),
  );
  return ready.every(Boolean);
}

// getText dan tileExists dapat diganti saat test supaya tidak memanggil GIBS.
async function fetchLatest(product, now, { getText = fetchText, tileExists = urlExists } = {}) {
  const from = iso(new Date(now.getTime() - product.lookbackMs));
  const url = `${GIBS}/1.0.0/${product.layer}/default/${product.matrixSet}/all/${from}--${iso(now)}.xml`;
  const times = recentTimes(await getText(url, { timeoutMs: 15_000 }), CANDIDATES + FALLBACKS);
  const last = Math.min(CANDIDATES, times.length) - 1;
  let index = 0;
  while (index < last && !(await tilesReady(product, times[index], tileExists))) index++;
  const time = times[index];
  return {
    layer: product.layer,
    time,
    tile_url: tileUrl(product, time),
    fallback_urls: times.slice(index + 1, index + 1 + FALLBACKS).map((older) => tileUrl(product, older)),
  };
}

export const fetchLatestImerg = (now = new Date(), options) => fetchLatest(IMERG, now, options);
export const fetchLatestHimawari = (now = new Date(), options) => fetchLatest(HIMAWARI, now, options);
