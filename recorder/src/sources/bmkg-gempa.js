import { contentHash } from '../lib/hash.js';
import { compactTimestamp, monthPath } from '../lib/paths.js';

export const FEEDS = {
  autogempa: 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json',
  gempaterkini: 'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json',
  gempadirasakan: 'https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json',
};

// autogempa berisi satu objek, dua feed lainnya berisi array.
export function extractEvents(json) {
  const gempa = json?.Infogempa?.gempa;
  if (!gempa) throw new Error('format tidak dikenal: Infogempa.gempa tidak ada');
  return Array.isArray(gempa) ? gempa : [gempa];
}

// Nama file = waktu kejadian + hash isi. BMKG kadang merevisi parameter gempa;
// revisi tersimpan sebagai file baru, bukan menimpa yang lama.
export function eventFilePath(feed, event) {
  const occurredAt = new Date(event.DateTime).toISOString();
  return `bmkg-gempa/${feed}/${monthPath(occurredAt)}/${compactTimestamp(occurredAt)}__${contentHash(event)}.json`;
}

export async function recordBmkgGempa({ archive, http, now }) {
  let items = 0;
  let saved = 0;
  const errors = [];

  for (const [feed, url] of Object.entries(FEEDS)) {
    try {
      const events = extractEvents(await http.fetchJson(url));
      items += events.length;
      for (const event of events) {
        const record = { feed, source_url: url, first_seen_at: now, data: event };
        if (await archive.writeOnce(eventFilePath(feed, event), `${JSON.stringify(record, null, 2)}\n`)) saved++;
      }
    } catch (err) {
      errors.push(`${feed}: ${err.message}`);
    }
  }

  if (errors.length === Object.keys(FEEDS).length) throw new Error(errors.join('; '));
  return { items, new: saved, errors };
}
