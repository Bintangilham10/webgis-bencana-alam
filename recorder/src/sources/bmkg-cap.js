import * as cheerio from 'cheerio';
import { datePath, monthPath, safeName } from '../lib/paths.js';

// Feed RSS hanya berisi peringatan yang sedang aktif; yang sudah lewat hilang
// dari feed. Karena itu tiap XML CAP disimpan utuh begitu pertama terlihat.
export const RSS_URL = 'https://www.bmkg.go.id/alerts/nowcast/id';

function toIsoOrNull(text) {
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseRss(xml) {
  const $ = cheerio.load(xml, { xml: true });
  return $('item')
    .map((_, item) => {
      const $item = $(item);
      return {
        identifier: $item.find('guid').text().trim(),
        url: $item.find('link').text().trim(),
        title: $item.find('title').text().trim(),
        published_at: toIsoOrNull($item.find('pubDate').text().trim()),
      };
    })
    .get()
    .filter((item) => item.identifier && item.url);
}

// Ringkasan untuk indeks; poligon dan deskripsi lengkap tetap ada di XML asli.
export function parseCap(xml) {
  const $ = cheerio.load(xml, { xml: true });
  const identifier = $('alert > identifier').text().trim();
  if (!identifier) throw new Error('XML CAP tanpa <identifier>');

  const info = $('alert > info').first();
  const field = (scope, selector) => scope.children(selector).first().text().trim() || null;
  const alert = $('alert').first();

  return {
    identifier,
    sent: field(alert, 'sent'),
    status: field(alert, 'status'),
    msg_type: field(alert, 'msgType'),
    event: field(info, 'event'),
    severity: field(info, 'severity'),
    urgency: field(info, 'urgency'),
    certainty: field(info, 'certainty'),
    effective: field(info, 'effective'),
    expires: field(info, 'expires'),
    headline: field(info, 'headline'),
    areas: info
      .find('area > areaDesc')
      .map((_, el) => $(el).text().trim())
      .get(),
    polygon_count: info.find('area > polygon').length,
  };
}

export async function recordBmkgCap({ archive, http, now }) {
  const items = parseRss(await http.fetchText(RSS_URL));
  let saved = 0;
  const errors = [];

  for (const item of items) {
    const publishedAt = item.published_at ?? now;
    const relPath = `bmkg-cap/${datePath(publishedAt)}/${safeName(item.identifier)}.xml`;
    // Peringatan yang sudah diarsipkan tidak diunduh ulang.
    if (await archive.exists(relPath)) continue;

    try {
      const xml = await http.fetchText(item.url);
      const summary = parseCap(xml);
      if (!(await archive.writeOnce(relPath, xml))) continue;
      await archive.appendLine(`bmkg-cap/indeks/${monthPath(publishedAt)}.jsonl`, {
        ...summary,
        url: item.url,
        file: relPath,
        first_seen_at: now,
      });
      saved++;
    } catch (err) {
      errors.push(`${item.identifier}: ${err.message}`);
    }
  }

  return { items: items.length, new: saved, errors };
}
