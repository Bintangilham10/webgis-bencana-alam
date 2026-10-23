import { query, withTransaction } from '../db.js';
import { fetchCapAlert, fetchCapFeed } from '../sources/bmkg-cap.js';
import { notifyCapAlerts } from './notify.js';

// Peringatan yang sudah lewat masa berlakunya dihapus setelah 30 hari; XML aslinya
// tetap ada di arsip perekam (cabang arsip-data).
const KEEP_DAYS = 30;

// Poligon tiap kecamatan diperbaiki (ST_MakeValid) lalu digabung. Kab/kota yang
// terkena = kab/kota yang memuat titik di dalam poligon tiap kecamatan, supaya
// kecamatan yang hanya bersinggungan dengan batas kab/kota lain tidak ikut.
const INSERT_ALERT = `
  WITH parts AS (
    SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(p), 4326)) AS g
    FROM jsonb_array_elements($16::jsonb) AS p
  ),
  merged AS (
    SELECT ST_Multi(ST_CollectionExtract(ST_Union(g), 3)) AS g FROM parts
  ),
  inserted AS (
    INSERT INTO cap_alerts (identifier, event, severity, urgency, certainty, headline, description, area_desc,
                            web, url, sent, effective, expires, utc_offset, superseded_at, geom)
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, merged.g
    FROM merged WHERE NOT ST_IsEmpty(merged.g)
    ON CONFLICT DO NOTHING
    RETURNING identifier
  )
  INSERT INTO cap_alert_wilayah (identifier, kode)
  SELECT DISTINCT inserted.identifier, w.kode
  FROM inserted CROSS JOIN parts
  JOIN wilayah w ON w.tingkat <> 'provinsi' AND ST_Intersects(w.geom, ST_PointOnSurface(parts.g))
  ON CONFLICT DO NOTHING`;

// CAP Update/Cancel menggantikan peringatan yang dirujuknya.
const SUPERSEDE = `UPDATE cap_alerts SET superseded_at = $2 WHERE identifier = ANY($1) AND superseded_at IS NULL`;

async function saveAlert(client, cap, url) {
  const polygons = cap.polygons.map((ring) => ({ type: 'Polygon', coordinates: [ring] }));
  if (!polygons.length) throw new Error(`CAP ${cap.identifier} tanpa poligon`);
  // Cancel tetap disimpan (masa berlakunya diakhiri) supaya tidak diunduh ulang.
  const cancelled = cap.msg_type === 'Cancel' ? cap.sent : null;
  await client.query(INSERT_ALERT, [
    cap.identifier, cap.event ?? 'Peringatan cuaca', cap.severity, cap.urgency, cap.certainty, cap.headline, cap.description,
    cap.area_desc, cap.web, url, cap.sent, cap.effective, cap.expires, cap.utc_offset, cancelled, JSON.stringify(polygons),
  ]);
  if (cap.references.length && cap.msg_type !== 'Alert') await client.query(SUPERSEDE, [cap.references, cap.sent]);
}

// fetchFeed dan fetchAlert dapat diganti saat test supaya tidak memanggil BMKG.
export async function syncCapAlerts({ fetchFeed = fetchCapFeed, fetchAlert = fetchCapAlert } = {}) {
  const items = await fetchFeed();
  // Berkas yang sama diterbitkan ulang BMKG dengan identifier baru: yang URL-nya
  // sudah tersimpan tidak diunduh, disimpan, dan diberitahukan lagi.
  const { rows } = await query('SELECT identifier, url FROM cap_alerts WHERE identifier = ANY($1) OR url = ANY($2)', [
    items.map((i) => i.identifier),
    items.map((i) => i.url),
  ]);
  const known = new Set(rows.flatMap((r) => [r.identifier, r.url]));

  const saved = [];
  const errors = [];
  for (const item of items.filter((i) => !known.has(i.identifier) && !known.has(i.url))) {
    try {
      const cap = await fetchAlert(item.url);
      await withTransaction((client) => saveAlert(client, cap, item.url));
      saved.push(cap.identifier);
    } catch (err) {
      errors.push(`${item.identifier}: ${err.message}`);
    }
  }
  await query(`DELETE FROM cap_alerts WHERE expires < now() - make_interval(days => $1)`, [KEEP_DAYS]);

  // Notifikasi gagal tidak menggagalkan sinkronisasi; dicoba lagi tidak perlu,
  // karena peringatan ini hanya berlaku ±2 jam.
  try {
    await notifyCapAlerts(saved);
  } catch (err) {
    errors.push(`notifikasi: ${err.message}`);
  }
  return { items: items.length, message: errors.length ? errors.join('; ') : null, saved };
}
