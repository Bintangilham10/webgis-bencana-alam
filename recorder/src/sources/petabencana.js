import { contentHash } from '../lib/hash.js';
import { monthPath, safeName } from '../lib/paths.js';

// Default API hanya mengembalikan laporan 1 jam terakhir. Jendela 7 hari
// (604800 detik) memberi tumpang-tindih aman bila beberapa run terlewat.
export const REPORTS_URL = 'https://api.petabencana.id/reports?geoformat=geojson&timeperiod=604800';

export function extractReports(json) {
  const features = json?.result?.features;
  if (!Array.isArray(features)) throw new Error('format tidak dikenal: result.features tidak ada');
  return features;
}

export async function recordPetaBencana({ archive, http, now }) {
  const reports = extractReports(await http.fetchJson(REPORTS_URL));
  let saved = 0;

  for (const report of reports) {
    const { pkey, created_at: createdAt } = report.properties ?? {};
    if (!pkey) continue;
    const relPath = `petabencana/${monthPath(createdAt ?? now)}/${safeName(pkey)}__${contentHash(report)}.json`;
    const record = { source_url: REPORTS_URL, first_seen_at: now, report };
    if (await archive.writeOnce(relPath, `${JSON.stringify(record, null, 2)}\n`)) saved++;
  }

  return { items: reports.length, new: saved };
}
