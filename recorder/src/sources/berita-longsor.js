import * as cheerio from 'cheerio';
import { contentHash } from '../lib/hash.js';
import { hoursSince, pad2 } from '../lib/time.js';

// Berita longsor dari RSS Google News (bahasa Indonesia) sebagai sumber data
// kejadian independen. Yang disimpan hanya judul, sumber, waktu, dan tautan.
export const QUERIES = ['"tanah longsor" when:1d', 'longsor when:1d'];
export const rssUrl = (query) => `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`;

const CHECK_EVERY_HOURS = 6;

// Banyak situs asing (mis. Vietnam.vn) menerbitkan berita berbahasa Indonesia.
const FOREIGN_SOURCE = /vietnam|vov\.vn|nhandan|vnexpress/i;
const FOREIGN_PLACE =
  /\b(Vietnam|Thailand|Filipina|Malaysia|Tiongkok|China|India|Nepal|Jepang|Korea|Myanmar|Laos|Kamboja|Taiwan|Brasil|Peru|Kolombia|Italia|Pakistan|Sri Lanka|Bangladesh|Amerika)\b/i;
// Pencarian "longsor" juga menangkap berita yang tidak membahasnya di judul.
const RELEVANT = /longsor|gerakan tanah|pergeseran tanah|tanah bergerak|amblas|ambles/i;
// Heuristik awal; pelabelan akhir dilakukan di tahap riset.
const EVENT_WORDS =
  /\b(timbun\w*|tertimbun|terjang\w*|menerjang|landa|melanda|terjadi|menimpa|hantam\w*|korban|tewas|meninggal|hilang|putus|terputus|ambles|amblas|longsoran|material|bersihkan|tangani|penanganan|evakuasi|picu|memicu|dipicu|akibat|terdampak|rusak|merusak|roboh|menutup)\b/i;
const ADVISORY_WORDS =
  /\b(imbau\w*|waspada\w*|rawan|potensi|siaga|antisipasi|peringat\w*|ingatkan|mitigasi|relokasi|rencana|kesiapsiagaan|mengintai|diintai|ancam\w*)\b/i;

export function parseRss(xml) {
  const $ = cheerio.load(xml, { xml: true });
  return $('item')
    .map((_, item) => {
      const $item = $(item);
      const source = $item.find('source');
      const published = new Date($item.find('pubDate').text().trim());
      return {
        guid: $item.find('guid').text().trim(),
        title: $item.find('title').text().trim(),
        link: $item.find('link').text().trim(),
        source: source.text().trim() || null,
        source_url: source.attr('url') ?? null,
        published_at: Number.isNaN(published.getTime()) ? null : published.toISOString(),
      };
    })
    .get()
    .filter((item) => item.guid && item.title);
}

// Judul RSS berakhiran " - Nama Sumber".
const headline = (item) => (item.source && item.title.endsWith(` - ${item.source}`) ? item.title.slice(0, -(item.source.length + 3)) : item.title);

export function classify(item, gazetteer) {
  const text = headline(item);
  const foreign = FOREIGN_SOURCE.test(`${item.source ?? ''} ${item.source_url ?? ''}`) || FOREIGN_PLACE.test(text);
  const places = foreign || !gazetteer ? { kabKota: [], provinsi: [] } : gazetteer.findInText(text);
  const jenis = EVENT_WORDS.test(text) ? 'kejadian' : ADVISORY_WORDS.test(text) ? 'imbauan' : 'lainnya';
  return {
    luar_negeri: foreign,
    indonesia: !foreign && (places.kabKota.length > 0 || places.provinsi.length > 0),
    jenis,
    kab_kota: places.kabKota,
    provinsi: places.provinsi,
  };
}

export async function recordBeritaLongsor({ archive, http, now, data = {}, pause = async () => {} }) {
  const status = (await archive.readJson('berita-longsor/status.json')) ?? {};
  if (hoursSince(status.checked_at, now) < CHECK_EVERY_HOURS) return { items: 0, new: 0, skipped: 'belum 6 jam' };

  const items = new Map();
  const errors = [];
  for (const query of QUERIES) {
    try {
      for (const item of parseRss(await http.fetchText(rssUrl(query)))) {
        if (!items.has(item.guid) && RELEVANT.test(headline(item))) items.set(item.guid, { ...item, query });
      }
    } catch (err) {
      errors.push(`${query}: ${err.message}`);
    }
    await pause(1_000);
  }
  if (errors.length === QUERIES.length) throw new Error(errors.join('; '));

  let saved = 0;
  for (const item of items.values()) {
    const date = new Date(item.published_at ?? now);
    const relPath = `berita-longsor/${date.getUTCFullYear()}/${pad2(date.getUTCMonth() + 1)}/${contentHash(item.guid)}.json`;
    const record = { ...item, first_seen_at: now, ...classify(item, data.gazetteer) };
    if (await archive.writeOnce(relPath, `${JSON.stringify(record, null, 2)}\n`)) saved++;
  }
  await archive.writeJson('berita-longsor/status.json', { checked_at: now });
  return { items: items.size, new: saved, errors };
}
