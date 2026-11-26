import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vapidProblem } from './lib/web-push.js';

// .env di root repo bersifat opsional. Variabel yang sudah ada di environment
// (mis. di CI) tidak ditimpa oleh isi file.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Kunci VAPID untuk Web Push (buat dengan `npm run kunci:push`). Tanpa kunci, push
// tidak aktif dan sisanya berjalan seperti biasa; kunci yang salah bentuk dianggap
// tidak ada, dengan peringatan.
function readVapid(env) {
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
  if (!vapid.publicKey && !vapid.privateKey) return null;
  const problem = vapidProblem(vapid);
  if (problem) console.warn(`Notifikasi push dimatikan: ${problem}.`);
  return problem ? null : vapid;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://sigap:sigap@localhost:5433/sigap',
  schedulerEnabled: process.env.SCHEDULER !== 'off',
  vapid: readVapid(process.env),
};
