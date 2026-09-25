import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Semua path relatif memakai "/" dan diterjemahkan ke separator OS di sini.
export function createArchive(rootDir) {
  const resolve = (relPath) => path.join(rootDir, ...relPath.split('/'));
  const ensureDir = (file) => mkdir(path.dirname(file), { recursive: true });

  return {
    rootDir,

    async exists(relPath) {
      try {
        await access(resolve(relPath));
        return true;
      } catch {
        return false;
      }
    },

    // Arsip bersifat append-only: file yang sudah ada tidak pernah ditimpa.
    // Mengembalikan false bila file sudah ada.
    async writeOnce(relPath, content) {
      const file = resolve(relPath);
      await ensureDir(file);
      try {
        await writeFile(file, content, { flag: 'wx' });
        return true;
      } catch (err) {
        if (err.code === 'EEXIST') return false;
        throw err;
      }
    },

    async appendLine(relPath, record) {
      const file = resolve(relPath);
      await ensureDir(file);
      await appendFile(file, `${JSON.stringify(record)}\n`);
    },

    async readText(relPath) {
      try {
        return await readFile(resolve(relPath), 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },

    async readJson(relPath) {
      const text = await this.readText(relPath);
      return text === null ? null : JSON.parse(text);
    },

    // Hanya untuk file status (mis. magma/terkini.json), bukan data arsip.
    async writeText(relPath, content) {
      const file = resolve(relPath);
      await ensureDir(file);
      await writeFile(file, content);
    },

    async writeJson(relPath, value) {
      await this.writeText(relPath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}
