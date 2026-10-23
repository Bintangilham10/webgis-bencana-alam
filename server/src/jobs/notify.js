import { query } from '../db.js';
import { hasTsunamiPotential, VOLCANO_LEVELS } from '../lib/classify.js';
import { localClock, localDateTime, zoneName } from '../lib/time.js';
import { publishNotifications } from '../notifications.js';
import { lastSuccessfulSync } from '../sync-logs.js';

// Notifikasi dibuat setelah sinkronisasi, dari isi database (bukan dari jawaban
// sumber), jadi satu kejadian cukup diberitahukan sekali walau server mulai ulang.

const decimal = (value) => String(Math.round(value * 10) / 10).replace('.', ',');
const shorten = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

// "Pusat gempa berada di laut 121 km BaratDaya Lumajang" → "Laut 121 km barat daya
// Lumajang". Hanya arah tepat setelah "km" yang dirapikan; "Halmahera Utara" tetap.
const DIRECTION = /(\d+(?:[.,]\d+)?\s*km\s+)((?:Barat|Timur)\s*(?:Daya|Laut)|Tenggara|Utara|Selatan|Barat|Timur)\b/i;

export function quakePlace(wilayah) {
  const text = String(wilayah ?? '')
    .replace(/^pusat gempa berada di\s+/i, '')
    .replace(DIRECTION, (_, distance, direction) => distance + direction.replace(/(Daya|Laut)$/i, ' $1').replace(/\s+/g, ' ').toLowerCase())
    .trim();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Lokasi belum diketahui';
}

// Gempa BMKG (feed M ≥ 5 dan gempa dirasakan) yang baru terlihat. Gempa lama yang
// baru masuk karena server sempat mati tidak diberitahukan.
const NEW_QUAKES = `
  SELECT e.id, e.magnitude, e.depth_km, e.occurred_at, e.props, ST_Y(e.geom) AS lat, ST_X(e.geom) AS lon
  FROM events e
  WHERE e.source = 'bmkg' AND e.hazard = 'gempa'
    AND e.first_seen_at > now() - interval '30 minutes'
    AND e.occurred_at > now() - interval '3 hours'
    AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.kind = 'gempa' AND n.ref = e.id)
  ORDER BY e.occurred_at`;

export function quakeNotification(row) {
  const tsunami = hasTsunamiPotential(row.props.potensi);
  const level = tsunami || row.magnitude >= 7 ? 3 : row.magnitude >= 6 ? 2 : 1;
  const felt = row.props.dirasakan ? ` · dirasakan ${shorten(row.props.dirasakan.replace(/\s*-\s*/g, '–'), 90)}` : '';
  return {
    kind: 'gempa',
    ref: row.id,
    level,
    title: `Gempa M ${decimal(row.magnitude)}${tsunami ? ' berpotensi tsunami' : ''} · ${quakePlace(row.props.wilayah)}`,
    body: `${localDateTime(row.occurred_at)} · kedalaman ${Math.round(row.depth_km)} km${felt}`,
    lat: row.lat,
    lon: row.lon,
    sourceTime: row.occurred_at,
  };
}

export async function notifyQuakes() {
  const { rows } = await query(NEW_QUAKES);
  return publishNotifications(rows.map(quakeNotification));
}

// Perubahan level yang terdeteksi pada sinkronisasi ini saja. Satu sinkronisasi
// MAGMA adalah satu transaksi, jadi checked_at semua gunung api di run ini sama
// dengan level_changed_at yang berubah di run ini (keduanya now() basis data).
// Bila sinkronisasi sukses sebelumnya lebih dari 2 jam lalu (server sempat mati),
// waktu perubahannya tidak diketahui, jadi tidak diberitahukan, juga tidak pada
// sinkronisasi sesudahnya.
const MAX_SYNC_GAP_MS = 2 * 60 * 60_000;
const CHANGED_VOLCANOES = `
  SELECT kode, nama, level, level_sebelumnya, level_changed_at, ST_Y(geom) AS lat, ST_X(geom) AS lon
  FROM volcanoes WHERE level_changed_at = (SELECT max(checked_at) FROM volcanoes)`;

const levelText = (level) => `Level ${['I', 'II', 'III', 'IV'][level - 1]} (${VOLCANO_LEVELS[level]})`;

export function volcanoNotification(row) {
  const previous = row.level_sebelumnya;
  const direction = previous == null ? 'berubah ke' : row.level > previous ? 'naik ke' : 'turun ke';
  return {
    kind: 'gunung_api',
    ref: `${row.kode}:${new Date(row.level_changed_at).toISOString()}`,
    level: Math.max(0, row.level - 1),
    title: `Gunung ${row.nama} ${direction} ${levelText(row.level)}`,
    // level_changed_at = saat SIGAP melihat perubahannya di MAGMA, bukan waktu resmi penetapan PVMBG.
    body: `${previous == null ? '' : `Sebelumnya ${levelText(previous)} · `}terpantau di MAGMA ${localDateTime(row.level_changed_at)}. Ikuti rekomendasi radius aman PVMBG.`,
    lat: row.lat,
    lon: row.lon,
    sourceTime: row.level_changed_at,
  };
}

// Dipanggil sesudah syncVolcanoes dan sebelum run ini dicatat di sync_logs.
export async function notifyVolcanoes({ now = Date.now() } = {}) {
  const previous = await lastSuccessfulSync('magma');
  if (!previous || now - new Date(previous).getTime() > MAX_SYNC_GAP_MS) return [];
  const { rows } = await query(CHANGED_VOLCANOES);
  return publishNotifications(rows.map(volcanoNotification));
}

// Peringatan dini cuaca BMKG yang baru disimpan dan masih berlaku.
const NEW_CAP_ALERTS = `
  SELECT a.identifier, a.headline, a.event, a.severity, a.sent, a.effective, a.expires, a.utc_offset, a.area_desc,
         ST_Y(ST_PointOnSurface(a.geom)) AS lat, ST_X(ST_PointOnSurface(a.geom)) AS lon,
         coalesce(array_agg(w.kode ORDER BY w.nama) FILTER (WHERE w.kode IS NOT NULL), '{}') AS wilayah,
         coalesce(array_agg(w.nama ORDER BY w.nama) FILTER (WHERE w.kode IS NOT NULL), '{}') AS wilayah_nama
  FROM cap_alerts a
  LEFT JOIN cap_alert_wilayah aw USING (identifier)
  LEFT JOIN wilayah w ON w.kode = aw.kode
  WHERE a.identifier = ANY($1) AND a.expires > now() AND a.superseded_at IS NULL
  GROUP BY a.identifier`;

const SEVERITY_LEVEL = { Minor: 1, Moderate: 1, Severe: 2, Extreme: 3 };
const MAX_NAMED_REGIONS = 4;

export function capNotification(row) {
  const offset = row.utc_offset ?? 420;
  const names = row.wilayah_nama.slice(0, MAX_NAMED_REGIONS).join(', ');
  const more = row.wilayah_nama.length > MAX_NAMED_REGIONS ? ` (+${row.wilayah_nama.length - MAX_NAMED_REGIONS} kab/kota)` : '';
  const from = row.effective ?? row.sent;
  return {
    kind: 'cuaca',
    ref: row.identifier,
    level: SEVERITY_LEVEL[row.severity] ?? 1,
    title: row.headline ?? `${row.event} di ${row.area_desc ?? 'Indonesia'}`,
    body: `Berlaku ${localClock(from, offset)}–${localClock(row.expires, offset)} ${zoneName(offset)}${names ? ` · ${names}${more}` : ''}`,
    wilayah: row.wilayah,
    lat: row.lat,
    lon: row.lon,
    sourceTime: row.sent,
  };
}

export async function notifyCapAlerts(identifiers) {
  if (!identifiers.length) return [];
  const { rows } = await query(NEW_CAP_ALERTS, [identifiers]);
  return publishNotifications(rows.map(capNotification));
}
