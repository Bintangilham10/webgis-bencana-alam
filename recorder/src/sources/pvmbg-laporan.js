import { contentHash } from '../lib/hash.js';
import { hoursSince, wibDate } from '../lib/time.js';

// Titik laporan pemeriksaan lapangan gerakan tanah PVMBG (Portal MBG), dikelompokkan
// per tahun pemeriksaan. Laporan baru menjadi data kejadian prospektif untuk riset.
export const REPORTS_URL = 'https://vsi.esdm.go.id/portalmbg/api/get-field-reports';

const CHECK_EVERY_HOURS = 7 * 24;

// { "2022": [...], "2023": [...] } → daftar datar; tiap titik punya id unik.
export function flattenReports(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('format laporan PVMBG tidak dikenal');
  return Object.entries(json).flatMap(([group, items]) => {
    if (!Array.isArray(items)) throw new Error(`format laporan PVMBG tidak dikenal: grup ${group}`);
    return items.map((item) => ({ ...item, group }));
  });
}

export function diffReports(previousHashes, reports) {
  const changes = [];
  const seen = new Set();
  for (const report of reports) {
    const id = String(report.id);
    seen.add(id);
    const hash = contentHash(report);
    if (!(id in previousHashes)) changes.push({ jenis: 'baru', id, report });
    else if (previousHashes[id] !== hash) changes.push({ jenis: 'berubah', id, report });
  }
  for (const id of Object.keys(previousHashes)) {
    if (!seen.has(id)) changes.push({ jenis: 'hilang', id });
  }
  return changes;
}

export async function recordPvmbgLaporan({ archive, http, now }) {
  const state = await archive.readJson('pvmbg-laporan/terkini.json');
  if (hoursSince(state?.checked_at, now) < CHECK_EVERY_HOURS) {
    return { items: state.count, new: 0, skipped: 'sudah diperiksa minggu ini' };
  }

  // Server menambahkan BOM di awal JSON.
  const raw = (await http.fetchText(REPORTS_URL, { timeoutMs: 60_000 })).replace(/^﻿/, '');
  const reports = flattenReports(JSON.parse(raw));
  const changes = state ? diffReports(state.hashes, reports) : [];

  // Snapshot utuh saat pertama kali dan setiap kali ada perubahan; di luar itu
  // cukup file status, supaya arsip tidak membengkak.
  if (!state || changes.length) {
    await archive.writeOnce(`pvmbg-laporan/snapshot/${wibDate(now)}.json`, raw.endsWith('\n') ? raw : `${raw}\n`);
  }
  for (const change of changes) {
    await archive.appendLine('pvmbg-laporan/perubahan.jsonl', { detected_at: now, ...change });
  }

  await archive.writeJson('pvmbg-laporan/terkini.json', {
    checked_at: now,
    count: reports.length,
    hashes: Object.fromEntries(reports.map((r) => [String(r.id), contentHash(r)])),
  });
  return { items: reports.length, new: state ? changes.filter((c) => c.jenis === 'baru').length : reports.length };
}
