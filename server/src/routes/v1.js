import express, { Router } from 'express';
import * as apiKeys from '../api-keys.js';
import { rateLimit } from '../lib/rate-limit.js';

// API untuk pengembang luar: /api/v1, dengan kunci API dan kuota harian per kunci.
// Isinya data yang sudah disimpan SIGAP sendiri. Endpoint yang memanggil layanan
// luar per permintaan (cek risiko, rute, debit sungai, pencarian tempat, muka laut)
// tidak dibuka di sini, supaya pemakaian lewat kunci tidak menghabiskan kuota
// layanan gratis yang juga dipakai aplikasi.

export const DOCS = '/pengembang.html';

// Daftar ini sekaligus menentukan endpoint mana yang boleh diakses dan mengisi
// tabel di halaman dokumentasi (lewat GET /api/v1).
export const ENDPOINTS = [
  {
    path: '/earthquakes', title: 'Gempa bumi', params: 'source = bmkg, usgs, emsc, atau gfz; days = 1 sampai 90',
    description: 'Gempa dari katalog yang dipilih, GeoJSON. Bawaan: BMKG (gempa dirasakan dan M ≥ 5), 7 hari terakhir.',
    source: 'BMKG, USGS, EMSC, GFZ GEOFON', update: 'tiap 1 sampai 3 menit',
  },
  {
    path: '/volcanoes', title: 'Gunung api', params: '',
    description: 'Level aktivitas tiap gunung api yang dipantau, GeoJSON.',
    source: 'PVMBG (MAGMA Indonesia)', update: 'tiap 30 menit',
  },
  {
    path: '/cap', title: 'Peringatan dini cuaca', params: '',
    description: 'Peringatan dini cuaca yang sedang berlaku, dengan poligon dan kab/kota yang terkena, GeoJSON.',
    source: 'BMKG', update: 'tiap 5 menit',
  },
  {
    path: '/outlook', title: 'Indikasi SIGAP 3 hari', params: '',
    description: 'Level indikasi hujan lebat, banjir, dan tanah longsor per kab/kota untuk hari ini sampai lusa. Indikasi sistem, bukan peringatan resmi.',
    source: 'SIGAP, dari prakiraan hujan ECMWF (lewat Open-Meteo) dan zona bahaya InaRISK BNPB', update: 'tiap 12 jam',
  },
  {
    path: '/weather-stations', title: 'Hujan terukur', params: '',
    description: 'Hujan 24 jam terakhir dan cuaca terkini di stasiun pengamatan, GeoJSON.',
    source: 'Stasiun BMKG lewat gerbang NOAA/NWS; cuaca bandara dari NOAA Aviation Weather Center', update: 'tiap 10 menit',
  },
  {
    path: '/landslides', title: 'Riwayat tanah longsor', params: '',
    description: 'Inventaris kejadian gerakan tanah dari laporan lapangan dan tanggapan kejadian, GeoJSON.',
    source: 'PVMBG, Badan Geologi', update: 'saat inventaris diperbarui',
  },
  {
    path: '/wilayah', title: 'Batas wilayah', params: 'tingkat = provinsi atau kabkota',
    description: 'Batas provinsi atau kab/kota yang disederhanakan, dengan kode wilayah Kepmendagri, GeoJSON.',
    source: 'Kepmendagri 2025 (cahyadsn/wilayah_boundaries, MIT)', update: 'tetap',
  },
  {
    path: '/notifications', title: 'Notifikasi terbaru', params: 'limit = 1 sampai 100',
    description: 'Notifikasi 24 jam terakhir: gempa BMKG baru, perubahan level gunung api, dan peringatan dini cuaca baru.',
    source: 'SIGAP, dari BMKG dan PVMBG', update: 'langsung',
  },
  {
    path: '/stream', title: 'Aliran notifikasi langsung', params: 'header Last-Event-ID (opsional)',
    description: 'Server-Sent Events: notifikasi yang sama, dikirim saat terjadi. Last-Event-ID mengirim ulang yang terlewat, paling lama 24 jam. Satu sambungan dihitung satu permintaan; paling banyak 3 sambungan sekaligus per kunci.',
    source: 'SIGAP, dari BMKG dan PVMBG', update: 'langsung',
  },
];
const ALLOWED = new Set(ENDPOINTS.map((e) => e.path));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'X-API-Key, Authorization, Content-Type, Last-Event-ID',
  'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After',
  'Access-Control-Max-Age': '86400',
};

function readKey(req) {
  const header = req.get('X-API-Key');
  if (header) return header.trim();
  const auth = req.get('Authorization') ?? '';
  return auth.slice(0, 7).toLowerCase() === 'bearer ' ? auth.slice(7).trim() : null;
}

// Jawaban ber-kunci tidak boleh disimpan cache bersama, walau handler aslinya
// menandainya "public" untuk pemakaian aplikasi. Handler yang tidak mengatur cache
// mendapat "private".
function keepCachePrivate(res) {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) =>
    setHeader(name, String(name).toLowerCase() === 'cache-control' ? String(value).replace('public', 'private') : value);
  res.setHeader('Cache-Control', 'private');
}

// `data` = router yang sama dengan yang dipakai aplikasi di /api, jadi isi jawaban
// /api/v1 selalu sama dengan yang tampil di peta. `keys` dan batas laju bisa diganti saat test.
export function createV1Router({ data, keys = apiKeys, registerLimit = {}, ipLimit = {}, maxStreamsPerKey = 3 }) {
  const router = Router();

  // Pendaftaran kunci didaftarkan sebelum header CORS dipasang, jadi jawabannya (juga
  // jawaban permintaan awal OPTIONS) tidak pernah membawa header itu, dengan penulisan
  // alamat apa pun yang diterima Express ("/keys/", "/KEYS"). Tanpa header CORS, browser
  // menolak skrip situs lain yang mencoba membuat kunci lewat pengunjungnya.
  router.options('/keys', (req, res) => res.status(204).end());
  router.post(
    '/keys',
    // Longgar, karena satu kelas atau kantor bisa mendaftar lewat satu alamat IP yang sama.
    rateLimit({ limit: 20, windowMs: 60 * 60_000, message: 'Terlalu banyak pendaftaran kunci dari jaringan ini. Coba lagi satu jam lagi.', ...registerLimit }),
    express.json({ limit: '4kb' }),
    async (req, res) => {
      const { value, error } = keys.validateRegistration(req.body);
      if (error) return res.status(400).json({ error });
      const created = await keys.createKey(value);
      if (!created) {
        return res.status(409).json({ error: `Email ini sudah punya ${keys.MAX_KEYS_PER_EMAIL} kunci aktif. Pakai salah satunya, atau minta pengelola mencabut yang lama.` });
      }
      res.status(201).set('Cache-Control', 'no-store').json({
        key: created.key,
        prefix: created.prefix,
        daily_quota: created.daily_quota,
        created_at: created.created_at,
        message: 'Simpan kunci ini sekarang. Kunci tidak disimpan di server dan tidak bisa ditampilkan lagi.',
      });
    },
  );

  // Data boleh dibaca dari halaman web mana pun (kuncinya di header, bukan cookie).
  router.use((req, res, next) => {
    res.set(CORS);
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  // Batas per alamat IP melindungi basis data dari permintaan beruntun, berkunci atau tidak.
  router.use(rateLimit({ limit: 300, windowMs: 60_000, message: 'Terlalu banyak permintaan dari jaringan ini. Coba lagi sebentar lagi.', ...ipLimit }));

  router.get('/', (req, res) => {
    res.json({
      name: 'API SIGAP Bencana',
      version: 'v1',
      docs: DOCS,
      authentication: 'Kirim kunci API lewat header X-API-Key (atau Authorization: Bearer). Kunci dibuat lewat POST /api/v1/keys atau formulir di halaman dokumentasi.',
      quota: 'Tiap kunci punya kuota permintaan per hari (UTC); sisa kuota ada di header X-RateLimit-Remaining.',
      daily_quota_default: keys.DEFAULT_DAILY_QUOTA,
      max_keys_per_email: keys.MAX_KEYS_PER_EMAIL,
      notice: 'Layanan riset mahasiswa, bukan peringatan resmi. Sebutkan sumber data tiap endpoint saat memakainya.',
      endpoints: ENDPOINTS.map((e) => ({ ...e, path: `/api/v1${e.path}` })),
    });
  });

  router.use(async (req, res, next) => {
    const key = readKey(req);
    if (!key) return res.status(401).json({ error: 'Kunci API tidak ada. Kirim lewat header X-API-Key.', docs: DOCS });
    const found = keys.KEY_PATTERN.test(key) ? await keys.consumeKey(key) : null;
    if (!found) return res.status(401).json({ error: 'Kunci API tidak dikenal.', docs: DOCS });
    if (found.revoked) return res.status(403).json({ error: 'Kunci API ini sudah dicabut.' });

    const reset = keys.nextReset();
    res.set({
      'X-RateLimit-Limit': String(found.daily_quota),
      'X-RateLimit-Remaining': String(Math.max(0, found.daily_quota - found.requests)),
      'X-RateLimit-Reset': String(Math.floor(reset.getTime() / 1000)),
    });
    if (found.requests > found.daily_quota) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000))));
      return res.status(429).json({ error: `Kuota harian kunci ini (${found.daily_quota} permintaan) sudah habis. Kuota kembali penuh pukul 07.00 WIB.` });
    }
    req.apiKey = found;
    keepCachePrivate(res);
    next();
  });

  router.get('/usage', async (req, res) => {
    const days = await keys.keyUsage(req.apiKey.id);
    res.set('Cache-Control', 'no-store').json({
      daily_quota: req.apiKey.daily_quota,
      used_today: req.apiKey.requests,
      remaining_today: Math.max(0, req.apiKey.daily_quota - req.apiKey.requests),
      resets_at: keys.nextReset().toISOString(),
      last_7_days: days,
    });
  });

  router.use((req, res, next) => {
    if (ALLOWED.has(req.path.replace(/\/$/, ''))) return next();
    res.status(404).json({ error: 'Endpoint tidak ada di API v1. Daftar endpoint ada di /api/v1.', docs: DOCS });
  });

  // Aliran notifikasi berbagi batas sambungan dengan pengguna peta, jadi satu kunci
  // hanya boleh membuka beberapa sambungan sekaligus.
  const openStreams = new Map();
  router.get('/stream', (req, res, next) => {
    const id = req.apiKey.id;
    const open = openStreams.get(id) ?? 0;
    if (open >= maxStreamsPerKey) {
      return res.status(429).json({ error: `Kunci ini sudah membuka ${maxStreamsPerKey} aliran notifikasi. Tutup salah satunya dulu.` });
    }
    openStreams.set(id, open + 1);
    res.once('close', () => {
      const left = openStreams.get(id) - 1;
      if (left > 0) openStreams.set(id, left);
      else openStreams.delete(id);
    });
    next();
  });

  router.use(...data);
  return router;
}
