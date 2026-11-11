import { datePath } from '../lib/paths.js';
import { indonesianReports } from '../lib/synop.js';

// Laporan sinoptik (SYNOP) stasiun cuaca BMKG, diambil dari gerbang
// telekomunikasi NOAA/NWS (Amerika Serikat) yang meneruskan data jaringan WMO.
// Alat ukurnya di Indonesia; data mentahnya tidak dibuka BMKG untuk umum.
//
// Direktori ini berisi 301 berkas bergulir: tiap 5 menit satu berkas ditimpa
// dengan buletin yang masuk pada selang itu, jadi isinya bertahan ±25 jam.
// Arsip publiknya di NOAA (ISD) berhenti memuat stasiun Indonesia sejak Agustus
// 2025, sehingga yang tidak direkam di sini hilang.
export const DIR_URL = 'https://tgftp.nws.noaa.gov/SL.us008001/DF.an/DC.sflnd/DS.synop/';
const STATUS_FILE = 'synop/status.json';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROW = /href="(sn\.\d{4}\.txt)"[^>]*>[^<]*<\/a>\s*<\/td>\s*<td[^>]*>\s*(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2})/g;

// Daftar berkas (halaman indeks Apache, waktu UTC) → [{ name, modified_at }],
// dari yang paling lama diubah.
export function parseListing(html) {
  const files = [];
  for (const [, name, day, month, year, hour, minute] of String(html).matchAll(ROW)) {
    const monthIndex = MONTHS.indexOf(month);
    if (monthIndex === -1) continue;
    files.push({ name, modified_at: new Date(Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute))).toISOString() });
  }
  return files.sort((a, b) => a.modified_at.localeCompare(b.modified_at) || a.name.localeCompare(b.name));
}

// Berkas yang perlu dibaca. Berkas terakhir yang sudah dibaca ikut dibaca lagi
// (batasnya inklusif): waktu di daftar hanya sampai menit, dan berkas itu masih
// bisa bertambah isinya.
export const filesSince = (listing, since) => (since ? listing.filter((file) => file.modified_at >= since) : listing);

// Ambil laporan Indonesia dari berkas yang diubah sejak `since`. Satu berkas
// yang gagal tidak menghentikan berkas lain; `latest` hanya maju sampai tepat
// sebelum berkas pertama yang gagal, supaya berkas itu dicoba lagi berikutnya.
export async function fetchReports({ fetchText, since = null, concurrency = 4 }) {
  const listing = parseListing(await fetchText(DIR_URL, { timeoutMs: 30_000 }));
  if (!listing.length) throw new Error('daftar berkas SYNOP NOAA kosong atau formatnya berubah');
  const files = filesSince(listing, since);
  const results = new Array(files.length);

  let next = 0;
  async function worker() {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      try {
        const text = await fetchText(`${DIR_URL}${file.name}`, { timeoutMs: 30_000 });
        results[index] = {
          reports: indonesianReports(text, file.modified_at).map((report) => ({ ...report, file: file.name, file_modified_at: file.modified_at })),
        };
      } catch (err) {
        results[index] = { error: `${file.name}: ${err.message}` };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  const firstFailed = results.findIndex((result) => result.error);
  const lastRead = firstFailed === -1 ? files.at(-1) : files[firstFailed - 1];
  return {
    files: files.length,
    latest: lastRead?.modified_at ?? since,
    reports: results.flatMap((result) => result.reports ?? []),
    errors: results.filter((result) => result.error).map((result) => result.error),
  };
}

const lineKey = (line) => `${line.wmo}|${line.observed_at}|${line.raw}`;

// Arsip: synop/YYYY/MM/DD.jsonl menurut tanggal pengamatan (UTC), satu baris per
// laporan. Laporan yang sama persis tidak ditulis dua kali; laporan koreksi
// (isi berbeda untuk stasiun dan jam yang sama) ditambahkan sebagai baris baru.
export async function recordSynop({ archive, http, now }) {
  const status = (await archive.readJson(STATUS_FILE)) ?? {};
  const { files, latest, reports, errors } = await fetchReports({ fetchText: http.fetchText, since: status.last_file_at ?? null });

  const byDay = new Map();
  for (const report of reports) {
    const relPath = `synop/${datePath(report.observed_at)}.jsonl`;
    if (!byDay.has(relPath)) byDay.set(relPath, []);
    byDay.get(relPath).push(report);
  }

  let saved = 0;
  for (const [relPath, lines] of byDay) {
    const existing = (await archive.readText(relPath)) ?? '';
    const seen = new Set(existing.split('\n').filter(Boolean).map((line) => lineKey(JSON.parse(line))));
    for (const line of lines) {
      if (seen.has(lineKey(line))) continue;
      seen.add(lineKey(line));
      await archive.appendLine(relPath, { ...line, first_seen_at: now });
      saved++;
    }
  }

  await archive.writeJson(STATUS_FILE, { last_file_at: latest, checked_at: now });
  return { items: reports.length, new: saved, files, errors };
}
