import { EventEmitter } from 'node:events';
import { query } from './db.js';

// Notifikasi baru disiarkan ke semua koneksi SSE (routes/notifications.js) lewat bus ini.
// Penjadwal dan server berjalan di proses yang sama, jadi tidak perlu antrean luar.
export const notificationBus = new EventEmitter();
notificationBus.setMaxListeners(0);

const COLUMNS = 'id, kind, ref, level, title, body, wilayah, lat, lon, source_time, created_at';

const INSERT = `
  INSERT INTO notifications (kind, ref, level, title, body, wilayah, lat, lon, source_time)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (kind, ref) DO NOTHING
  RETURNING ${COLUMNS}`;

// id bigint dibaca pg sebagai teks; dikirim sebagai angka (aman sampai 2^53).
export const toPayload = (row) => ({ ...row, id: Number(row.id) });

// Menyimpan lalu menyiarkan; kejadian yang sudah pernah diberitahukan (kind, ref
// sama) dilewati. Mengembalikan notifikasi yang benar-benar baru.
export async function publishNotifications(items) {
  const published = [];
  for (const n of items) {
    const { rows } = await query(INSERT, [
      n.kind, n.ref, n.level, n.title, n.body, n.wilayah ?? [], n.lat ?? null, n.lon ?? null, n.sourceTime ?? null,
    ]);
    for (const row of rows) {
      const payload = toPayload(row);
      published.push(payload);
      notificationBus.emit('notification', payload);
    }
  }
  return published;
}

// Notifikasi sejak id tertentu (sambungan ulang SSE dengan Last-Event-ID) atau
// yang terbaru; dibatasi 24 jam terakhir.
export async function recentNotifications({ afterId = null, limit = 50, hours = 24 } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM notifications
     WHERE created_at > now() - make_interval(hours => $1) AND ($2::bigint IS NULL OR id > $2)
     ORDER BY id ${afterId === null ? 'DESC' : 'ASC'} LIMIT $3`,
    [hours, afterId, limit],
  );
  return rows.map(toPayload);
}
