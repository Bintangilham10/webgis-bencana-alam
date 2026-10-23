import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { parseCap, parsePolygon, parseRss } from '../src/sources/bmkg-cap.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// Fixture = RSS dan XML CAP asli BMKG (23 Okt 2026), dan satu peringatan
// Sulawesi Tengah dari arsip perekam (1 Okt 2026, WITA, satu poligon).
describe('peringatan dini cuaca BMKG (CAP)', () => {
  test('RSS: guid = identifier CAP dan tautan ke berkas XML', () => {
    const items = parseRss(fixture('bmkg-cap-rss.xml'));
    assert.equal(items.length, 3);
    assert.deepEqual(items[1], {
      identifier: '2.49.0.1.360.0.2026.10.23.14.32.004',
      url: 'https://www.bmkg.go.id/alerts/nowcast/id/CJB20261023004_alert.xml',
      title: 'Hujan Lebat disertai Petir di Jawa Barat',
      published_at: '2026-10-23T14:15:00.000Z',
    });
  });

  test('CAP Jawa Barat: atribut peringatan dan 20 poligon kecamatan [lon, lat]', () => {
    const cap = parseCap(fixture('bmkg-cap-jabar.xml'));
    assert.equal(cap.identifier, '2.49.0.1.360.0.2026.10.23.14.32.004');
    assert.deepEqual(
      [cap.msg_type, cap.status, cap.event, cap.severity, cap.urgency, cap.certainty],
      ['Alert', 'Actual', 'Hujan Lebat dan Petir', 'Moderate', 'Immediate', 'Observed'],
    );
    assert.equal(cap.sent, '2026-10-23T14:15:00.000Z');
    assert.equal(cap.effective, '2026-10-23T14:25:00.000Z');
    assert.equal(cap.expires, '2026-10-23T16:50:00.000Z');
    assert.equal(cap.utc_offset, 420);
    assert.equal(cap.headline, 'Hujan Lebat disertai Petir di Jawa Barat');
    assert.match(cap.description, /khususnya di ANDIR, BANDUNG KULON/);
    assert.equal(cap.area_desc, 'Jawa Barat');
    assert.match(cap.web, /infografis\/CJB\/2026\/10\/23/);
    assert.deepEqual(cap.references, []);
    assert.equal(cap.polygons.length, 20);
    // "-6.927,107.547" → [107.547, -6.927]; cincin tertutup.
    const [ring] = cap.polygons;
    assert.deepEqual(ring[0], [107.547, -6.927]);
    assert.deepEqual(ring.at(-1), ring[0]);
  });

  test('CAP Sulawesi Tengah: waktu WITA (+08:00) dan satu poligon', () => {
    const cap = parseCap(fixture('bmkg-cap-satu-poligon.xml'));
    assert.equal(cap.utc_offset, 480);
    assert.equal(cap.expires, '2026-10-01T03:00:00.000Z');
    assert.equal(cap.polygons.length, 1);
    assert.equal(cap.area_desc, 'Sulawesi Tengah');
  });

  test('poligon: ditutup bila belum, ditolak bila di luar kawasan atau kurang dari tiga titik', () => {
    assert.deepEqual(parsePolygon('-6,107 -6,108 -7,108'), [[107, -6], [108, -6], [108, -7], [107, -6]]);
    assert.equal(parsePolygon('-6,107 -6,108 -6,107'), null);
    assert.equal(parsePolygon('40,107 -6,108 -7,108 40,107'), null);
    assert.equal(parsePolygon(''), null);
  });

  test('entitas XML, CDATA, rujukan Update, dan berkas tanpa identifier', () => {
    const xml = `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
      <identifier>X.2</identifier><sent>2026-10-23T21:15:00+09:00</sent><status>Actual</status>
      <msgType>Update</msgType><references>bmkg,X.1,2026-10-23T20:00:00+09:00 bmkg,X.0,2026-10-23T19:00:00+09:00</references>
      <info><event>Hujan Sangat Lebat</event><severity>Severe</severity>
        <effective>2026-10-23T21:20:00+09:00</effective><expires>2026-10-23T23:00:00+09:00</expires>
        <headline>Hujan &amp; Petir di Papua</headline><description><![CDATA[Waspada <banjir>]]></description>
        <area><areaDesc>Papua</areaDesc><polygon>-2.5,140.6 -2.5,140.8 -2.7,140.8 -2.5,140.6</polygon></area>
      </info></alert>`;
    const cap = parseCap(xml);
    assert.equal(cap.headline, 'Hujan & Petir di Papua');
    assert.equal(cap.description, 'Waspada <banjir>');
    assert.deepEqual(cap.references, ['X.1', 'X.0']);
    assert.equal(cap.utc_offset, 540);
    assert.throws(() => parseCap('<alert><info/></alert>'), /tanpa <identifier>/);
  });
});
