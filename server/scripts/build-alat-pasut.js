import { mkdir, writeFile } from 'node:fs/promises';
import { fetchJson } from '../src/lib/http.js';
import { indonesianStations, stationListUrl } from '../src/sources/ioc-sealevel.js';

// Daftar alat pasang surut Indonesia di IOC Sea Level Station Monitoring
// Facility, ditulis sebagai file statis server/data/alat-pasang-surut.json.
// Daftar stasiun IOC mencakup seluruh dunia (±1,9 MB, 4–5 detik), jadi tidak
// diambil saat aplikasi berjalan; yang diambil hanya data tiap alat di daftar ini.
// Yang dimuat: alat yang pengukur muka lautnya mengirim data 30 hari terakhir.
// Jalankan ulang bila ada alat baru atau alat lama aktif lagi: npm run build:pasut
const OUTPUT = new URL('../data/alat-pasang-surut.json', import.meta.url);
const WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

// Satu baris per alat supaya diff git mudah dibaca.
const jsonLines = (rows) => `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;

const list = await fetchJson(stationListUrl(), { timeoutMs: 90_000 });
const stations = indonesianStations(list, Date.now(), { withinMs: WITHIN_MS }).map(({ code, nama, lat, lon }) => ({ code, nama, lat, lon }));
await mkdir(new URL('.', OUTPUT), { recursive: true });
await writeFile(OUTPUT, jsonLines(stations));
console.log(`${stations.length} alat pasang surut → server/data/alat-pasang-surut.json`);
for (const station of stations) console.log(`  ${station.code.padEnd(6)} ${station.nama}`);
