import { expect, test } from '@playwright/test';
import { openMap, openTab, saveResult, timeUntilLoaded, watchErrors } from './helpers.js';

// P1 Lapisan dan peta dasar: nyalakan tiap lapisan dan ganti 6 peta dasar.
// Kriteria lulus: tampil ≤ 3 detik; legenda ikut berubah.
const LIMIT_MS = 3_000;

// textContent, karena isi legenda yang terlipat tetap diperbarui walau tidak terlihat.
const legendTitles = (page) => page.locator('.map-legend .legend-block h3').allTextContents();

// Petak PNG 1 × 1 transparan, pengganti petak satelit NASA GIBS.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

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
    // Lapisan dikelompokkan per fitur: tiap tombol fitur dibuka bergantian.
    // Lapisan yang muncul di beberapa fitur (GDACS) cukup diukur sekali.
    const measured = new Set();
    const featureTabs = page.locator('#panel-lapisan .feature-tab');
    expect(await featureTabs.count()).toBeGreaterThan(1);

    for (let f = 0; f < (await featureTabs.count()); f++) {
      const featureTab = featureTabs.nth(f);
      await featureTab.click();
      const panel = page.locator(`#${await featureTab.getAttribute('aria-controls')}`);
      await expect(panel).toBeVisible();

      // Sakelar biasa: lapisan mati dinyalakan lalu dimatikan lagi; lapisan bawaan
      // dimatikan dulu supaya penyalaannya terukur.
      const rows = panel.locator('.switch-row');
      for (let i = 0; i < (await rows.count()); i++) {
        const row = rows.nth(i);
        const label = (await row.locator('.switch-label').innerText()).trim();
        if (measured.has(label)) continue;
        measured.add(label);
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

      // Grup pilihan tunggal (indikasi SIGAP): tiap pilihan menggantikan legenda
      // pilihan sebelumnya.
      const groups = panel.locator('.choice-chips');
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

  // NASA GIBS menolak zoom pecahan (HTTP 400). Leaflet membulatkan zoom petak saat
  // peta bergerak tetapi tidak saat redraw(), dan tampilan awal 1440 × 900 berada di
  // zoom 4,5: petak awan yang digambar ulang karena nada peta dasar berganti dulu
  // diminta di z = 4,5, sehingga lapisannya kosong sampai peta di-zoom.
  test('lapisan satelit digambar ulang di zoom bulat saat peta dasar diganti', async ({ page }) => {
    const errors = watchErrors(page);
    // Petak GIBS dijawab di sini supaya test tidak bergantung pada server NASA; zoom
    // yang diminta dibaca dari alamatnya (…/{z}/{y}/{x}.png).
    const zooms = [];
    await page.route('https://gibs.earthdata.nasa.gov/**', (route) => {
      const zoom = /\/([\d.]+)\/\d+\/\d+\.png/.exec(route.request().url())?.[1];
      if (zoom !== undefined) zooms.push(zoom);
      return route.fulfill({ contentType: 'image/png', body: BLANK_PNG, headers: { 'access-control-allow-origin': '*' } });
    });
    await openMap(page);
    // Prasyarat: peta berada di zoom pecahan. Wadah petak peta dasar yang skalanya
    // bukan 1 berarti zoom peta berbeda dari zoom petaknya.
    const fractionalZoom = await page.evaluate(() =>
      [...document.querySelectorAll('.leaflet-tile-pane .leaflet-tile-container')].some(
        (el) => el.children.length > 0 && Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).a - 1) > 0.01,
      ),
    );
    expect(fractionalZoom, 'tampilan awal tidak lagi di zoom pecahan, jadi test ini tidak menguji redraw di zoom x,5').toBe(true);

    await openTab(page, 'Lapisan');
    await page.locator('#panel-lapisan .feature-tab', { hasText: 'Hujan' }).click();
    const cloudTiles = '.leaflet-warnings-pane canvas.leaflet-tile';
    const cloudRow = page.locator('#panel-lapisan .switch-row:visible', { hasText: 'Citra awan Himawari-9' });
    await timeUntilLoaded(page, () => cloudRow.click());
    await expect.poll(() => page.locator(`${cloudTiles}.leaflet-tile-loaded`).count()).toBeGreaterThan(0);
    // Petak yang ada sekarang ditandai, supaya petak hasil gambar ulang bisa dikenali.
    await page.evaluate((selector) => document.querySelectorAll(selector).forEach((tile) => tile.setAttribute('data-lama', '')), cloudTiles);

    // Nada peta dasar berganti: petak awan digambar ulang di zoom saat itu.
    const before = zooms.length;
    const tone = await page.locator('#map').getAttribute('data-tone');
    await page.locator('[data-tool="basemap"]').click();
    const other = page.locator('#basemap-menu .basemap-option', { hasText: tone === 'dark' ? 'Kanvas terang' : 'Kanvas gelap' });
    await timeUntilLoaded(page, () => other.click());
    await expect(page.locator('#map')).not.toHaveAttribute('data-tone', tone);
    const redrawn = page.locator(`${cloudTiles}.leaflet-tile-loaded:not([data-lama])`);
    await expect.poll(() => redrawn.count()).toBeGreaterThan(0);

    // Zoom peta pecahan dengan zoom petak bulat berarti wadah petaknya berskala
    // (2^±0,5). Skala 1 berarti petaknya dibuat di zoom peta yang pecahan itu.
    // Permintaan ke GIBS tidak bisa jadi ukuran satu-satunya: browser kadang memakai
    // lagi petak beralamat sama dari memorinya tanpa meminta ulang.
    const scales = await redrawn.evaluateAll((tiles) => [
      ...new Set(tiles.map((tile) => new DOMMatrixReadOnly(getComputedStyle(tile.parentElement).transform).a.toFixed(3))),
    ]);
    const requested = [...new Set(zooms.slice(before))];
    saveResult('p1-satelit-zoom', { skala_wadah_petak: scales, zoom_diminta: requested, petak_baru: await redrawn.count(), galat: errors });
    expect(scales, 'petak awan digambar ulang di zoom pecahan').not.toContain('1.000');
    expect(requested.filter((zoom) => !Number.isInteger(Number(zoom)))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
