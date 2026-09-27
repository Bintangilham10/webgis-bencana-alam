// BMKG menolak User-Agent yang terlalu polos (mis. "Mozilla/5.0" → 403),
// jadi perekam selalu mengirim identitas yang jelas.
const USER_AGENT =
  process.env.RECORDER_USER_AGENT ?? 'SIGAP-Recorder/0.1 (arsip data bencana terbuka untuk riset akademik)';

export class HttpError extends Error {
  constructor(url, status) {
    super(`HTTP ${status} dari ${url}`);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 4xx selain 429 tidak akan sembuh dengan mencoba ulang.
const isRetryable = (err) => !(err instanceof HttpError) || err.status === 429 || err.status >= 500;

async function request(url, init, { timeoutMs = 20_000, retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new HttpError(url, res.status);
      return await res.text();
    } catch (err) {
      if (attempt < retries && isRetryable(err)) {
        await sleep(2_000 * 2 ** attempt);
        continue;
      }
      if (err instanceof HttpError) throw err;
      throw new Error(`Gagal mengambil ${url}: ${err.cause?.message ?? err.message}`, { cause: err });
    }
  }
}

export const fetchText = (url, options) => request(url, {}, options);

export async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}

// Formulir POST (application/x-www-form-urlencoded), mis. daftar wilayah CEWS BMKG.
export const postForm = (url, fields, options) => request(url, { method: 'POST', body: new URLSearchParams(fields) }, options);

export const http = { fetchText, fetchJson, postForm };
