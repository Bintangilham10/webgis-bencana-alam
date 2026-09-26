import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// .env di root repo bersifat opsional. Variabel yang sudah ada di environment
// (mis. di CI) tidak ditimpa oleh isi file.
const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://sigap:sigap@localhost:5433/sigap',
  schedulerEnabled: process.env.SCHEDULER !== 'off',
};
