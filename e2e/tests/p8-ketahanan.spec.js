import { expect, test } from '@playwright/test';
import { openMap, openTab, saveResult } from './helpers.js';

// P8 Ketahanan sumber: simulasikan galat 5xx dan timeout sumber.
// Kriteria lulus: data terakhir tetap tampil; tercatat di sync_logs.
// Sisi server (sync_logs, data lama tetap dilayani API) diuji di
// server/test/api.test.js, blok "ketahanan sumber (P8)". Di sini sisi browser.

test.describe('P8 ketahanan sumber (browser)', () => {
  test('API gempa gagal (HTTP 503): penanda dan daftar terakhir tetap tampil, lalu pulih sendiri', async ({ page }) => {
    test.setTimeout(240_000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await openMap(page);
    const markers = page.locator('.leaflet-quakes-pane .quake-icon');
    const rows = page.locator('#quake-list [data-quake]');
    await expect(rows.first()).toBeVisible();
    const before = { penanda: await markers.count(), daftar: await rows.count() };

    // Pembaruan berikutnya (tiap 60 detik) mendapat HTTP 503.
    let failed = 0;
    await page.route(/\/api\/earthquakes\?days=7/, (route) => {
      failed++;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"simulasi gangguan"}' });
    });
    const freshness = page.locator('#freshness');
    await expect(freshness).toHaveAttribute('data-state', 'error', { timeout: 75_000 });
    await expect(freshness).toContainText('Sebagian data gagal dimuat');
    expect(await freshness.getAttribute('title')).toContain('Gempa: gagal dimuat');
    const during = { penanda: await markers.count(), daftar: await rows.count() };
    expect(during).toEqual(before);

    // Sumber pulih: pembaruan berikutnya berhasil tanpa memuat ulang halaman.
    await page.unroute(/\/api\/earthquakes\?days=7/);
    await expect(freshness).not.toHaveAttribute('data-state', 'error', { timeout: 75_000 });
    saveResult('p8-browser-api-gagal', { sebelum: before, saat_gagal: during, permintaan_gagal: failed, galat_halaman: pageErrors });
    expect(pageErrors).toEqual([]);
  });

  test('peta rawan InaRISK yang gagal dimuat setelah diganti tidak menimbulkan galat', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // Gambar peta rawan menggantung 2 detik lalu gagal, seperti server BNPB yang lambat.
    await page.route(/gis\.bnpb\.go\.id\/.*\/(exportImage|export)\b/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.abort('failed');
    });
    await openMap(page);
    await openTab(page, 'Lapisan');
    const hazards = page.locator('#panel-lapisan .choice-chips[aria-label="Peta rawan bencana"] .choice');
    await hazards.filter({ hasText: 'Banjir' }).click();
    await page.waitForTimeout(400);
    await hazards.filter({ hasText: 'Tanah longsor' }).click();
    await page.waitForTimeout(400);
    await hazards.filter({ hasText: 'Tidak ada' }).click();
    await page.waitForTimeout(3_500);
    const leftovers = await page.locator('.leaflet-hazard-pane img').count();
    saveResult('p8-browser-peta-rawan', { gambar_tersisa: leftovers, galat_halaman: pageErrors });
    expect(pageErrors).toEqual([]);
    expect(leftovers).toBe(0);
  });
});
