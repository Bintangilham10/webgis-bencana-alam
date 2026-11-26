import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { describe, test } from 'node:test';
import {
  allowedEndpoint, encryptPayload, generateVapidKeys, MAX_PAYLOAD_BYTES, sendPush, validSubscriptionKeys, vapidAuthorization, vapidProblem,
} from '../src/lib/web-push.js';
import { NEAR_KM, validateSubscription, wantsPush } from '../src/push.js';

const bytes = (text) => Buffer.from(text, 'base64url');

// RFC 8291 Lampiran A: masukan dan hasil antara untuk contoh di bagian 5.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  browserPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  browserPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

// Sisi browser: membuka pesan dengan kunci privat browser (kebalikan encryptPayload).
function decrypt(body, { privateKey, auth }) {
  const salt = body.subarray(0, 16);
  const keyLength = body[20];
  const serverPublic = body.subarray(21, 21 + keyLength);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(bytes(privateKey));
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(serverPublic), bytes(auth), keyInfo, 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const sealed = body.subarray(21 + keyLength);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, 'pembatas rekaman terakhir');
  return plain.subarray(0, -1).toString();
}

function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), privateKey: ecdh.getPrivateKey().toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') };
}

describe('Web Push: enkripsi isi pesan (RFC 8291)', () => {
  test('contoh di RFC 8291 Lampiran A terulang persis', () => {
    const body = encryptPayload(RFC.plaintext, { p256dh: RFC.browserPublic, auth: RFC.auth }, { salt: bytes(RFC.salt), localPrivateKey: RFC.serverPrivate });
    assert.equal(body.length, 86 + 58);
    assert.ok(body.subarray(0, 86).equals(bytes(RFC.header)), 'kepala: salt, ukuran rekaman 4096, kunci publik server');
    assert.ok(body.subarray(86).equals(bytes(RFC.ciphertext)), 'isi terenkripsi');
    assert.equal(decrypt(body, { privateKey: RFC.browserPrivate, auth: RFC.auth }), RFC.plaintext);
  });

  test('tiap pesan memakai salt dan kunci sekali pakai, dan bisa dibuka browser penerimanya saja', () => {
    const browser = browserKeys();
    const text = JSON.stringify({ title: 'Gempa M 5,4 · Laut 59 km barat daya Meulaboh', body: 'kedalaman 74 km' });
    const a = encryptPayload(text, browser);
    const b = encryptPayload(text, browser);
    assert.ok(!a.equals(b));
    assert.equal(decrypt(a, browser), text);
    assert.equal(decrypt(b, browser), text);
    assert.throws(() => decrypt(a, { ...browserKeys(), auth: browser.auth }), /authenticate|auth/i);
    assert.throws(() => decrypt(a, { ...browser, auth: Buffer.alloc(16, 8).toString('base64url') }), /authenticate|auth/i);
  });

  test('isi yang terlalu besar ditolak sebelum dikirim', () => {
    const browser = browserKeys();
    assert.equal(encryptPayload('x'.repeat(MAX_PAYLOAD_BYTES), browser).length, 86 + MAX_PAYLOAD_BYTES + 17);
    assert.throws(() => encryptPayload('x'.repeat(MAX_PAYLOAD_BYTES + 1), browser), /terlalu besar/);
  });

  test('kunci langganan: titik P-256 tak terkompresi dan rahasia 16 byte', () => {
    assert.equal(validSubscriptionKeys(RFC.browserPublic, RFC.auth), true);
    assert.equal(validSubscriptionKeys(`B${'A'.repeat(86)}`, RFC.auth), false, 'titik di luar kurva');
    assert.equal(validSubscriptionKeys(RFC.browserPublic.slice(0, 40), RFC.auth), false);
    assert.equal(validSubscriptionKeys(RFC.browserPublic, 'AAAA'), false);
    assert.equal(validSubscriptionKeys(RFC.browserPublic, `${RFC.auth}=`), false);
    assert.equal(validSubscriptionKeys(undefined, RFC.auth), false);
    assert.equal(validSubscriptionKeys({ toString: () => RFC.browserPublic }, RFC.auth), false);
  });
});

describe('Web Push: tanda pengenal server (VAPID, RFC 8292)', () => {
  const keys = generateVapidKeys();
  const vapid = { ...keys, subject: 'https://sigap.contoh.id' };

  test('pasangan kunci baru sah; pasangan yang tertukar atau subjek kosong ditolak dengan alasan', () => {
    assert.equal(bytes(keys.publicKey).length, 65);
    assert.equal(bytes(keys.privateKey).length, 32);
    assert.equal(vapidProblem(vapid), null);
    assert.match(vapidProblem({ ...vapid, publicKey: generateVapidKeys().publicKey }), /bukan pasangan/);
    assert.match(vapidProblem({ ...vapid, subject: 'sigap' }), /VAPID_SUBJECT/);
    assert.match(vapidProblem({ ...vapid, subject: undefined }), /VAPID_SUBJECT/);
    assert.match(vapidProblem({ publicKey: keys.publicKey }), /harus diisi keduanya/);
    assert.match(vapidProblem({ ...vapid, privateKey: 'pendek' }), /base64url/);
    assert.equal(vapidProblem({ ...vapid, subject: 'mailto:admin@contoh.id' }), null);
  });

  test('JWT ES256: untuk asal layanan push itu saja, berlaku 12 jam, tanda tangannya sah', () => {
    const now = Date.parse('2026-11-26T12:00:00Z');
    const value = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', vapid, { now });
    const [, jwt, publicKey] = /^vapid t=([\w.-]+), k=([\w-]+)$/.exec(value);
    assert.equal(publicKey, keys.publicKey);
    const [head, claims, signature] = jwt.split('.');
    assert.deepEqual(JSON.parse(bytes(head)), { typ: 'JWT', alg: 'ES256' });
    assert.deepEqual(JSON.parse(bytes(claims)), { aud: 'https://fcm.googleapis.com', exp: now / 1000 + 12 * 3600, sub: 'https://sigap.contoh.id' });
    const point = bytes(publicKey);
    const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') } });
    assert.equal(bytes(signature).length, 64);
    assert.equal(verify('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, bytes(signature)), true);
    assert.equal(verify('sha256', Buffer.from(`${head}.${claims}x`), { key, dsaEncoding: 'ieee-p1363' }, bytes(signature)), false);
  });
});

describe('Web Push: alamat layanan push dan pengiriman', () => {
  test('hanya layanan push yang dikenal, lewat HTTPS dan port bawaan', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://web.push.apple.com/QGk',
      'https://wns2-sg2p.notify.windows.com/w/?token=BQYAAAD',
    ]) assert.equal(allowedEndpoint(ok), true, ok);
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.contoh.id/fcm/send/abc',
      'https://contoh.id/fcm.googleapis.com',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://pengguna:sandi@fcm.googleapis.com/fcm/send/abc',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'bukan alamat',
      '',
      null,
    ]) assert.equal(allowedEndpoint(bad), false, String(bad));
  });

  test('permintaan ke layanan push: header, isi terenkripsi, pengalihan tidak diikuti', async () => {
    const browser = browserKeys();
    const vapid = { ...generateVapidKeys(), subject: 'https://sigap.contoh.id' };
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { status: 201 };
    };
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: browser.p256dh, auth: browser.auth };
    const status = await sendPush(subscription, '{"id":7}', vapid, { ttl: 600, urgency: 'high', topic: 'sigap-7', fetchImpl });
    assert.equal(status, 201);
    const [{ url, init }] = calls;
    assert.equal(url, subscription.endpoint);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
    assert.deepEqual([init.headers.TTL, init.headers.Urgency, init.headers.Topic], ['600', 'high', 'sigap-7']);
    assert.match(init.headers.Authorization, new RegExp(`^vapid t=[\\w.-]+, k=${vapid.publicKey}$`));
    assert.equal(decrypt(init.body, browser), '{"id":7}');
    // Tanpa topik, header Topic tidak dikirim.
    await sendPush(subscription, '{}', vapid, { fetchImpl });
    assert.equal('Topic' in calls[1].init.headers, false);
    assert.equal(calls[1].init.headers.TTL, '3600');
  });
});

describe('Web Push: siapa yang dikirimi', () => {
  const quake = { kind: 'gempa', lat: -6.9, lon: 107.6, wilayah: [] };
  const volcano = { kind: 'gunung_api', lat: -7.54, lon: 110.44, wilayah: [] };
  const weather = { kind: 'cuaca', lat: -6.9, lon: 107.6, wilayah: ['32.73', '32.04'] };
  const bandung = { lat: -6.9, lon: 107.6, kode: '32.73' };
  const jayapura = { lat: -2.5, lon: 140.7, kode: '91.71' };
  const sub = (area, nearOnly = false) => ({ near_only: nearOnly, lat: area?.lat ?? null, lon: area?.lon ?? null, kode: area?.kode ?? null });

  test('tanpa wilayah: semua gempa dan gunung api, tanpa peringatan cuaca', () => {
    assert.deepEqual([quake, volcano, weather].map((n) => wantsPush(n, sub(null))), [true, true, false]);
    // "Hanya sekitar lokasi saya" tanpa wilayah tidak menyaring apa pun, seperti di halaman.
    assert.deepEqual([quake, volcano, weather].map((n) => wantsPush(n, sub(null, true))), [true, true, false]);
  });

  test('dengan wilayah: peringatan cuaca hanya yang mengenai wilayah itu; gempa dan gunung api tetap semua', () => {
    assert.deepEqual([quake, volcano, weather].map((n) => wantsPush(n, sub(bandung))), [true, true, true]);
    assert.deepEqual([quake, volcano, weather].map((n) => wantsPush(n, sub(jayapura))), [true, true, false]);
    // Kab/kota pengguna tercantum walau titik peringatannya jauh.
    assert.equal(wantsPush({ ...weather, lat: -7.9, lon: 108.9 }, sub(bandung)), true);
    assert.equal(wantsPush({ ...weather, lat: -7.9, lon: 108.9 }, sub({ ...bandung, kode: null })), false);
  });

  test('hanya sekitar lokasi saya: jarak per jenis seperti di halaman', () => {
    assert.deepEqual(NEAR_KM, { gempa: 150, gunung_api: 100, cuaca: 30 });
    assert.deepEqual([quake, volcano, weather].map((n) => wantsPush(n, sub(jayapura, true))), [false, false, false]);
    // 1° lintang ≈ 111 km: gempa 150 km masuk, gunung api 100 km tidak.
    const north = sub({ lat: bandung.lat + 1, lon: bandung.lon, kode: null }, true);
    assert.equal(wantsPush(quake, north), true);
    assert.equal(wantsPush({ ...volcano, lat: bandung.lat, lon: bandung.lon }, north), false);
    assert.equal(wantsPush({ ...quake, lat: bandung.lat - 0.4 }, north), false);
    // Notifikasi tanpa koordinat tidak bisa dinilai dekat.
    assert.equal(wantsPush({ ...quake, lat: null, lon: null }, sub(bandung, true)), false);
  });
});

describe('Web Push: isi pendaftaran dari browser', () => {
  const keys = { p256dh: RFC.browserPublic, auth: RFC.auth };
  const body = (extra = {}) => ({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys }, ...extra });

  test('wilayah dibulatkan ke 0,1° sebelum disimpan', () => {
    const { value } = validateSubscription(body({ nearOnly: true, area: { lat: -6.91474, lon: 107.60981, kode: '32.73' } }));
    assert.deepEqual(value, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: keys.p256dh, auth: keys.auth, nearOnly: true, lat: -6.9, lon: 107.6, kode: '32.73' });
  });

  test('tanpa wilayah tidak ada lokasi yang disimpan; nearOnly hanya true bila dikirim true', () => {
    assert.deepEqual(validateSubscription(body()).value, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: keys.p256dh, auth: keys.auth, nearOnly: false, lat: null, lon: null, kode: null });
    assert.equal(validateSubscription(body({ nearOnly: 'true' })).value.nearOnly, false);
    assert.equal(validateSubscription(body({ area: { lat: -6.9, lon: 107.6 } })).value.kode, null);
  });

  test('yang tidak sah ditolak dengan alasan', () => {
    assert.match(validateSubscription(undefined).error, /layanan push/);
    assert.match(validateSubscription({ subscription: { endpoint: 'https://contoh.id/push', keys } }).error, /layanan push/);
    assert.match(validateSubscription({ subscription: { endpoint: `https://fcm.googleapis.com/${'x'.repeat(2000)}`, keys } }).error, /layanan push/);
    assert.match(validateSubscription({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { ...keys, auth: 'x' } } }).error, /Kunci langganan/);
    assert.match(validateSubscription(body({ area: { lat: 35.6, lon: 139.7 } })).error, /kawasan Indonesia/);
    assert.match(validateSubscription(body({ area: { lat: '-6.9', lon: 107.6 } })).error, /kawasan Indonesia/);
    assert.match(validateSubscription(body({ area: { lat: -6.9, lon: 107.6, kode: '3273' } })).error, /Kode wilayah/);
    assert.match(validateSubscription(body({ area: { lat: -6.9, lon: 107.6, kode: { $ne: '' } } })).error, /Kode wilayah/);
  });
});
