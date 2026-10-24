import { expect, test } from '@playwright/test';
import { checkRiskBySearch, openMap, outlookBanner, saveResult, watchErrors } from './helpers.js';

// P4 Cek risiko lokasi: 10 lokasi, mis. Lembang, Garut, Padang.
// Kriteria lulus: profil ≤ 5 detik; status sama dengan kab/kota.
const LIMIT_MS = 5_000;

// Campuran tempat dari Nominatim (Lembang, Parangtritis) dan kab/kota dari basis data,
// dari barat sampai timur Indonesia.
const LOCATIONS = [
  { query: 'Lembang', detail: 'Bandung Barat', kabkota: 'Kabupaten Bandung Barat' },
  { query: 'Pantai Parangtritis', kabkota: 'Kabupaten Bantul' },
  { query: 'Kabupaten Garut', kabkota: 'Kabupaten Garut' },
  { query: 'Kota Padang', kabkota: 'Kota Padang' },
  { query: 'Kota Banda Aceh', kabkota: 'Kota Banda Aceh' },
  { query: 'Kabupaten Sleman', kabkota: 'Kabupaten Sleman' },
  { query: 'Kabupaten Karangasem', kabkota: 'Kabupaten Karangasem' },
  { query: 'Kota Palu', kabkota: 'Kota Palu' },
  { query: 'Kota Ambon', kabkota: 'Kota Ambon' },
  { query: 'Kota Jayapura', kabkota: 'Kota Jayapura' },
];

test.describe('P4 cek risiko lokasi', () => {
  test('10 lokasi: profil ≤ 5 detik dan kab/kota sesuai', async ({ page }) => {
    const errors = watchErrors(page);
    await openMap(page);
    const results = [];
    for (const location of LOCATIONS) {
      const ms = await checkRiskBySearch(page, { query: location.query, pick: location.query.replace(/^(Kota|Kabupaten) /, ''), detailMatch: location.detail });
      const title = (await page.locator('#detail-view .detail-title').textContent()).trim();
      const place = (await page.locator('#detail-view .detail-place').textContent()).trim();
      // Hasil kab/kota: judul = nama kab/kota, baris tempat = provinsi. Tempat lain:
      // baris tempat = "kab/kota, provinsi".
      const shown = title === location.kabkota ? title : place.split(',')[0].trim();
      const failedSources = await page.locator('#detail-view .hazard-list').getByText('Gagal dimuat').count();
      results.push({ lokasi: location.query, ms, kabkota: shown, status: await outlookBanner(page), sumber_gagal: failedSources });
      expect.soft(shown, `kab/kota untuk ${location.query}`).toBe(location.kabkota);
      expect.soft(ms, `waktu profil ${location.query}`).toBeLessThanOrEqual(LIMIT_MS);
      await page.locator('#detail-view [data-action="close"]').click();
    }
    saveResult('p4-cek-risiko', { batas_ms: LIMIT_MS, hasil: results, galat: errors });
    expect(errors).toEqual([]);
  });

  test('titik pantau terparah: status cek risiko dibandingkan dengan indikasi kab/kota', async ({ page, request }) => {
    const errors = watchErrors(page);
    const outlook = await (await request.get('/api/outlook')).json();
    const LABELS = ['Normal', 'Waspada', 'Siaga', 'Awas'];
    await openMap(page);
    const rows = page.locator('#outlook-list [data-outlook]');
    const count = Math.min(await rows.count(), 10);
    test.skip(count === 0, 'Tidak ada kab/kota Waspada ke atas pada run indikasi ini');
    const results = [];
    for (let i = 0; i < count; i++) {
      const kode = await rows.nth(i).getAttribute('data-outlook');
      const region = outlook.regions.find((r) => r.kode === kode);
      const regionLevel = LABELS[Math.max(...Object.values(region.hazards).map((h) => h.level))];
      await rows.nth(i).click();
      await page.locator('.leaflet-popup [data-action="outlook-check"]').click();
      await expect(page.locator('#detail-view .detail-body:not([aria-busy])')).toBeVisible({ timeout: 30_000 });
      const banner = await outlookBanner(page);
      const pointLevel = LABELS.find((label) => banner?.startsWith(label)) ?? null;
      // null = tidak dapat dibandingkan (kelas zona bahaya InaRISK gagal dimuat).
      results.push({ kabkota: region.nama, indikasi_kabkota: regionLevel, cek_titik_pantau: banner, sama: pointLevel === null ? null : pointLevel === regionLevel });
      expect(banner, 'banner indikasi tampil').not.toBeNull();
      await page.locator('#detail-view [data-action="close"]').click();
      await page.getByRole('tab', { name: 'Ikhtisar' }).click();
    }
    // Indikasi kab/kota memakai run 12 jam terakhir, sedangkan cek risiko memakai
    // prakiraan terbaru (tertulis di popup), dan kelas zona bahayanya dari raster
    // tersimpan, bukan identify InaRISK; perbedaan dicatat, bukan digagalkan.
    saveResult('p4-titik-pantau', { run_indikasi: outlook.run.finished_at, hasil: results, galat: errors });
    expect(errors).toEqual([]);
  });
});
