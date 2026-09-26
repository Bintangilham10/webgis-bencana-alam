import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fetchText } from '../src/lib/http.js';

const RAW_DIR = new URL('../data/raw/', import.meta.url);

// Data sumber diunduh sekali lalu disimpan di data/raw/, supaya seed ulang
// cepat, tidak membebani server sumber, dan tetap bisa jalan tanpa internet.
export async function loadRaw(name, url, { timeoutMs = 120_000 } = {}) {
  const file = new URL(name, RAW_DIR);
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const text = await fetchText(url, { timeoutMs });
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, text);
  return text;
}
