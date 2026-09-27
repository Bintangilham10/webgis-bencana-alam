import { contentHash } from '../lib/hash.js';
import { hoursSince, pad2 } from '../lib/time.js';

// Kejadian bencana mingguan BNPB (layanan ArcGIS). Per 27 Sep 2026 isinya hanya
// 6 kejadian akhir Juni 2026; direkam harian berjaga-jaga kalau diperbarui lagi.
export const QUERY_URL =
  'https://gis.bnpb.go.id/server/rest/services/Kejadian_Bencana_Mingguan/MapServer/25/query?where=1%3D1&outFields=*&returnGeometry=false&f=json';

const CHECK_EVERY_HOURS = 24;

export function extractEvents(json) {
  if (json?.error) throw new Error(`ArcGIS error ${json.error.code}: ${json.error.message ?? ''}`.trim());
  if (!Array.isArray(json?.features)) throw new Error('format BNPB tidak dikenal: features tidak ada');
  return json.features.map((f) => f.attributes);
}

export async function recordBnpbMingguan({ archive, http, now }) {
  const status = (await archive.readJson('bnpb-mingguan/status.json')) ?? {};
  if (hoursSince(status.checked_at, now) < CHECK_EVERY_HOURS) return { items: status.count ?? 0, new: 0, skipped: 'sudah diperiksa hari ini' };

  const events = extractEvents(await http.fetchJson(QUERY_URL, { timeoutMs: 60_000 }));
  let saved = 0;
  for (const event of events) {
    const date = new Date(event.dt ?? now);
    const relPath = `bnpb-mingguan/${date.getUTCFullYear()}/${pad2(date.getUTCMonth() + 1)}/${event.id ?? event.objectid}__${contentHash(event)}.json`;
    if (await archive.writeOnce(relPath, `${JSON.stringify({ source_url: QUERY_URL, first_seen_at: now, event }, null, 2)}\n`)) saved++;
  }
  await archive.writeJson('bnpb-mingguan/status.json', { checked_at: now, count: events.length });
  return { items: events.length, new: saved };
}
