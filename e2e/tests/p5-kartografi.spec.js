import { expect, test } from '@playwright/test';
import { openMap, saveResult, visibleMapArea, watchErrors } from './helpers.js';

// P5 Kartografi: skala, arah utara, koordinat kursor.
// Kriteria lulus: WGS84, UTM, EPSG:3857 sesuai zona.
//
// Nilai pembanding dihitung sendiri di sini (bukan dengan proj4 yang dipakai
// aplikasi): UTM dengan deret Krüger orde 3 (galat < 1 mm di dalam zona),
// EPSG:3857 dengan rumus Mercator bola, jarak dengan haversine.

const A = 6_378_137;
const F = 1 / 298.257223563;
const K0 = 0.9996;

export function utm(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const n = F / (2 - F);
  const AA = (A / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [n / 2 - (2 * n ** 2) / 3 + (5 * n ** 3) / 16, (13 * n ** 2) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240];
  const e = (2 * Math.sqrt(n)) / (1 + n);
  const phi = (lat * Math.PI) / 180;
  const dLambda = ((lon - ((zone - 1) * 6 - 180 + 3)) * Math.PI) / 180;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan(t / Math.cos(dLambda));
  const eta = Math.atanh(Math.sin(dLambda) / Math.sqrt(1 + t ** 2));
  let easting = eta;
  let northing = xi;
  alpha.forEach((a, i) => {
    const j = 2 * (i + 1);
    easting += a * Math.cos(j * xi) * Math.sinh(j * eta);
    northing += a * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  return {
    zone: `${zone}${lat < 0 ? 'S' : 'N'}`,
    easting: 500_000 + K0 * AA * easting,
    northing: (lat < 0 ? 10_000_000 : 0) + K0 * AA * northing,
  };
}

const webMercator = (lat, lon) => ({
  x: (A * lon * Math.PI) / 180,
  y: A * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
});

function haversineM(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

async function readCursor(page, x, y) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  const geo = await page.locator('.readout-geo').textContent();
  const proj = await page.locator('.readout-proj').textContent();
  const [lat, lon] = geo.replace('WGS84 ', '').split(', ').map(Number);
  const m = proj.match(/UTM (\d+[NS]) (\d+) E (\d+) N · EPSG:3857 (-?\d+), (-?\d+)/);
  return { lat, lon, zone: m[1], easting: Number(m[2]), northing: Number(m[3]), x3857: Number(m[4]), y3857: Number(m[5]) };
}

test.describe('P5 kartografi', () => {
  test('koordinat kursor WGS84, UTM, dan EPSG:3857 sesuai zona di seluruh Indonesia', async ({ page }) => {
    const errors = watchErrors(page);
    await openMap(page);
    await page.locator('[data-tool="home"]').click();
    await page.waitForTimeout(500);
    const area = await visibleMapArea(page);
    const results = [];
    for (const fy of [0.3, 0.7]) {
      for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) {
        const shown = await readCursor(page, area.left + (area.right - area.left) * fx, area.top + (area.bottom - area.top) * fy);
        const expectedUtm = utm(shown.lat, shown.lon);
        const expected3857 = webMercator(shown.lat, shown.lon);
        // WGS84 ditampilkan 5 desimal (±0,6 m), UTM dan EPSG:3857 dibulatkan ke meter.
        const diff = {
          utm_m: Math.hypot(shown.easting - expectedUtm.easting, shown.northing - expectedUtm.northing),
          epsg3857_m: Math.hypot(shown.x3857 - expected3857.x, shown.y3857 - expected3857.y),
        };
        results.push({ wgs84: [shown.lat, shown.lon], zona: shown.zone, zona_pembanding: expectedUtm.zone, ...diff });
        expect.soft(shown.zone, `zona UTM di ${shown.lat}, ${shown.lon}`).toBe(expectedUtm.zone);
        expect.soft(diff.utm_m, `selisih UTM di ${shown.lat}, ${shown.lon}`).toBeLessThan(2);
        expect.soft(diff.epsg3857_m, `selisih EPSG:3857 di ${shown.lat}, ${shown.lon}`).toBeLessThan(2);
      }
    }
    const zones = [...new Set(results.map((r) => r.zona))].sort();
    saveResult('p5-koordinat', { zona_teruji: zones, hasil: results, galat: errors });
    // Titik sampel mencakup belahan utara dan selatan serta beberapa zona UTM.
    expect(zones.some((z) => z.endsWith('N')) && zones.some((z) => z.endsWith('S'))).toBe(true);
    expect(zones.length).toBeGreaterThanOrEqual(4);
    expect(errors).toEqual([]);
  });

  test('skala batang dan angka skala sesuai jarak di lapangan; utara di atas', async ({ page }) => {
    const errors = watchErrors(page);
    await openMap(page);
    const results = [];
    // Dua tingkat zoom: seluruh Indonesia dan sebuah kab/kota.
    for (const view of ['indonesia', 'kabkota']) {
      if (view === 'indonesia') await page.locator('[data-tool="home"]').click();
      else {
        await page.locator('#search input').fill('Kota Bandung');
        await page.locator('#search input').press('Enter');
        await page.locator('.search-result', { hasText: 'Kota Bandung' }).first().click();
        await page.locator('#detail-view [data-action="close"]').click();
      }
      await page.waitForTimeout(500);
      const area = await visibleMapArea(page);
      const y = (area.top + area.bottom) / 2;
      const x0 = area.left + 100;
      const x1 = x0 + 400;
      const a = await readCursor(page, x0, y);
      const b = await readCursor(page, x1, y);
      const groundPerPx = haversineM(a, b) / (x1 - x0);

      const bar = page.locator('.leaflet-control-scale-line');
      const [value, unit] = (await bar.textContent()).trim().split(/\s+/);
      const barMeters = Number(value) * (unit === 'km' ? 1000 : 1);
      const barPx = (await bar.boundingBox()).width;
      const barPerPx = barMeters / barPx;

      // Angka skala 1:n di kotak koordinat = resolusi (m/piksel) / 0,28 mm.
      await page.mouse.move(area.left + 20, area.top + 20);
      const scaleText = await page.locator('.readout-scale').textContent();
      const denominator = Number(scaleText.match(/1:([\d.]+)/)[1].replace(/\./g, ''));
      const readoutPerPx = denominator * 0.00028;

      // Utara di atas: lintang bertambah ke arah atas layar.
      const top = await readCursor(page, (area.left + area.right) / 2, area.top + 40);
      const bottom = await readCursor(page, (area.left + area.right) / 2, area.bottom - 40);

      results.push({
        tampilan: view,
        meter_per_piksel_lapangan: groundPerPx,
        skala_batang: `${value} ${unit} = ${Math.round(barPx)} px`,
        meter_per_piksel_skala_batang: barPerPx,
        angka_skala: scaleText,
        meter_per_piksel_angka_skala: readoutPerPx,
        utara_di_atas: top.lat > bottom.lat,
      });
      // Skala batang Leaflet dihitung pada bola, jarak lapangan pada bola juga: ±2%.
      expect.soft(Math.abs(barPerPx / groundPerPx - 1), `skala batang (${view})`).toBeLessThan(0.02);
      // Angka skala dibulatkan ke 2 angka penting (±5%).
      expect.soft(Math.abs(readoutPerPx / groundPerPx - 1), `angka skala (${view})`).toBeLessThan(0.06);
      expect.soft(top.lat).toBeGreaterThan(bottom.lat);
    }
    await expect(page.locator('.north-arrow')).toBeVisible();
    await expect(page.locator('.north-arrow')).toHaveAttribute('title', 'Arah utara');
    saveResult('p5-skala', { hasil: results, galat: errors });
    expect(errors).toEqual([]);
  });
});
