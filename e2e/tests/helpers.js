import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

// Hasil ukur tiap skenario disimpan sebagai JSON untuk laporan (docs/pengujian/).
const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'hasil');

export function saveResult(name, data) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${name}.json`), `${JSON.stringify({ diukur: new Date().toISOString(), ...data }, null, 2)}\n`);
}

// Galat JavaScript halaman. Gagal memuat sumber luar (mis. petak peta 404) dicatat
// browser sebagai "Failed to load resource" dan dipisah, karena bukan cacat aplikasi.
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message} @ ${error.stack?.split('\n')[1]?.trim() ?? ''}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(`console: ${message.text()}`);
  });
  return errors;
}

// Dari halaman depan ke peta, lalu tunggu daftar gempa pertama tampil.
export async function openMap(page) {
  await page.goto('/');
  await page.locator('[data-action="enter-map"]:visible').first().click();
  await expect(page.locator('#landing')).toBeHidden();
  await expect(page.locator('#quake-list .list-row, #quake-list .empty-note').first()).toBeAttached();
}

export async function openTab(page, name) {
  await page.getByRole('tab', { name }).click();
}

// Lama sebuah aksi sampai semua permintaan jaringan yang dipicunya selesai dan
// tidak ada permintaan baru selama `quietMs`. Aliran notifikasi (SSE) diabaikan.
export async function timeUntilLoaded(page, action, { quietMs = 600, timeoutMs = 30_000, ignore = /\/api\/stream/ } = {}) {
  const pending = new Set();
  const failed = [];
  let requests = 0;
  let lastChange = 0;
  let firstDone = null;
  const onRequest = (request) => {
    if (ignore.test(request.url())) return;
    pending.add(request);
    requests++;
    lastChange = performance.now();
  };
  const onFinished = (request) => {
    if (!pending.delete(request)) return;
    lastChange = performance.now();
    firstDone ??= lastChange;
  };
  const onFailed = (request) => {
    if (!pending.delete(request)) return;
    lastChange = performance.now();
    const reason = request.failure()?.errorText ?? '';
    // Leaflet membatalkan petak yang sudah tidak terlihat; itu bukan kegagalan.
    if (!/ABORTED|NS_BINDING_ABORTED|cancelled/i.test(reason)) failed.push(`${reason} ${request.url()}`);
  };
  page.on('request', onRequest);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);
  try {
    const start = performance.now();
    lastChange = start;
    await action();
    for (;;) {
      const now = performance.now();
      if (!pending.size && now - lastChange >= quietMs) break;
      if (now - start > timeoutMs) break;
      await page.waitForTimeout(50);
    }
    const end = pending.size ? performance.now() : lastChange;
    // ms = semua permintaan selesai; first_ms = respons pertama (mis. petak pertama tampil).
    return { ms: Math.round(end - start), first_ms: firstDone === null ? null : Math.round(firstDone - start), requests, unfinished: pending.size, failed };
  } finally {
    page.off('request', onRequest);
    page.off('requestfinished', onFinished);
    page.off('requestfailed', onFailed);
  }
}

// Bagian peta yang tidak tertutup panel samping (desktop) atau lembar bawah (HP).
export async function visibleMapArea(page) {
  const view = page.viewportSize();
  const sidebar = await page.locator('#sidebar').boundingBox();
  const mobile = view.width < 768;
  return {
    left: !mobile && sidebar ? sidebar.x + sidebar.width : 0,
    top: 60,
    right: view.width,
    bottom: mobile && sidebar ? sidebar.y : view.height,
  };
}

export const inside = (box, area) =>
  box && box.x >= area.left - 1 && box.x + box.width <= area.right + 1 && box.y >= area.top - 1 && box.y + box.height <= area.bottom + 1;

// Cek risiko lewat kotak pencarian: hasil yang namanya cocok dipilih, lalu waktu
// dari klik hasil sampai profil selesai dirender diukur.
export async function checkRiskBySearch(page, { query, pick = query, detailMatch }) {
  const search = page.locator('#search input');
  await search.fill(query);
  await search.press('Enter');
  const results = page.locator('.search-result');
  await expect(results.first()).toBeVisible();
  let target = results.filter({ hasText: pick });
  if (detailMatch) target = target.filter({ hasText: detailMatch });
  const start = performance.now();
  await target.first().click();
  await expect(page.locator('#detail-view .detail-body:not([aria-busy])')).toBeVisible({ timeout: 30_000 });
  return Math.round(performance.now() - start);
}

// Judul banner indikasi SIGAP di kartu cek risiko (bukan banner peringatan BMKG).
export async function outlookBanner(page) {
  const titles = await page.locator('#detail-view .outlook-title').allInnerTexts();
  return titles.find((t) => /^(Normal|Waspada|Siaga|Awas|Di luar wilayah|Indikasi)/.test(t)) ?? null;
}
