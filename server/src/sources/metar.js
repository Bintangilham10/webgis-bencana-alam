import { fetchText } from '../lib/http.js';
import { REGION } from './usgs-gempa.js';

// Laporan cuaca bandara (METAR) dari Aviation Weather Center NOAA (Amerika
// Serikat). Pengamatnya di bandara Indonesia, tiap 30 menit: cuaca saat ini
// (hujan, badai petir, kabut), suhu, dan angin. Dipakai melengkapi stasiun
// sinoptik yang berada di bandara yang sama; jumlah hujannya tidak dilaporkan.
const METAR_URL = 'https://aviationweather.gov/api/data/metar';
export const ATTRIBUTION = 'Cuaca bandara (METAR): NOAA Aviation Weather Center';

export const metarUrl = () =>
  `${METAR_URL}?${new URLSearchParams({ bbox: `${REGION.south},${REGION.west},${REGION.north},${REGION.east}`, format: 'json' })}`;

// Fenomena cuaca dalam sandi METAR, dari yang paling penting. `intensity`: awalan
// "-" (ringan) atau "+" (lebat) ikut ditulis.
const PHENOMENA = [
  { pattern: /TS.*(RA|DZ)/, label: 'Hujan petir', intensity: true },
  { pattern: /TS/, label: 'Badai petir' },
  { pattern: /SH.*RA/, label: 'Hujan lokal', intensity: true },
  { pattern: /RA/, label: 'Hujan', intensity: true },
  { pattern: /DZ/, label: 'Gerimis' },
  { pattern: /FG/, label: 'Kabut' },
  { pattern: /FU/, label: 'Asap' },
  { pattern: /BR/, label: 'Kabut tipis' },
  { pattern: /HZ/, label: 'Udara kabur' },
];

const intensityText = (token) => {
  if (token.startsWith('+')) return ' lebat';
  return token.startsWith('-') ? ' ringan' : '';
};

// Satu kelompok cuaca, mis. "-TSRA" atau "VCTS" → { rank, label }; rank kecil = lebih penting.
function describeToken(token) {
  const rank = PHENOMENA.findIndex((phenomenon) => phenomenon.pattern.test(token));
  if (rank === -1) return null;
  const { label, intensity } = PHENOMENA[rank];
  // VC = terlihat di sekitar bandara, bukan di bandaranya.
  if (token.startsWith('VC')) return { rank: rank + 0.5, label: `${label} di sekitar bandara` };
  return { rank, label: label + (intensity ? intensityText(token) : '') };
}

// "-TSRA BR" → "Hujan petir ringan": fenomena terpenting dari semua kelompok.
// Tanpa fenomena yang dikenal hasilnya null.
export function wxLabel(wxString) {
  const described = String(wxString ?? '').split(/\s+/).map(describeToken).filter(Boolean);
  return described.sort((a, b) => a.rank - b.rank)[0]?.label ?? null;
}

const finite = (value) => (Number.isFinite(value) ? value : null);

export function normalizeMetar(item) {
  const time = Number.isFinite(item?.obsTime) ? new Date(item.obsTime * 1000) : new Date(item?.reportTime ?? Number.NaN);
  if (!item?.icaoId || Number.isNaN(time.getTime())) return null;
  return {
    icao: item.icaoId,
    observed_at: time.toISOString(),
    weather: wxLabel(item.wxString),
    wx: item.wxString ?? null,
    temp_c: finite(item.temp),
    wind_kt: finite(item.wspd),
    gust_kt: finite(item.wgst),
    raw: item.rawOb ?? null,
  };
}

// Laporan terbaru tiap bandara di kawasan Indonesia: Map(kode ICAO → laporan).
// API membalas HTTP 204 tanpa isi bila tidak ada laporan.
export async function fetchMetar({ getText = fetchText } = {}) {
  const text = await getText(metarUrl(), { timeoutMs: 20_000 });
  const items = text.trim() ? JSON.parse(text) : [];
  if (!Array.isArray(items)) throw new Error('format METAR tidak dikenal: bukan daftar');
  const byIcao = new Map();
  for (const metar of items.map(normalizeMetar).filter(Boolean)) {
    const seen = byIcao.get(metar.icao);
    if (!seen || metar.observed_at > seen.observed_at) byIcao.set(metar.icao, metar);
  }
  return byIcao;
}
