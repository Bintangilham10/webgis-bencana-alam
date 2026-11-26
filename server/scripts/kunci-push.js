// Membuat pasangan kunci VAPID untuk Web Push dan mencetaknya sebagai baris .env.
//   npm run kunci:push -- https://alamat-situs
// Kunci dibuat SEKALI per server. Mengganti kunci membuat semua langganan push yang
// sudah ada tidak berlaku: tiap pengguna harus mematikan lalu menyalakan push lagi.
// Kunci privat adalah rahasia server; jangan dikomit.
import { generateVapidKeys, vapidProblem } from '../src/lib/web-push.js';

const subject = process.argv[2];
const keys = { ...generateVapidKeys(), subject };
const problem = vapidProblem(keys);
if (problem) {
  console.error(`${problem}.\nPakai: npm run kunci:push -- https://alamat-situs (atau mailto:alamat@contoh.id)`);
  process.exitCode = 1;
} else {
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=${keys.subject}`);
}
