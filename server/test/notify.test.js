import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { capNotification, quakeNotification, quakePlace, volcanoNotification } from '../src/jobs/notify.js';
import { localClock, localDateTime, zoneName } from '../src/lib/time.js';

describe('teks notifikasi', () => {
  test('jam lokal WIB, WITA, dan WIT', () => {
    assert.equal(localClock('2026-10-23T14:25:00Z'), '21.25');
    assert.equal(localClock('2026-10-23T16:50:00Z', 480), '00.50');
    assert.equal(localDateTime('2026-10-20T16:29:35Z'), '20 Okt, 23.29 WIB');
    assert.deepEqual([zoneName(420), zoneName(480), zoneName(540), zoneName(0)], ['WIB', 'WITA', 'WIT', 'UTC+0']);
  });

  test('wilayah gempa BMKG: arah setelah jarak dirapikan, nama tempat tidak diubah', () => {
    assert.equal(quakePlace('Pusat gempa berada di laut 121 km BaratDaya Lumajang, Jawa Timur'), 'Laut 121 km barat daya Lumajang, Jawa Timur');
    assert.equal(quakePlace('Pusat gempa berada di laut 44 km selatan Kab. Halmahera Utara'), 'Laut 44 km selatan Kab. Halmahera Utara');
    assert.equal(quakePlace('19 km Selatan Kodi, Sumba Barat Daya'), '19 km selatan Kodi, Sumba Barat Daya');
    assert.equal(quakePlace('35 km Timur Laut Ruteng'), '35 km timur laut Ruteng');
    assert.equal(quakePlace(null), 'Lokasi belum diketahui');
  });

  test('gempa: level dari magnitudo, potensi tsunami selalu tertinggi', () => {
    const row = {
      id: 'bmkg:20261020T162935Z', magnitude: 5.4, depth_km: 74, occurred_at: '2026-10-20T16:29:35Z', lat: -4.4, lon: 95.6,
      props: { wilayah: 'Pusat gempa berada di laut 59 km BaratDaya Meulaboh', dirasakan: 'III Kab. Aceh Selatan, III - IV Kab. Aceh Barat' },
    };
    const n = quakeNotification(row);
    assert.equal(n.level, 1);
    assert.equal(n.title, 'Gempa M 5,4 · Laut 59 km barat daya Meulaboh');
    assert.equal(n.body, '20 Okt, 23.29 WIB · kedalaman 74 km · dirasakan III Kab. Aceh Selatan, III–IV Kab. Aceh Barat');
    assert.deepEqual([n.kind, n.ref, n.lat, n.lon], ['gempa', row.id, -4.4, 95.6]);
    assert.equal(quakeNotification({ ...row, magnitude: 6.2 }).level, 2);
    const tsunami = quakeNotification({ ...row, magnitude: 7.4, props: { ...row.props, potensi: 'Berpotensi tsunami' } });
    assert.equal(tsunami.level, 3);
    assert.match(tsunami.title, /^Gempa M 7,4 berpotensi tsunami · /);
  });

  test('gunung api: naik, turun, atau berubah (level sebelumnya belum tercatat)', () => {
    const row = { kode: 'MER', nama: 'Merapi', level: 3, level_sebelumnya: 2, level_changed_at: '2026-10-23T03:00:00Z', lat: -7.54, lon: 110.44 };
    const up = volcanoNotification(row);
    assert.equal(up.title, 'Gunung Merapi naik ke Level III (Siaga)');
    assert.match(up.body, /^Sebelumnya Level II \(Waspada\) · terpantau di MAGMA 23 Okt, 10\.00 WIB/);
    assert.equal(up.level, 2);
    assert.equal(up.ref, 'MER:2026-10-23T03:00:00.000Z');
    assert.equal(volcanoNotification({ ...row, level: 2, level_sebelumnya: 3 }).title, 'Gunung Merapi turun ke Level II (Waspada)');
    assert.equal(volcanoNotification({ ...row, level_sebelumnya: null }).title, 'Gunung Merapi berubah ke Level III (Siaga)');
  });

  test('peringatan cuaca: jam berlaku di zona waktunya dan kab/kota terkena', () => {
    const row = {
      identifier: 'X', headline: 'Hujan Lebat disertai Petir di Sulawesi Selatan', event: 'Hujan Lebat dan Petir', severity: 'Moderate',
      sent: '2026-10-23T12:00:00Z', effective: '2026-10-23T12:10:00Z', expires: '2026-10-23T14:30:00Z', utc_offset: 480,
      wilayah: ['73.71', '73.06', '73.09', '73.08', '73.10'], wilayah_nama: ['Kota Makassar', 'Kab. Gowa', 'Kab. Maros', 'Kab. Takalar', 'Kab. Pangkep'],
      lat: -5.1, lon: 119.4,
    };
    const n = capNotification(row);
    assert.equal(n.title, row.headline);
    assert.equal(n.body, 'Berlaku 20.10–22.30 WITA · Kota Makassar, Kab. Gowa, Kab. Maros, Kab. Takalar (+1 kab/kota)');
    assert.deepEqual(n.wilayah, row.wilayah);
    assert.equal(capNotification({ ...row, severity: 'Severe' }).level, 2);
  });
});
