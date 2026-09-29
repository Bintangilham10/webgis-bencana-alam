import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fetchBuffer, fetchText } from '../src/lib/http.js';

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

// Sama seperti loadRaw untuk berkas biner. validate(buffer) melempar galat bila
// isi unduhan bukan data yang diharapkan (mis. pesan galat ArcGIS berupa JSON),
// supaya galat itu tidak ikut tersimpan di cache.
export async function loadRawBuffer(name, url, { timeoutMs = 300_000, validate } = {}) {
  const file = new URL(name, RAW_DIR);
  try {
    return await readFile(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const buffer = await fetchBuffer(url, { timeoutMs });
  validate?.(buffer);
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, buffer);
  return buffer;
}

// Cache JSON yang diisi bertahap (mis. nilai sampel per titik): null bila belum ada.
export async function readRawJson(name) {
  try {
    return JSON.parse(await readFile(new URL(name, RAW_DIR), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeRawJson(name, data) {
  const file = new URL(name, RAW_DIR);
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}
