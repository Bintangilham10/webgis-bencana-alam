import { createHash, randomBytes } from 'node:crypto';
import { query } from './db.js';

// Kunci API untuk pengembang luar (/api/v1): pembuatan, pemeriksaan, dan kuota.
// Kunci berupa "sigap_" + 32 huruf acak (192 bit). Basis data hanya menyimpan sidik
// SHA-256-nya; karena kuncinya acak penuh, sidik biasa sudah cukup dan pemeriksaan
// tiap permintaan tetap satu query.

export const KEY_PATTERN = /^sigap_[A-Za-z0-9_-]{32}$/;
export const PREFIX_LENGTH = 14;
export const MAX_KEYS_PER_EMAIL = 3;
// Kuota kunci baru; pengelola bisa mengubahnya per kunci (scripts/kunci-api.js).
// Gempa diperbarui tiap menit, jadi aplikasi yang mengambilnya tiap menit butuh 1.440
// permintaan sehari; 5.000 cukup untuk tiga endpoint dengan selang itu.
export const DEFAULT_DAILY_QUOTA = 5000;
const LIMITS = { name: [2, 80], email: [5, 120], purpose: [10, 500] };

// Bentuk alamat email saja (satu @, domain bertitik); alamatnya tidak diverifikasi.
function isEmail(text) {
  const [local, domain, ...rest] = text.split('@');
  if (!local || !domain || rest.length || /\s/.test(text)) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every(Boolean) && labels.at(-1).length >= 2;
}

export const generateKey = () => `sigap_${randomBytes(24).toString('base64url')}`;
export const hashKey = (key) => createHash('sha256').update(key).digest('hex');
export const keyPrefix = (key) => key.slice(0, PREFIX_LENGTH);

// Kuota dihitung per hari UTC, jadi berganti pukul 07.00 WIB.
export const nextReset = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

// Karakter format tak terlihat (mis. pembalik arah teks) dibuang dan karakter kendali
// (mis. awal kode warna terminal) dijadikan spasi, karena isian ini nanti tampil di
// terminal pengelola.
const clean = (value) =>
  typeof value === 'string' ? value.replace(/\p{Cf}+/gu, '').replace(/\p{Cc}+/gu, ' ').trim().replace(/\s+/g, ' ') : '';
const within = (text, [min, max]) => text.length >= min && text.length <= max;

// Isi formulir pendaftaran → { value } yang sudah dirapikan, atau { error }.
export function validateRegistration(body) {
  const value = { name: clean(body?.name), email: clean(body?.email).toLowerCase(), purpose: clean(body?.purpose) };
  if (!within(value.name, LIMITS.name)) return { error: 'Nama atau nama tim wajib diisi, 2 sampai 80 huruf.' };
  if (!within(value.email, LIMITS.email) || !isEmail(value.email)) return { error: 'Alamat email tidak valid.' };
  if (!within(value.purpose, LIMITS.purpose)) return { error: 'Tujuan pemakaian wajib diisi, 10 sampai 500 huruf.' };
  if (body?.agree !== true) return { error: 'Ketentuan pakai harus disetujui.' };
  return { value };
}

// Membuat kunci baru; null bila email itu sudah punya jumlah kunci aktif terbanyak.
// Batasnya diperiksa di pernyataan yang sama dengan penyisipan.
export async function createKey({ name, email, purpose }) {
  const key = generateKey();
  const { rows } = await query(
    `INSERT INTO api_keys (key_hash, prefix, name, email, purpose, daily_quota)
     SELECT $1, $2, $3, $4, $5, $7
     WHERE (SELECT count(*) FROM api_keys WHERE lower(email) = lower($4) AND revoked_at IS NULL) < $6
     RETURNING prefix, daily_quota, created_at`,
    [hashKey(key), keyPrefix(key), name, email, purpose, MAX_KEYS_PER_EMAIL, DEFAULT_DAILY_QUOTA],
  );
  return rows.length ? { key, ...rows[0] } : null;
}

// Memeriksa kunci dan sekaligus mencatat satu permintaan hari ini. Hasilnya:
// null (kunci tidak dikenal) atau { id, daily_quota, revoked, requests }. Permintaan
// dari kunci yang dicabut tidak dicatat (requests null).
export async function consumeKey(key) {
  const { rows } = await query(
    `WITH k AS (
       SELECT id, daily_quota, revoked_at FROM api_keys WHERE key_hash = $1
     ), u AS (
       INSERT INTO api_usage (key_id, day, requests)
       SELECT id, (now() AT TIME ZONE 'utc')::date, 1 FROM k WHERE revoked_at IS NULL
       ON CONFLICT (key_id, day) DO UPDATE SET requests = api_usage.requests + 1
       RETURNING requests
     )
     SELECT k.id, k.daily_quota, k.revoked_at IS NOT NULL AS revoked, u.requests FROM k LEFT JOIN u ON true`,
    [hashKey(key)],
  );
  return rows[0] ?? null;
}

// Pemakaian satu kunci per hari, terbaru dulu.
export async function keyUsage(id, days = 7) {
  const { rows } = await query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS date, requests FROM api_usage
     WHERE key_id = $1 AND day > (now() AT TIME ZONE 'utc')::date - $2::int ORDER BY day DESC`,
    [id, days],
  );
  return rows;
}

// --- pengelolaan (scripts/kunci-api.js) --------------------------------------

export async function listKeys() {
  const { rows } = await query(
    `SELECT k.prefix, k.name, k.email, k.purpose, k.daily_quota, k.created_at, k.revoked_at,
            coalesce(sum(u.requests) FILTER (WHERE u.day = (now() AT TIME ZONE 'utc')::date), 0)::int AS today,
            coalesce(sum(u.requests) FILTER (WHERE u.day > (now() AT TIME ZONE 'utc')::date - 7), 0)::int AS week
     FROM api_keys k LEFT JOIN api_usage u ON u.key_id = k.id
     GROUP BY k.id ORDER BY k.created_at`,
  );
  return rows;
}

// Kunci dipilih dengan awalannya; harus menunjuk tepat satu kunci.
async function oneByPrefix(prefix) {
  const { rows } = await query('SELECT id, prefix, name FROM api_keys WHERE left(prefix, length($1)) = $1', [prefix]);
  if (rows.length !== 1) throw new Error(rows.length ? `Awalan "${prefix}" cocok dengan ${rows.length} kunci; tulis lebih panjang.` : `Tidak ada kunci berawalan "${prefix}".`);
  return rows[0];
}

export async function revokeKey(prefix) {
  const key = await oneByPrefix(prefix);
  await query('UPDATE api_keys SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1', [key.id]);
  return key;
}

export async function setQuota(prefix, quota) {
  if (!Number.isInteger(quota) || quota < 0) throw new Error('Kuota harus bilangan bulat 0 atau lebih.');
  const key = await oneByPrefix(prefix);
  await query('UPDATE api_keys SET daily_quota = $2 WHERE id = $1', [key.id, quota]);
  return key;
}
