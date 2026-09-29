import { pool } from '../src/db.js';
import { runIndikasi } from '../src/jobs/indikasi.js';
import { JOBS, runJob } from '../src/jobs/scheduler.js';

// Menjalankan indikasi SIGAP sekali (mis. sebelum demo) tanpa menunggu jadwal
// 12 jam. Hasilnya dicatat di sync_logs seperti run terjadwal, jadi penjadwal
// server tidak mengulanginya dalam 12 jam berikutnya. Satu run memakai ±3.200
// panggilan kuota Open-Meteo, jadi jangan dijalankan berkali-kali dalam sehari.
const job = JOBS.find((j) => j.source === 'indikasi-sigap');
const onProgress = ({ done, total, failed }) =>
  console.log(`titik hujan ${done}/${total}${failed ? ` (${failed} gagal)` : ''}`);

try {
  const { ok, items, message } = await runJob({ ...job, run: () => runIndikasi({ onProgress }) });
  if (ok) console.log(`Indikasi SIGAP tersimpan untuk ${items} kab/kota${message ? `; ${message}` : ''}`);
  else console.error(`Indikasi SIGAP gagal: ${message}`);
  process.exitCode = ok ? 0 : 1;
} finally {
  await pool.end();
}
