// Web Push dengan node:crypto, tanpa pustaka luar.
//
// Tiga standar yang dipakai:
// - RFC 8030: pesan dikirim dengan POST ke alamat layanan push milik browser (endpoint);
// - RFC 8291: isi pesan dienkripsi untuk browser itu (ECDH P-256 + HKDF + AES-128-GCM,
//   pengodean isi "aes128gcm" dari RFC 8188), jadi layanan push tidak bisa membacanya;
// - RFC 8292 (VAPID): server memperkenalkan diri ke layanan push dengan JWT bertanda
//   tangan ES256.
// Enkripsinya diuji terhadap contoh di RFC 8291 Lampiran A (test/push.test.js).
import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';

const RECORD_SIZE = 4096;
// Layanan push membatasi pesan ±4 KB; sisanya untuk kepala (86 byte) dan tag (17 byte).
export const MAX_PAYLOAD_BYTES = 3000;
const VAPID_TTL_SECONDS = 12 * 3600;

// Layanan push yang dikenal. Endpoint berasal dari browser pengguna, jadi tanpa daftar
// ini siapa pun bisa menyuruh server mengirim POST ke alamat mana saja (SSRF).
const PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge di Android, Brave, Opera, Samsung Internet
  'push.services.mozilla.com', // Firefox (updates.push.services.mozilla.com)
  'notify.windows.com', // Edge di Windows
  'push.apple.com', // Safari (web.push.apple.com)
];

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64u = (text) => Buffer.from(String(text), 'base64url');

export function allowedEndpoint(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

// Kunci langganan dari browser: kunci publik P-256 tak terkompresi (65 byte) dan
// rahasia autentikasi (16 byte), keduanya base64url.
export function validSubscriptionKeys(p256dh, auth) {
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !/^[\w-]+$/.test(p256dh) || !/^[\w-]+$/.test(auth)) return false;
  const publicKey = fromB64u(p256dh);
  if (publicKey.length !== 65 || publicKey[0] !== 4 || fromB64u(auth).length !== 16) return false;
  try {
    // Menolak titik yang tidak berada di kurva.
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    ecdh.computeSecret(publicKey);
    return true;
  } catch {
    return false;
  }
}

// Pasangan kunci VAPID: publik 65 byte dan privat 32 byte, base64url (bentuk yang
// sama dengan yang diminta PushManager.subscribe di browser).
export function generateVapidKeys() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])), privateKey: jwk.d };
}

// null bila kuncinya lengkap dan cocok; kalau tidak, alasan penolakannya.
export function vapidProblem({ publicKey, privateKey, subject } = {}) {
  if (!publicKey || !privateKey) return 'VAPID_PUBLIC_KEY dan VAPID_PRIVATE_KEY harus diisi keduanya';
  const pub = fromB64u(publicKey);
  if (pub.length !== 65 || pub[0] !== 4 || fromB64u(privateKey).length !== 32) return 'kunci VAPID bukan pasangan P-256 berbentuk base64url';
  if (!/^(mailto:.+@.+|https:\/\/.+)/.test(subject ?? '')) return 'VAPID_SUBJECT harus berupa alamat https:// atau mailto:';
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(fromB64u(privateKey));
    return ecdh.getPublicKey().equals(pub) ? null : 'kunci publik VAPID bukan pasangan kunci privatnya';
  } catch {
    return 'kunci privat VAPID tidak sah';
  }
}

// Isi pesan terenkripsi untuk satu langganan (RFC 8291). `salt` dan `localPrivateKey`
// hanya diisi test; aslinya acak dan sekali pakai untuk tiap pesan.
export function encryptPayload(payload, { p256dh, auth }, { salt = randomBytes(16), localPrivateKey } = {}) {
  const plaintext = Buffer.from(payload);
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error(`Isi pesan push terlalu besar (${plaintext.length} byte)`);
  const browserPublic = fromB64u(p256dh);
  const ecdh = createECDH('prime256v1');
  if (localPrivateKey) ecdh.setPrivateKey(fromB64u(localPrivateKey));
  else ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(browserPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), browserPublic, serverPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, fromB64u(auth), keyInfo, 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // Satu rekaman: isi, lalu pembatas 0x02 yang menandai rekaman terakhir.
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.update(Buffer.from([2])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = serverPublic.length;
  return Buffer.concat([header, serverPublic, ciphertext]);
}

// Nilai header Authorization untuk satu layanan push (RFC 8292).
export function vapidAuthorization(endpoint, { publicKey, privateKey, subject }, { now = Date.now() } = {}) {
  const pub = fromB64u(publicKey);
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + VAPID_TTL_SECONDS, sub: subject }));
  const signature = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(signature)}, k=${publicKey}`;
}

// Mengirim satu pesan; mengembalikan status HTTP layanan push (201 = diterima,
// 404/410 = langganan sudah tidak berlaku). `ttl` = berapa detik layanan push
// menyimpan pesan bila perangkat sedang tidak terjangkau. Pengalihan tidak diikuti.
export async function sendPush(subscription, payload, vapid, { ttl = 3600, urgency = 'normal', topic, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const headers = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
    Authorization: vapidAuthorization(subscription.endpoint, vapid),
  };
  if (topic) headers.Topic = topic;
  const res = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers,
    body: encryptPayload(payload, subscription),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.status;
}
