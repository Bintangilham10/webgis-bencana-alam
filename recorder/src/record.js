import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { http as liveHttp } from './lib/http.js';
import { datePath } from './lib/paths.js';
import { createArchive } from './lib/store.js';
import { createGazetteer, loadWilayah } from './lib/wilayah.js';
import { recordBeritaLongsor } from './sources/berita-longsor.js';
import { recordBmkgCap } from './sources/bmkg-cap.js';
import { recordBmkgCews } from './sources/bmkg-cews.js';
import { recordBmkgGempa } from './sources/bmkg-gempa.js';
import { recordBnpbMingguan } from './sources/bnpb-mingguan.js';
import { recordMagma } from './sources/magma.js';
import { recordOpenMeteoEns } from './sources/open-meteo-ens.js';
import { recordPetaBencana } from './sources/petabencana.js';
import { recordPvmbgLaporan } from './sources/pvmbg-laporan.js';
import { recordPvmbgPrakiraan } from './sources/pvmbg-prakiraan.js';

export const SOURCES = {
  'bmkg-cap': recordBmkgCap,
  'bmkg-gempa': recordBmkgGempa,
  magma: recordMagma,
  petabencana: recordPetaBencana,
  'bmkg-cews': recordBmkgCews,
  'pvmbg-prakiraan': recordPvmbgPrakiraan,
  'pvmbg-laporan': recordPvmbgLaporan,
  'open-meteo-ens': recordOpenMeteoEns,
  'bnpb-mingguan': recordBnpbMingguan,
  'berita-longsor': recordBeritaLongsor,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Titik kab/kota dan gazeter nama wilayah untuk sumber yang membutuhkannya.
export function defaultData() {
  const file = new URL('../data/wilayah.json', import.meta.url);
  const wilayah = existsSync(file) ? loadWilayah(file) : [];
  return { wilayah, gazetteer: wilayah.length ? createGazetteer(wilayah) : null };
}

// Satu sumber yang gagal tidak menghentikan sumber lain. Hasil tiap run,
// termasuk kegagalan, dicatat di _runs/ sebagai data ketersediaan sumber (RQ2).
export async function runOnce({
  archive,
  http = liveHttp,
  now = new Date().toISOString(),
  sources = SOURCES,
  data = defaultData(),
  pause = sleep,
}) {
  const results = {};
  for (const [name, record] of Object.entries(sources)) {
    const started = performance.now();
    try {
      results[name] = { ok: true, ...(await record({ archive, http, now, data, pause })) };
    } catch (err) {
      results[name] = { ok: false, error: err.message };
    }
    results[name].ms = Math.round(performance.now() - started);
  }
  await archive.appendLine(`_runs/${datePath(now)}.jsonl`, { run_at: now, results });
  return results;
}

async function main() {
  const archive = createArchive(path.resolve(process.env.ARSIP_DIR ?? 'arsip'));

  // README arsip ikut diperbarui agar dokumentasi data selalu menempel pada datanya.
  const readme = await readFile(new URL('../ARSIP_README.md', import.meta.url), 'utf8');
  if ((await archive.readText('README.md')) !== readme) await archive.writeText('README.md', readme);

  const results = await runOnce({ archive });
  for (const [name, r] of Object.entries(results)) {
    let detail;
    if (!r.ok) detail = `GAGAL: ${r.error}`;
    else if (r.skipped) detail = `lewat (${r.skipped})`;
    else detail = `items=${r.items} baru=${r.new}${r.errors?.length ? ` error=${r.errors.length}` : ''}`;
    console.log(`${name.padEnd(16)} ${detail} (${r.ms} ms)`);
    for (const e of r.errors ?? []) console.log(`  - ${e}`);
  }
  console.log(`Arsip: ${archive.rootDir}`);

  if (Object.values(results).every((r) => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
