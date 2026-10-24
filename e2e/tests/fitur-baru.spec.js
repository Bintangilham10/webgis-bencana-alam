import { expect, test } from '@playwright/test';
import { openMap, saveResult, watchErrors } from './helpers.js';

// Fitur "Berikutnya" di slide Tugas 1 yang kini sudah ada: peringatan CAP BMKG per
// kab/kota, notifikasi (SSE), tempat evakuasi OpenStreetMap, rute aman, dan
// pelacakan posisi (watchPosition).

test.describe('fitur peringatan, notifikasi, evakuasi, dan rute', () => {
  test('peringatan dini cuaca BMKG (CAP): daftar Ikhtisar, poligon berarsir, popup', async ({ page, request }) => {
    const errors = watchErrors(page);
    const cap = await (await request.get('/api/cap')).json();
    test.skip(!cap.features.length, 'Tidak ada peringatan CAP BMKG yang sedang berlaku saat uji');
    await openMap(page);
    const rows = page.locator('#cap-alerts [data-cap]');
    await expect(rows.first()).toBeVisible();
    // Poligon diarsir dengan pola SVG, bukan isian warna polos.
    await expect(page.locator('.leaflet-warnings-pane path[fill^="url(#cap-hatch"]').first()).toBeAttached();
    const identifier = await rows.first().getAttribute('data-cap');
    const alert = cap.features.find((f) => f.properties.identifier === identifier).properties;
    await rows.first().click();
    const popup = page.locator('.leaflet-popup-content');
    await expect(popup.locator('h3')).toHaveText(alert.event);
    await expect(popup).toContainText('Peringatan dini cuaca BMKG');
    await expect(popup).toContainText('Berlaku');
    saveResult('fitur-cap', { berlaku: cap.features.length, dipilih: { event: alert.event, wilayah: alert.wilayah.map((w) => w.nama) }, galat: errors });
    expect(errors).toEqual([]);
  });

  test('notifikasi: tersambung lewat SSE, simulasi memunculkan toast dan badge', async ({ page }) => {
    const errors = watchErrors(page);
    await openMap(page);
    await page.locator('#notif-toggle').click();
    const panel = page.locator('#notif-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Tersambung', { timeout: 15_000 });
    await panel.locator('[data-action="simulate"]').click();
    await expect(panel).toBeHidden();
    const toast = page.locator('#toasts .toast').first();
    await expect(toast).toBeVisible();
    // Teks "Simulasi" ditulis kapital oleh CSS.
    await expect(toast.locator('.sim-badge')).toHaveText('Simulasi');
    await expect(page.locator('#notif-toggle .notif-badge')).toBeVisible();
    saveResult('fitur-notifikasi', { toast: (await toast.textContent()).replace(/\s+/g, ' ').trim(), galat: errors });
    expect(errors).toEqual([]);
  });

  test('evakuasi, rute aman, dan pantau posisi dari "Lokasi saya"', async ({ browser }, testInfo) => {
    const { baseURL, viewport, locale, timezoneId, reducedMotion } = testInfo.project.use;
    // Kampung Melayu, Jakarta Timur: dekat Ciliwung, banyak titik evakuasi OSM.
    const context = await browser.newContext({
      baseURL, viewport, locale, timezoneId, reducedMotion,
      geolocation: { latitude: -6.2236, longitude: 106.8656, accuracy: 15 },
      permissions: ['geolocation'],
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    await openMap(page);
    await page.locator('#panel-ikhtisar [data-action="locate"]').click();
    const sites = page.locator('[data-evacuation] .facility-row');
    await expect(sites.first()).toBeVisible({ timeout: 45_000 });
    const list = await sites.evaluateAll((rows) =>
      rows.map((row) => ({
        nama: row.querySelector('.nearby-title').textContent.trim(),
        jenis: row.querySelector('.nearby-meta').firstChild.textContent.trim(),
        zona_tinggi: row.querySelector('.class-pill')?.textContent.trim() ?? null,
      })),
    );

    // Rute ke tempat evakuasi pertama yang tidak berada di zona tinggi.
    const target = list.find((s) => s.jenis === 'Tempat evakuasi' && !s.zona_tinggi) ?? list[0];
    await page.getByRole('button', { name: `Rute aman ke ${target.nama}` }).first().click();
    const route = page.locator('[data-route]');
    await expect(route.locator('.route-list')).toBeVisible({ timeout: 45_000 });
    await expect(route.locator('.route-target')).toContainText(target.nama);
    const summary = (await route.locator('.route-row').first().textContent()).replace(/\s+/g, ' ').trim();
    await expect(page.locator('.leaflet-analysis-pane path').first()).toBeAttached();

    // Pantau posisi: di titik asal sisa jarak tampil; ±450 m menjauh = keluar rute.
    await route.locator('[data-action="track"]').click();
    const chip = page.locator('#track-chip');
    await expect(chip).toContainText(/Sisa .* ke tujuan|zona bahaya tinggi/, { timeout: 15_000 });
    const onRoute = (await chip.textContent()).trim();
    await context.setGeolocation({ latitude: -6.2205, longitude: 106.8625, accuracy: 15 });
    await expect(chip).toContainText('Di luar rute aman', { timeout: 15_000 });
    const offRoute = (await chip.textContent()).trim();
    await expect(page.locator('[data-tool="track"]')).toHaveAttribute('aria-pressed', 'true');

    saveResult('fitur-evakuasi-rute', { titik_evakuasi: list, tujuan: target.nama, rute: summary, chip_di_rute: onRoute, chip_keluar_rute: offRoute, galat: errors });
    expect(errors).toEqual([]);
    await context.close();
  });
});
