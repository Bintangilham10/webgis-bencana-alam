// Mengelola kunci API pengembang (/api/v1). Kunci dibuat pendaftar sendiri lewat
// halaman dokumentasi; di sini pengelola melihat daftarnya, mencabut kunci yang
// disalahgunakan, atau mengubah kuota hariannya. Kunci dipilih dengan awalannya
// (kolom "awalan"), karena kunci aslinya tidak disimpan.
//
// Pakai (di server/):
//   npm run kunci -- daftar
//   npm run kunci -- cabut sigap_AbC123xy
//   npm run kunci -- kuota sigap_AbC123xy 5000
// Di server produksi:
//   docker compose -f deploy/compose.yaml exec api node scripts/kunci-api.js daftar
import { listKeys, revokeKey, setQuota } from '../src/api-keys.js';
import { pool } from '../src/db.js';

const date = (value) => (value ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') : '');

async function daftar() {
  const keys = await listKeys();
  if (!keys.length) return console.log('Belum ada kunci.');
  console.table(
    keys.map((k) => ({
      awalan: k.prefix, nama: k.name, email: k.email, kuota: k.daily_quota, 'hari ini': k.today, '7 hari': k.week,
      dibuat: date(k.created_at), dicabut: date(k.revoked_at), tujuan: k.purpose.length > 60 ? `${k.purpose.slice(0, 59)}…` : k.purpose,
    })),
  );
  console.log(`${keys.length} kunci, ${keys.filter((k) => !k.revoked_at).length} aktif. Waktu dalam UTC.`);
}

const [command, prefix, value] = process.argv.slice(2);
try {
  if (command === 'daftar') await daftar();
  else if (command === 'cabut' && prefix) {
    const key = await revokeKey(prefix);
    console.log(`Kunci ${key.prefix}… milik ${key.name} dicabut.`);
  } else if (command === 'kuota' && prefix && value !== undefined) {
    const key = await setQuota(prefix, Number(value));
    console.log(`Kuota harian kunci ${key.prefix}… milik ${key.name} menjadi ${Number(value)}.`);
  } else {
    console.log('Pakai: npm run kunci -- daftar | cabut <awalan> | kuota <awalan> <jumlah per hari>');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
