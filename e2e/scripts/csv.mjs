// Pembaca CSV kecil (RFC 4180) untuk hasil unduhan Google Forms/Sheets: kolom bertanda
// kutip boleh berisi koma, baris baru, dan kutip ganda (""). Mengembalikan objek per baris.
import { readFile } from 'node:fs/promises';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  const [header = [], ...body] = rows;
  const names = header.map((h) => h.trim());
  return { columns: names, records: body.map((cells) => Object.fromEntries(names.map((name, i) => [name, (cells[i] ?? '').trim()]))) };
}

export async function readCsv(path) {
  return parseCsv(await readFile(path, 'utf8'));
}
