import { expect, test } from '@playwright/test';
import { openMap, openTab, saveResult, timeUntilLoaded, watchErrors } from './helpers.js';

// P1 Lapisan dan peta dasar: nyalakan tiap lapisan dan ganti 6 peta dasar.
// Kriteria lulus: tampil ≤ 3 detik; legenda ikut berubah.
const LIMIT_MS = 3_000;

// textContent, karena isi legenda yang terlipat tetap diperbarui walau tidak terlihat.
const legendTitles = (page) => page.locator('.map-legend .legend-block h3').allTextContents();

test.describe('P1 lapisan dan peta dasar', () => {
  test('lapisan bawaan termuat saat peta dibuka', async ({ page }) => {
    const errors = watchErrors(page);
    await openMap(page);
    await expect(page.locator('#quake-list .list-row').first()).toBeVisible();
    // Resource Timing: kapan data tiap lapisan bawaan selesai diterima, dihitung dari awal navigasi.
    const timings = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e) => /\/api\/(earthquakes|volcanoes|cap|outlook|wilayah|faults|rain-warnings)|plates/.test(e.name))
        .map((e) => ({ url: new URL(e.name).pathname + new URL(e.name).search, selesai_ms: Math.round(e.responseEnd), durasi_ms: Math.round(e.duration) })),
    );
    saveResult('p1-lapisan-bawaan', { timings, galat: errors });
    expect(timings.length).toBeGreaterThan(4);
    expect(errors).toEqual([]);
  });

  test('setiap lapisan tampil ≤ 3 detik dan legenda ikut berubah', async ({ page }) => {
    const errors = watchErrors(page);
    await openMap(page);
    await openTab(page, 'Lapisan');
    const results = [];

    // Sakelar biasa: lapisan mati dinyalakan lalu dimatikan lagi; lapisan bawaan
    // dimatikan dulu supaya penyalaannya terukur.
    const rows = page.locator('#panel-lapisan .switch-row');
    for (let i = 0; i < (await rows.count()); i++) {
      const row = rows.nth(i);
      const label = (await row.locator('.switch-label').innerText()).trim();
      const input = row.locator('input.switch');
      const wasOn = await input.isChecked();
      if (wasOn) {
        await row.click();
        await expect(input).not.toBeChecked();
      }
      const before = await legendTitles(page);
      const timing = await timeUntilLoaded(page, () => row.click());
      await expect(input).toBeChecked();
      const added = (await legendTitles(page)).filter((t) => !before.includes(t));
      if (!wasOn) {
        await row.click();
        await expect.poll(() => legendTitles(page)).toEqual(before);
      }
      results.push({ lapisan: label, bawaan: wasOn, ...timing, legenda: added });
      expect.soft(added, `legenda untuk ${label}`).toHaveLength(1);
      expect.soft(timing.ms, `waktu tampil ${label}`).toBeLessThanOrEqual(LIMIT_MS);
    }

    // Grup pilihan tunggal (indikasi SIGAP, peta rawan): tiap pilihan menggantikan
    // legenda pilihan sebelumnya.
    const groups = page.locator('#panel-lapisan .choice-chips');
    for (let g = 0; g < (await groups.count()); g++) {
      const group = groups.nth(g);
      const groupName = await group.getAttribute('aria-label');
      const choices = group.locator('.choice');
      const initial = await group.locator('input:checked').getAttribute('value');
      // Mulai dari "Tidak ada" supaya pilihan bawaan juga terukur saat dipilih.
      await choices.nth(0).click();
      for (let c = 1; c < (await choices.count()); c++) {
        const choice = choices.nth(c);
        const label = (await choice.innerText()).trim();
        const before = await legendTitles(page);
        const timing = await timeUntilLoaded(page, () => choice.click());
        const after = await legendTitles(page);
        const added = after.filter((t) => !before.includes(t));
        results.push({ lapisan: `${groupName}: ${label}`, ...timing, legenda: added });
        expect.soft(added, `legenda untuk ${groupName}: ${label}`).toHaveLength(1);
        expect.soft(timing.ms, `waktu tampil ${groupName}: ${label}`).toBeLessThanOrEqual(LIMIT_MS);
      }
      await choices.nth(Number(initial)).click();
    }

    saveResult('p1-lapisan', { batas_ms: LIMIT_MS, hasil: results, galat: errors });
    expect(errors).toEqual([]);
  });

  test('enam peta dasar berganti ≤ 3 detik', async ({ page }) => {
    const errors = watchErrors(page);
    await openMap(page);
    const menuButton = page.locator('[data-tool="basemap"]');
    await menuButton.click();
    const options = page.locator('#basemap-menu .basemap-option');
    await expect(options).toHaveCount(6);
    const results = [];
    // Pilihan terakhir dulu supaya peta dasar bawaan juga ikut terukur saat dipilih kembali.
    const order = [1, 2, 3, 4, 5, 0];
    for (const index of order) {
      const option = options.nth(index);
      const name = (await option.locator('span').innerText()).trim();
      if (!(await page.locator('#basemap-menu').isVisible())) await menuButton.click();
      const timing = await timeUntilLoaded(page, () => option.click());
      await expect(option.locator('input')).toBeChecked();
      const loadedTiles = await page.locator('.leaflet-tile-pane img.leaflet-tile-loaded').count();
      results.push({ peta_dasar: name, ...timing, petak_termuat: loadedTiles });
      expect.soft(loadedTiles, `petak ${name}`).toBeGreaterThan(0);
      expect.soft(timing.ms, `waktu ganti ke ${name}`).toBeLessThanOrEqual(LIMIT_MS);
    }
    saveResult('p1-peta-dasar', { batas_ms: LIMIT_MS, hasil: results, galat: errors });
    expect(errors).toEqual([]);
  });
});
