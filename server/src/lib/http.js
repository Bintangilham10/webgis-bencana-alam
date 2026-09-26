// Sengaja terpisah dari recorder/: recorder berjalan sendiri di GitHub Actions
// dan tidak boleh ikut rusak karena perubahan di server.
// BMKG menolak User-Agent yang terlalu polos, jadi identitas selalu dikirim.
const USER_AGENT = 'SIGAP-Bencana/0.1 (WebGIS peringatan dini, riset akademik)';

export class HttpError extends Error {
  constructor(url, status) {
    super(`HTTP ${status} dari ${url}`);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRetryable = (err) => !(err instanceof HttpError) || err.status === 429 || err.status >= 500;

export async function fetchText(url, { timeoutMs = 20_000, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new HttpError(url, res.status);
      return await res.text();
    } catch (err) {
      if (attempt < retries && isRetryable(err)) {
        await sleep(1_000 * 2 ** attempt);
        continue;
      }
      if (err instanceof HttpError) throw err;
      throw new Error(`Gagal mengambil ${url}: ${err.cause?.message ?? err.message}`, { cause: err });
    }
  }
}

export async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}
