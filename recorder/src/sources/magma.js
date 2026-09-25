import * as cheerio from 'cheerio';
import { contentHash } from '../lib/hash.js';
import { compactTimestamp, datePath } from '../lib/paths.js';

// MAGMA tidak menyediakan API; status level diambil dari tabel di halaman ini.
export const PAGE_URL = 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas';

const LEVELS = { I: 1, II: 2, III: 3, IV: 4 };

// Struktur tabel: baris judul level (sel level + sel "Jumlah"), lalu satu baris
// per gunung api berisi "Nama - Wilayah" dan tautan laporan.
export function parseLevels(html) {
  const $ = cheerio.load(html);
  const volcanoes = [];
  const expectedCounts = new Map();
  let level = null;

  $('table tbody tr').each((_, tr) => {
    const $tr = $(tr);
    const heading = $tr.find('a.tx-inverse').first().text().match(/Level\s+(IV|III|II|I)\b/);
    if (heading) {
      level = LEVELS[heading[1]];
      expectedCounts.set(level, Number.parseInt($tr.find('td.tx-12').first().text(), 10));
    }

    $tr.find('td').each((_, td) => {
      const $td = $(td);
      // Sel gunung api dikenali dari tautan laporannya; sel "Tidak ada gunung api
      // Level IV" tidak punya tautan sehingga terlewati.
      if ($td.find('a[href*="/gunung-api/laporan/"]').length === 0) return;
      if (level === null) throw new Error('Gunung api ditemukan sebelum judul level');
      const label = $td.clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
      const [name, ...region] = label.split(' - ');
      volcanoes.push({ name: name.trim(), region: region.join(' - ').trim(), level });
    });
  });

  // Kalau jumlah terbaca tidak sama dengan kolom "Jumlah", struktur halaman
  // kemungkinan berubah; lebih baik gagal daripada mengarsipkan data yang salah.
  if (expectedCounts.size !== 4) throw new Error('Tabel tingkat aktivitas MAGMA tidak lengkap');
  for (const [lvl, expected] of expectedCounts) {
    const parsed = volcanoes.filter((v) => v.level === lvl).length;
    if (parsed !== expected) throw new Error(`Level ${lvl}: terbaca ${parsed} gunung api, halaman menyebut ${expected}`);
  }

  return volcanoes.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

export function diffLevels(previous, current) {
  const before = new Map(previous.map((v) => [v.name, v]));
  const after = new Map(current.map((v) => [v.name, v]));
  const changes = [];

  for (const v of current) {
    const old = before.get(v.name);
    if (old?.level !== v.level) changes.push({ name: v.name, region: v.region, from: old?.level ?? null, to: v.level });
  }
  for (const v of previous) {
    if (!after.has(v.name)) changes.push({ name: v.name, region: v.region, from: v.level, to: null });
  }
  return changes;
}

export async function recordMagma({ archive, http, now }) {
  const volcanoes = parseLevels(await http.fetchText(PAGE_URL));
  const hash = contentHash(volcanoes);
  const previous = await archive.readJson('magma/terkini.json');
  if (previous?.hash === hash) return { items: volcanoes.length, new: 0, changes: 0 };

  await archive.writeOnce(
    `magma/snapshot/${datePath(now)}/${compactTimestamp(now)}.json`,
    `${JSON.stringify({ captured_at: now, source_url: PAGE_URL, volcanoes }, null, 2)}\n`,
  );

  // Snapshot pertama hanya menjadi titik awal, belum dianggap perubahan.
  const changes = previous ? diffLevels(previous.volcanoes, volcanoes) : [];
  for (const change of changes) {
    await archive.appendLine('magma/perubahan.jsonl', { detected_at: now, ...change });
  }

  await archive.writeJson('magma/terkini.json', { updated_at: now, hash, volcanoes });
  return { items: volcanoes.length, new: 1, changes: changes.length };
}
