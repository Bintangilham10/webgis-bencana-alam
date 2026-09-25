import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { http as liveHttp } from './lib/http.js';
import { datePath } from './lib/paths.js';
import { createArchive } from './lib/store.js';
import { recordBmkgCap } from './sources/bmkg-cap.js';
import { recordBmkgGempa } from './sources/bmkg-gempa.js';
import { recordMagma } from './sources/magma.js';
import { recordPetaBencana } from './sources/petabencana.js';

export const SOURCES = {
  'bmkg-cap': recordBmkgCap,
  'bmkg-gempa': recordBmkgGempa,
  magma: recordMagma,
  petabencana: recordPetaBencana,
};

// Satu sumber yang gagal tidak menghentikan sumber lain. Hasil tiap run,
// termasuk kegagalan, dicatat di _runs/ sebagai data ketersediaan sumber (RQ2).
export async function runOnce({ archive, http = liveHttp, now = new Date().toISOString(), sources = SOURCES }) {
  const results = {};
  for (const [name, record] of Object.entries(sources)) {
    const started = performance.now();
    try {
      results[name] = { ok: true, ...(await record({ archive, http, now })) };
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
    const detail = r.ok
      ? `items=${r.items} baru=${r.new}${r.errors?.length ? ` error=${r.errors.length}` : ''}`
      : `GAGAL: ${r.error}`;
    console.log(`${name.padEnd(12)} ${detail} (${r.ms} ms)`);
    for (const e of r.errors ?? []) console.log(`  - ${e}`);
  }
  console.log(`Arsip: ${archive.rootDir}`);

  if (Object.values(results).every((r) => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
