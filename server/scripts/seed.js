import { pool } from '../src/db.js';
import { syncVolcanoes } from '../src/jobs/sync-volcanoes.js';
import { seedBahaya } from './seed-bahaya.js';
import { seedFaults } from './seed-faults.js';
import { seedLandslides } from './seed-landslides.js';
import { seedWilayah } from './seed-wilayah.js';

// Gunung api tidak punya seed terpisah: sinkronisasi MAGMA sekaligus
// mengisi koordinat dan status level.
const SEEDS = {
  wilayah: seedWilayah,
  volcanoes: async () => (await syncVolcanoes()).items,
  faults: seedFaults,
  landslides: seedLandslides,
  // Raster kelas bahaya InaRISK, statistik zona, dan titik pantau indikasi 3 hari.
  bahaya: seedBahaya,
};

// Pemakaian: npm run seed [-- wilayah faults ...]; tanpa argumen = semua.
const names = process.argv.slice(2);
try {
  for (const name of names.length ? names : Object.keys(SEEDS)) {
    const seed = SEEDS[name];
    if (!seed) throw new Error(`Seed tidak dikenal: ${name} (pilihan: ${Object.keys(SEEDS).join(', ')})`);
    const started = performance.now();
    const count = await seed();
    console.log(`seed ${name}: ${count} baris (${Math.round(performance.now() - started)} ms)`);
  }
} finally {
  await pool.end();
}
