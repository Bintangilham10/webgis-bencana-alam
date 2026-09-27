import { readFile } from 'node:fs/promises';
import { withTransaction } from '../src/db.js';

// Riwayat kejadian gerakan tanah dari inventaris riset (research/01_inventaris.py):
// laporan pemeriksaan lapangan PVMBG dan tanggapan MAGMA yang sudah dideduplikasi.
// File ini ikut dikomit, jadi seed tidak perlu Python atau akses internet.
const DATA_FILE = new URL('../data/landslides.geojson', import.meta.url);
const SOURCE = 'pvmbg';

const INSERT = `
  INSERT INTO events (id, source, hazard, occurred_at, props, geom)
  VALUES ($1, $2, 'longsor', $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`;

// Laporan tanpa jam kejadian dicatat pukul 00.00 WIB pada tanggalnya.
export const occurredAt = ({ tanggal, waktu_utc }) => waktu_utc ?? `${tanggal}T00:00:00+07:00`;

export async function seedLandslides(file = DATA_FILE) {
  const { features } = JSON.parse(await readFile(file, 'utf8'));
  await withTransaction(async (client) => {
    // Seed ulang mengganti seluruh riwayat, jadi kejadian yang dibuang
    // (mis. duplikat baru ketahuan) tidak tertinggal di database.
    await client.query(`DELETE FROM events WHERE hazard = 'longsor' AND source = $1`, [SOURCE]);
    for (const { geometry, properties: p } of features) {
      const [lon, lat] = geometry.coordinates;
      const { id, waktu_utc, ...props } = p;
      await client.query(INSERT, [id, SOURCE, occurredAt(p), { ...props, jam_diketahui: Boolean(waktu_utc) }, lon, lat]);
    }
  });
  return features.length;
}
