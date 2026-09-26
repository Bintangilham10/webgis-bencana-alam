import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pool, withTransaction } from '../src/db.js';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

// File .sql dijalankan berurutan menurut nama dan dicatat di schema_migrations,
// jadi perintah ini aman dijalankan berulang kali.
export async function migrate() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
    try {
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      });
    } catch (err) {
      throw new Error(`Migrasi ${file} gagal: ${err.message}`, { cause: err });
    }
    console.log(`migrasi diterapkan: ${file}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
  await pool.end();
}
