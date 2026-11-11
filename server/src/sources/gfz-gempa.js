import { fetchText } from '../lib/http.js';
import { REGION } from './usgs-gempa.js';

// Katalog gempa GFZ (GEOFON, Potsdam, Jerman) lewat API FDSN. GFZ mengoperasikan
// jaringan seismograf GEOFON bersama BMKG, dengan 21 stasiun di Indonesia
// (web/public/data/stasiun-seismik.geojson), dan menghitung sendiri lokasi,
// magnitudo momen (Mw), serta mekanisme sumber gempa: jenis sesar dan arah
// bidang patahannya. Feed publik BMKG tidak memuat mekanisme sumber. Di kawasan
// Indonesia GFZ mencatat gempa mulai ±M4,3 (±25 per minggu), dengan mekanisme
// untuk gempa ±Mw 5 ke atas beberapa jam kemudian. Data GFZ berlisensi CC BY 4.0.
const QUERY_URL = 'https://geofon.gfz.de/fdsnws/event/1/query';
const DAY_MS = 24 * 60 * 60 * 1000;
// Rentang yang diminta: 3 hari untuk sinkronisasi rutin, karena mekanisme sumber
// dan tinjauan seismolog bisa menyusul lebih dari sehari setelah gempa; 8 hari
// untuk mengisi celah saat server lama mati (dipilih di jobs/sync-earthquakes.js).
export const FEED_DAYS = { day: 3, week: 8 };

export const eventUrl = (code) => `https://geofon.gfz.de/eqinfo/event.php?id=${encodeURIComponent(code)}`;

export function queryUrl({ feed = 'day', now = Date.now() } = {}) {
  const params = new URLSearchParams({
    minlatitude: String(REGION.south),
    maxlatitude: String(REGION.north),
    minlongitude: String(REGION.west),
    maxlongitude: String(REGION.east),
    starttime: new Date(now - FEED_DAYS[feed] * DAY_MS).toISOString().slice(0, 19),
    includefocalmechanism: 'true',
  });
  return `${QUERY_URL}?${params}`;
}

// ---------- Pembaca QuakeML ----------
// QuakeML GFZ teratur dan tanpa elemen bersarang senama, jadi cukup dibaca dengan
// pola (seperti CAP BMKG di bmkg-cap.js) tanpa menambah dependensi pengurai XML.

// Semua elemen `name`: [{ id, xml }]; id = atribut publicID bila ada.
function blocks(xml, name) {
  const pattern = new RegExp(String.raw`<${name}(?:\s+publicID="([^"]*)")?\s*>([\s\S]*?)</${name}>`, 'g');
  return [...xml.matchAll(pattern)].map((match) => ({ id: match[1] ?? null, xml: match[2] }));
}
const first = (xml, name) => blocks(xml, name)[0]?.xml ?? null;
const text = (xml, name) => first(xml ?? '', name)?.trim() || null;
const numberOrNull = (raw) => (raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : null);
// <strike><value>304.8</value></strike> → 304.8
const value = (xml, name) => numberOrNull(text(first(xml ?? '', name) ?? '', 'value'));
// <doubleCouple>0.49</doubleCouple> → 0.49
const plain = (xml, name) => numberOrNull(text(xml ?? '', name));
// Elemen pilihan menurut <preferred…ID>; bila tidak disebut, elemen pertama.
const preferred = (items, id) => items.find((item) => item.id === id) ?? items[0] ?? null;
const isoOrNull = (stamp) => {
  const date = new Date(stamp ?? '');
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// ---------- Mekanisme sumber ----------

// Jenis sesar dari kemiringan (plunge) sumbu T, P, dan N tensor momen menurut
// Frohlich (1992): T ≥ 50° sesar naik, P ≥ 60° sesar turun, N ≥ 60° sesar geser,
// selain itu oblik (campuran).
export const MECHANISM_TYPES = {
  naik: 'Sesar naik',
  turun: 'Sesar turun',
  geser: 'Sesar geser',
  oblik: 'Sesar oblik (campuran)',
};

export function mechanismType({ t, p, n }) {
  if (t >= 50) return 'naik';
  if (p >= 60) return 'turun';
  if (n >= 60) return 'geser';
  return 'oblik';
}

const plane = (xml) => {
  const values = ['strike', 'dip', 'rake'].map((name) => value(xml, name));
  if (values.includes(null)) return null;
  const [strike, dip, rake] = values.map(Math.round);
  return { strike, dip, rake };
};

// Mekanisme sumber dari satu elemen <focalMechanism>: dua bidang nodal (jurus,
// kemiringan, rake dalam derajat), kemiringan sumbu utama, dan jenis sesarnya.
// null bila bidang nodal atau sumbu utamanya tidak lengkap.
export function parseMechanism(xml) {
  const planes = first(xml, 'nodalPlanes');
  const axes = first(xml, 'principalAxes');
  if (!planes || !axes) return null;
  const nodal = [plane(first(planes, 'nodalPlane1')), plane(first(planes, 'nodalPlane2'))];
  const plunges = { t: value(first(axes, 'tAxis'), 'plunge'), p: value(first(axes, 'pAxis'), 'plunge'), n: value(first(axes, 'nAxis'), 'plunge') };
  if (nodal.includes(null) || Object.values(plunges).includes(null)) return null;
  const doubleCouple = plain(first(xml, 'momentTensor'), 'doubleCouple');
  const type = mechanismType(plunges);
  return {
    type,
    label: MECHANISM_TYPES[type],
    planes: nodal,
    plunges: { t: Math.round(plunges.t), p: Math.round(plunges.p), n: Math.round(plunges.n) },
    // Bagian tensor momen yang berupa geseran murni (0–1); makin kecil makin
    // jauh sumbernya dari patahan bidang sederhana.
    double_couple: doubleCouple === null ? null : Number(doubleCouple.toFixed(2)),
    // manual = sudah ditinjau seismolog GFZ.
    reviewed: text(xml, 'evaluationMode') === 'manual',
    updated_at: isoOrNull(text(first(xml, 'creationInfo') ?? '', 'creationTime')),
  };
}

// ---------- Gempa ----------

// Elemen <event> → gempa. Kedalaman QuakeML dalam meter. Gempa tanpa lokasi,
// waktu, atau magnitudo pilihan (jarang, biasanya baru dibuat) dilewati.
export function normalizeEvent({ id: publicId, xml }) {
  const code = publicId?.split('/').pop();
  const origin = preferred(blocks(xml, 'origin'), text(xml, 'preferredOriginID'));
  const magnitude = preferred(blocks(xml, 'magnitude'), text(xml, 'preferredMagnitudeID'));
  const mechanisms = blocks(xml, 'focalMechanism');
  if (!code || !origin || !magnitude) return null;

  const values = [value(origin.xml, 'latitude'), value(origin.xml, 'longitude'), value(origin.xml, 'depth'), value(magnitude.xml, 'mag')];
  const occurredAt = isoOrNull(text(first(origin.xml, 'time') ?? '', 'value'));
  if (values.includes(null) || !occurredAt) return null;
  const [lat, lon, depthM, mag] = values;

  // Waktu GFZ pertama kali menerbitkan gempa ini: creationInfo milik <event>,
  // bukan milik lokasi, magnitudo, atau mekanismenya.
  const nested = (name) => new RegExp(String.raw`<${name}[\s>][\s\S]*?</${name}>`, 'g');
  const own = ['focalMechanism', 'origin', 'magnitude'].reduce((rest, name) => rest.replaceAll(nested(name), ''), xml);
  const mechanism = mechanisms.length ? parseMechanism(preferred(mechanisms, text(xml, 'preferredFocalMechanismID')).xml) : null;
  const props = {
    wilayah: text(first(xml, 'description') ?? '', 'text'),
    mag_type: text(magnitude.xml, 'type'),
    url: eventUrl(code),
    // manual = lokasi sudah ditinjau seismolog GFZ; automatic = hasil otomatis.
    status: text(origin.xml, 'evaluationMode'),
    published_at: isoOrNull(text(first(own, 'creationInfo') ?? '', 'creationTime')),
    mechanism,
  };
  return {
    id: `gfz:${code}`,
    source: 'gfz',
    hazard: 'gempa',
    magnitude: Number(mag.toFixed(1)),
    depthKm: Number((depthM / 1000).toFixed(1)),
    occurredAt,
    lat,
    lon,
    props: Object.fromEntries(Object.entries(props).filter(([, item]) => item)),
  };
}

// API FDSN membalas HTTP 204 tanpa isi bila tidak ada gempa dalam rentang itu.
export function extractEvents(xml) {
  if (!xml.trim()) return [];
  if (!xml.includes('<eventParameters')) throw new Error('format QuakeML GFZ tidak dikenal: eventParameters tidak ada');
  return blocks(xml, 'event').map(normalizeEvent).filter(Boolean);
}

export async function fetchGfzEarthquakes({ feed = 'day', now = Date.now(), getText = fetchText } = {}) {
  return { events: extractEvents(await getText(queryUrl({ feed, now }), { timeoutMs: 30_000 })), errors: [] };
}
