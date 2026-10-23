import { fetchText } from '../lib/http.js';

// Peringatan dini cuaca (nowcast) BMKG dalam format CAP 1.2. Feed RSS hanya
// memuat peringatan yang sedang berlaku; guid tiap item = identifier CAP, dan
// tautannya menunjuk berkas XML dengan poligon kecamatan ("lat,lon" dipisah
// spasi). Arsip 26 Sep–23 Okt 2026: ±80 peringatan per hari, semuanya "Hujan
// Lebat dan Petir" berseverity Moderate, berlaku ±2 jam. Berkas yang sama sering
// diterbitkan ulang dengan identifier baru (±200 identifier per hari), jadi
// jobs/sync-cap.js memakai URL berkas sebagai kunci.
// Parser sendiri (bukan cheerio milik perekam) karena image server tidak memasang
// dependensi perekam; XML CAP BMKG sederhana dan tanpa elemen bersarang sejenis.
export const RSS_URL = 'https://www.bmkg.go.id/alerts/nowcast/id';
export const ATTRIBUTION = 'Peringatan dini cuaca: BMKG';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
      if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()];
      const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return String.fromCodePoint(code);
    });
}

// Isi semua elemen `name` (tanpa awalan namespace) di dalam xml, berurutan.
function elements(xml, name) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g');
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

const text = (xml, name) => {
  const [value] = elements(xml, name);
  return value === undefined ? null : decode(value).trim() || null;
};

const isoOrNull = (value) => {
  const date = new Date(value ?? '');
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export function parseRss(xml) {
  return elements(xml, 'item')
    .map((item) => ({
      identifier: text(item, 'guid'),
      url: text(item, 'link'),
      title: text(item, 'title'),
      published_at: isoOrNull(text(item, 'pubDate')),
    }))
    .filter((item) => item.identifier && item.url);
}

// "lat,lon lat,lon …" → cincin GeoJSON [[lon, lat], …] yang tertutup, atau null
// bila kurang dari tiga titik berbeda atau ada koordinat di luar kawasan.
export function parsePolygon(value) {
  const ring = value
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
    .map(([lat, lon]) => [lon, lat]);
  if (ring.some(([lon, lat]) => lat < -15 || lat > 10 || lon < 90 || lon > 145)) return null;
  const [first] = ring;
  if (!first) return null;
  const last = ring.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return new Set(ring.map(String)).size >= 3 ? ring : null;
}

// <references> CAP: "pengirim,identifier,waktu" dipisah spasi.
const parseReferences = (value) => (value ? value.split(/\s+/).map((ref) => ref.split(',')[1]).filter(Boolean) : []);

// Waktu CAP memakai zona waktu wilayahnya ("+08:00" = WITA); selisihnya disimpan
// supaya jam berlaku ditulis seperti di peringatan aslinya.
function utcOffsetMinutes(value) {
  const match = /([+-])(\d\d):?(\d\d)$/.exec(value ?? '');
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

export function parseCap(xml) {
  const identifier = text(xml, 'identifier');
  if (!identifier) throw new Error('XML CAP tanpa <identifier>');
  const [info = ''] = elements(xml, 'info');
  const areas = elements(info, 'area');
  const polygons = areas.flatMap((area) => elements(area, 'polygon').map((value) => parsePolygon(decode(value))).filter(Boolean));
  const sent = isoOrNull(text(xml, 'sent'));
  const expires = isoOrNull(text(info, 'expires'));
  if (!sent || !expires) throw new Error(`CAP ${identifier} tanpa waktu kirim atau kedaluwarsa`);
  return {
    identifier,
    msg_type: text(xml, 'msgType'),
    status: text(xml, 'status'),
    references: parseReferences(text(xml, 'references')),
    sent,
    event: text(info, 'event'),
    severity: text(info, 'severity') ?? 'Unknown',
    urgency: text(info, 'urgency'),
    certainty: text(info, 'certainty'),
    effective: isoOrNull(text(info, 'effective')),
    expires,
    utc_offset: utcOffsetMinutes(text(info, 'expires')),
    headline: text(info, 'headline'),
    description: text(info, 'description'),
    web: text(info, 'web'),
    area_desc: areas.map((area) => text(area, 'areaDesc')).filter(Boolean).join(', ') || null,
    polygons,
  };
}

export async function fetchCapFeed({ getText = fetchText } = {}) {
  return parseRss(await getText(RSS_URL, { timeoutMs: 20_000 }));
}

export async function fetchCapAlert(url, { getText = fetchText } = {}) {
  return parseCap(await getText(url, { timeoutMs: 20_000 }));
}
