import { randomBytes } from 'node:crypto';
import { query } from './db.js';
import { allowedEndpoint, sendPush, validSubscriptionKeys } from './lib/web-push.js';

// Web Push: langganan browser, siapa yang dikirimi sebuah notifikasi, dan pengirimannya.
// Aturan "siapa yang dikirimi" sama dengan aturan kotak notifikasi di halaman
// (web/src/features/notifications.js, fungsi relevance): yang akan dimunculkan di
// halaman itulah yang dikirim sebagai push.

// Jarak yang dianggap "sekitar lokasi saya" per jenis; sama dengan NEAR_KM di web.
export const NEAR_KM = { gempa: 150, gunung_api: 100, cuaca: 30 };
// Wilayah pengguna dibulatkan sebelum disimpan: 0,1° ≈ 11 km.
const AREA_DECIMALS = 1;
// Kawasan yang dilayani aplikasi; wilayah di luarnya ditolak.
const BOUNDS = { latMin: -15, latMax: 10, lonMin: 90, lonMax: 145 };
// Langganan dihapus setelah gagal berturut-turut sebanyak ini (404/410 langsung dihapus).
const MAX_FAILURES = 10;
// Batas jumlah langganan yang disimpan.
export const MAX_SUBSCRIPTIONS = 2000;
// Lama layanan push menyimpan pesan bila perangkat tidak terjangkau: gempa 1 jam,
// level gunung api 12 jam, peringatan cuaca 2 jam (rata-rata masa berlakunya).
const TTL_SECONDS = { gempa: 3600, gunung_api: 12 * 3600, cuaca: 2 * 3600 };
const COLUMNS = 'id, endpoint, p256dh, auth, token, near_only, lat, lon, kode';

const distanceKm = (a, b) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const hasArea = (sub) => Number.isFinite(sub.lat) && Number.isFinite(sub.lon);

function near(n, sub) {
  if (!hasArea(sub) || !Number.isFinite(n.lat)) return false;
  if (n.kind === 'cuaca' && sub.kode && n.wilayah?.includes(sub.kode)) return true;
  return distanceKm(sub, n) <= NEAR_KM[n.kind];
}

// Apakah notifikasi ini dikirim ke langganan ini.
export function wantsPush(n, sub) {
  if (sub.near_only && hasArea(sub)) return near(n, sub);
  // Peringatan cuaca terbit puluhan kali sehari: hanya yang mengenai wilayah pengguna.
  if (n.kind === 'cuaca') return near(n, sub);
  return true;
}

// Isi permintaan dari browser → langganan yang siap disimpan, atau alasan penolakan.
export function validateSubscription(body) {
  const endpoint = body?.subscription?.endpoint;
  const keys = body?.subscription?.keys;
  if (typeof endpoint !== 'string' || endpoint.length > 2000 || !allowedEndpoint(endpoint)) {
    return { error: 'Alamat layanan push tidak dikenali. Browser ini belum didukung.' };
  }
  if (!validSubscriptionKeys(keys?.p256dh, keys?.auth)) return { error: 'Kunci langganan push tidak sah.' };
  const value = { endpoint, p256dh: keys.p256dh, auth: keys.auth, nearOnly: body.nearOnly === true, lat: null, lon: null, kode: null };
  if (body.area != null) {
    const { lat, lon, kode } = body.area;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !(lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lon >= BOUNDS.lonMin && lon <= BOUNDS.lonMax)) {
      return { error: 'Wilayah harus berupa koordinat di kawasan Indonesia.' };
    }
    if (kode != null && !(typeof kode === 'string' && /^\d{2}\.\d{2}$/.test(kode))) return { error: 'Kode wilayah tidak sah.' };
    const scale = 10 ** AREA_DECIMALS;
    Object.assign(value, { lat: Math.round(lat * scale) / scale, lon: Math.round(lon * scale) / scale, kode: kode ?? null });
  }
  return { value };
}

// Mendaftarkan atau memperbarui langganan; mengembalikan token untuk laporan terima,
// atau null bila jumlah langganan sudah mencapai batas (langganan yang sudah ada
// tetap bisa diperbarui). Pendaftaran tidak memerlukan akun, jadi tanpa batas ini
// pendaftaran palsu bisa membuat server mengirim pesan sebanyak-banyaknya tiap ada
// notifikasi.
export async function saveSubscription(sub, db = query, max = MAX_SUBSCRIPTIONS) {
  const { rows } = await db(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, token, near_only, lat, lon, kode)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8
     WHERE (SELECT count(*) FROM push_subscriptions) < $9 OR EXISTS (SELECT 1 FROM push_subscriptions WHERE endpoint = $1)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, near_only = EXCLUDED.near_only,
       lat = EXCLUDED.lat, lon = EXCLUDED.lon, kode = EXCLUDED.kode, updated_at = now(), failures = 0
     RETURNING token`,
    [sub.endpoint, sub.p256dh, sub.auth, randomBytes(16).toString('base64url'), sub.nearOnly, sub.lat, sub.lon, sub.kode, max],
  );
  return rows[0]?.token ?? null;
}

export async function removeSubscription(endpoint, db = query) {
  const { rowCount } = await db('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  return rowCount > 0;
}

export async function findSubscription(endpoint, db = query) {
  const { rows } = await db(`SELECT ${COLUMNS} FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  return rows[0] ?? null;
}

// Service worker melapor sudah menerima pesan: waktu terimanya dicatat sekali.
export async function ackDelivery(deliveryId, token, db = query) {
  const { rowCount } = await db(
    `UPDATE push_deliveries d SET received_at = clock_timestamp()
     FROM push_subscriptions s
     WHERE d.id = $1 AND d.subscription_id = s.id AND s.token = $2 AND d.received_at IS NULL`,
    [deliveryId, token],
  );
  return rowCount > 0;
}

// Menjalankan tugas dengan paling banyak `limit` berjalan bersamaan.
async function inBatches(items, limit, work) {
  const queue = [...items];
  const results = [];
  const worker = async () => {
    while (queue.length) results.push(await work(queue.shift()));
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return results;
}

// `send` dan `db` bisa diganti saat test.
export function createPushDispatcher({ vapid, send = sendPush, db = query, log = console.error, concurrency = 8 }) {
  // Satu pesan ke satu langganan: dicatat dulu, dikirim, lalu hasilnya dicatat.
  // null = sudah pernah dikirim (notifikasi yang sama ke langganan yang sama).
  async function deliver(sub, payload, { notificationId = null, ttl, urgency, topic } = {}) {
    const { rows } = await db(
      `INSERT INTO push_deliveries (notification_id, subscription_id, layanan) VALUES ($1, $2, $3)
       ON CONFLICT (notification_id, subscription_id) DO NOTHING RETURNING id`,
      [notificationId, sub.id, new URL(sub.endpoint).hostname],
    );
    if (!rows.length) return null;
    const deliveryId = Number(rows[0].id);
    const started = performance.now();
    let status = null;
    try {
      // d dan s dipakai service worker untuk melapor sudah menerima (/api/push/ack).
      status = await send(sub, JSON.stringify({ ...payload, d: deliveryId, s: sub.token }), vapid, { ttl, urgency, topic });
    } catch (err) {
      log(`Push ke ${new URL(sub.endpoint).hostname} gagal: ${err.cause?.code ?? err.message}`);
    }
    await db('UPDATE push_deliveries SET status = $2, accepted_ms = $3 WHERE id = $1', [deliveryId, status, Math.round(performance.now() - started)]);
    if (status === 404 || status === 410) {
      await db('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
    } else if (status >= 200 && status < 300) {
      await db('UPDATE push_subscriptions SET last_ok_at = now(), failures = 0 WHERE id = $1', [sub.id]);
    } else {
      await db('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1', [sub.id]);
      await db('DELETE FROM push_subscriptions WHERE id = $1 AND failures >= $2', [sub.id, MAX_FAILURES]);
    }
    return status;
  }

  return {
    // Notifikasi baru → semua langganan yang memintanya. Mengembalikan jumlah yang
    // dituju dan yang diterima layanan push.
    async dispatch(n) {
      const { rows } = await db(`SELECT ${COLUMNS} FROM push_subscriptions`);
      const targets = rows.filter((sub) => wantsPush(n, sub));
      const payload = { id: n.id, kind: n.kind, level: n.level, title: n.title, body: n.body, created_at: n.created_at };
      const options = { notificationId: n.id, ttl: TTL_SECONDS[n.kind] ?? 3600, urgency: n.level >= 2 ? 'high' : 'normal', topic: `sigap-${n.id}` };
      const statuses = await inBatches(targets, concurrency, (sub) => deliver(sub, payload, options));
      return { targets: targets.length, accepted: statuses.filter((s) => s >= 200 && s < 300).length };
    },

    // Pesan uji ke satu langganan, diminta pengguna dari panel notifikasi.
    test(sub, now = new Date()) {
      const payload = { id: null, kind: 'uji', level: 0, title: 'Notifikasi uji SIGAP', body: 'Push aktif di perangkat ini. Notifikasi sungguhan akan tampil seperti ini.', created_at: now.toISOString() };
      return deliver(sub, payload, { ttl: 60, urgency: 'high' });
    },
  };
}
