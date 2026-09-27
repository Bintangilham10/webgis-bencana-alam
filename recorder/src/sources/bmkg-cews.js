import { contentHash } from '../lib/hash.js';
import { compareDasarian, dasarianOf, hoursSince, nextDasarian, pad2, wibDate } from '../lib/time.js';

// Peringatan Dini Curah Hujan Tinggi BMKG (Climate Early Warning System), per
// dasarian dan per kab/kota. Halaman CEWS memuat daftar wilayah lewat endpoint ini.
export const AREA_URL = 'https://cews.bmkg.go.id/areacoverage.php?req=getareacoverage';
export const LAYER = 'pcht_das';
// Urutan legenda CEWS (dicek dari peta, 27 Sep 2026).
export const LEVELS = ['aman', 'waspada', 'siaga', 'awas'];
// Arsip CEWS di server BMKG dimulai Januari 2022.
export const BACKFILL_FROM = { year: 2022, month: 1, num: 1 };

const CHECK_EVERY_HOURS = 6;
const BACKFILL_PER_RUN = 6;
const PAUSE_MS = 1_000;

export const dasarianLabel = ({ year, month, num }) => `${year}-${pad2(month)} dasarian ${num}`;

export async function fetchDasarian(http, { year, month, num }, pause) {
  const levels = {};
  for (const [index, level] of LEVELS.entries()) {
    const text = await http.postForm(AREA_URL, {
      layername: LAYER,
      legendindex: String(index),
      date1: `${year}-${pad2(month)}-01`,
      date2: '',
      num1: String(num),
    });
    levels[level] = parseAreaCoverage(JSON.parse(text));
    await pause(PAUSE_MS);
  }
  return levels;
}

// [{ prov, kabkot: [...] }] → [{ provinsi, kab_kota }]
export function parseAreaCoverage(json) {
  if (!Array.isArray(json)) throw new Error('format CEWS tidak dikenal: bukan array');
  return json.flatMap((p) => {
    if (typeof p.prov !== 'string' || !Array.isArray(p.kabkot)) throw new Error('format CEWS tidak dikenal: prov/kabkot');
    return p.kabkot.map((kab) => ({ provinsi: p.prov, kab_kota: kab }));
  });
}

// Nama kab/kota CEWS dicocokkan ke kode Kepmendagri supaya bisa digabung dengan
// data lain; yang tidak cocok (mis. "KOTA TUBUH AIR") tetap disimpan dengan kode null.
export function withCodes(levels, gazetteer) {
  return Object.fromEntries(
    Object.entries(levels).map(([level, entries]) => [
      level,
      entries.map((e) => ({ ...e, kode: gazetteer?.match(e.kab_kota, e.provinsi)?.kode ?? null })),
    ]),
  );
}

async function saveDasarian({ archive, gazetteer, now }, dasarian, levels) {
  if (Object.values(levels).every((entries) => entries.length === 0)) return null;
  const coded = withCodes(levels, gazetteer);
  const counts = Object.fromEntries(Object.entries(coded).map(([level, entries]) => [level, entries.length]));
  const body = { dasarian, levels: coded };
  const hash = contentHash(body);
  const relPath = `bmkg-cews/${dasarian.year}/${pad2(dasarian.month)}/dasarian-${dasarian.num}__${hash}.json`;
  const record = { source_url: AREA_URL, layer: LAYER, first_seen_at: now, counts, ...body };
  return (await archive.writeOnce(relPath, `${JSON.stringify(record, null, 2)}\n`)) ? relPath : false;
}

export async function recordBmkgCews({ archive, http, now, data = {}, pause = async () => {} }) {
  const status = (await archive.readJson('bmkg-cews/status.json')) ?? {};
  const gazetteer = data.gazetteer;
  const context = { archive, gazetteer, now };
  const current = dasarianOf(wibDate(now));
  let items = 0;
  let saved = 0;
  const errors = [];

  // Dasarian berjalan dan berikutnya (peringatan terbit sebelum dasarian dimulai).
  if (hoursSince(status.checked_at, now) >= CHECK_EVERY_HOURS) {
    for (const dasarian of [current, nextDasarian(current)]) {
      try {
        const result = await saveDasarian(context, dasarian, await fetchDasarian(http, dasarian, pause));
        if (result !== null) items++;
        if (result) saved++;
      } catch (err) {
        errors.push(`${dasarianLabel(dasarian)}: ${err.message}`);
      }
    }
    status.checked_at = now;
  }

  // Backfill arsip lama, dicicil beberapa dasarian per run supaya tidak membebani server.
  const backfillFrom = data.cewsBackfillFrom === undefined ? BACKFILL_FROM : data.cewsBackfillFrom;
  let next = status.backfill_next ?? (status.backfill_done_at ? null : backfillFrom);
  for (let i = 0; next && i < BACKFILL_PER_RUN && compareDasarian(next, current) < 0; i++) {
    try {
      const result = await saveDasarian(context, next, await fetchDasarian(http, next, pause));
      if (result !== null) items++;
      if (result) saved++;
      next = nextDasarian(next);
    } catch (err) {
      errors.push(`backfill ${dasarianLabel(next)}: ${err.message}`);
      break;
    }
  }
  if (next && compareDasarian(next, current) >= 0) {
    status.backfill_done_at = now;
    next = null;
  }
  status.backfill_next = next;

  await archive.writeJson('bmkg-cews/status.json', status);
  if (errors.length && items === 0) throw new Error(errors.join('; '));
  return { items, new: saved, errors };
}
