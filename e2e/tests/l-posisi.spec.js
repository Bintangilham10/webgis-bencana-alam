import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { openMap, outlookBanner, saveResult, visibleMapArea, watchErrors } from './helpers.js';

// Rencana pengujian posisi pengguna (slide 16). Otomatis: L2 izin ditolak, L3 tanpa
// Geolocation atau tanpa HTTPS, L4 waktu klik sampai profil di jaringan seluler,
// L6 posisi di laut atau di luar Indonesia. L1 (akurasi di 5 titik luar ruang) dan
// L5 (perangkat Android, iPhone, laptop) butuh perangkat nyata: lihat docs/pengujian/.

const locateButton = (page) => page.locator('#panel-ikhtisar [data-action="locate"]');
const detailMessage = (page) => page.locator('#detail-view');

// Titik peta untuk koordinat tertentu: perkiraan dari dua bacaan kursor, lalu
// diperbaiki dengan bacaan kursor di titik perkiraan (Mercator tidak linear).
async function pixelFor(page, lat, lon) {
  const read = async (x, y) => {
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
    const [la, lo] = (await page.locator('.readout-geo').textContent()).replace('WGS84 ', '').split(', ').map(Number);
    return { lat: la, lon: lo };
  };
  const area = await visibleMapArea(page);
  const p0 = { x: area.left + 100, y: area.top + 100 };
  const p1 = { x: area.right - 100, y: area.bottom - 100 };
  const a = await read(p0.x, p0.y);
  const b = await read(p1.x, p1.y);
  let x = p0.x + ((lon - a.lon) / (b.lon - a.lon)) * (p1.x - p0.x);
  let y = p0.y + ((lat - a.lat) / (b.lat - a.lat)) * (p1.y - p0.y);
  for (let i = 0; i < 3; i++) {
    const c = await read(x, y);
    x += ((lon - c.lon) / (b.lon - a.lon)) * (p1.x - p0.x);
    y += ((lat - c.lat) / (b.lat - a.lat)) * (p1.y - p0.y);
  }
  // Geser sedikit bila titik itu tertutup penanda gempa/gunung api atau popup.
  return page.evaluate(({ x, y }) => {
    for (let r = 0; r < 60; r += 6) {
      for (let k = 0; k < 8; k++) {
        const px = x + r * Math.cos((k * Math.PI) / 4);
        const py = y + r * Math.sin((k * Math.PI) / 4);
        if (!document.elementFromPoint(px, py)?.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control')) return { x: px, y: py };
      }
    }
    return { x, y };
  }, { x, y });
}

// Konteks browser baru per lokasi: "Lokasi saya" memakai posisi tersimpan sampai
// 60 detik (maximumAge), jadi posisi tiruan baru baru terbaca di konteks baru.
async function pageAt(browser, testInfo, { lat, lon }) {
  const { baseURL, viewport, locale, timezoneId, reducedMotion } = testInfo.project.use;
  const context = await browser.newContext({
    baseURL, viewport, locale, timezoneId, reducedMotion,
    geolocation: { latitude: lat, longitude: lon, accuracy: 20 },
    permissions: ['geolocation'],
  });
  return { context, page: await context.newPage() };
}

test.describe('L posisi pengguna', () => {
  test('L2 izin lokasi ditolak: pesan jelas, pilih titik di peta tetap bisa', async ({ page }) => {
    const errors = watchErrors(page);
    // Tanpa izin geolocation, browser menolak permintaan lokasi.
    await openMap(page);
    await locateButton(page).click();
    await expect(detailMessage(page)).toContainText('Izin lokasi ditolak');
    const message = (await detailMessage(page).locator('.detail-body').textContent()).trim();

    await page.locator('[data-tool="home"]').click();
    await page.locator('[data-tool="pick"]').click();
    // Pedalaman Kalimantan Tengah: jauh dari penanda gempa dan gunung api.
    const { x, y } = await pixelFor(page, -1.6, 113.4);
    await page.mouse.click(x, y);
    await expect(page.locator('#detail-view .detail-place')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#detail-view .detail-body:not([aria-busy])')).toBeVisible({ timeout: 30_000 });
    const place = (await page.locator('#detail-view .detail-place').textContent()).trim();
    saveResult('l2-izin-ditolak', { pesan: message, pilih_titik: place, galat: errors });
    expect(place).toContain('Kalimantan Tengah');
    expect(errors).toEqual([]);
  });

  test('L3 browser tanpa Geolocation: pesan wajar tanpa galat', async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => delete Navigator.prototype.geolocation);
    await openMap(page);
    await locateButton(page).click();
    await expect(detailMessage(page)).toContainText('tidak mendukung penentuan lokasi');
    await page.locator('[data-tool="track"]').click();
    await expect(page.locator('#track-chip')).toContainText('Pantau posisi tidak tersedia');
    await expect(page.locator('#track-chip')).toContainText('tidak mendukung penentuan lokasi');
    saveResult('l3-tanpa-geolocation', {
      lokasi_saya: (await detailMessage(page).locator('.detail-body').textContent()).trim(),
      pantau_posisi: (await page.locator('#track-chip').textContent()).trim(),
      galat: errors,
    });
    expect(errors).toEqual([]);
  });

  test.describe('tanpa HTTPS', () => {
    // Asal http:// selain localhost bukan konteks aman. Build produksi disajikan
    // server kecil di sini (dengan /api diteruskan ke API), lalu dibuka lewat nama
    // sigap.test yang diarahkan Chrome ke 127.0.0.1 (playwright.config.js).
    let server;
    let origin;
    test.beforeAll(async () => {
      const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
      const api = new URL(process.env.SIGAP_API ?? 'http://localhost:3000');
      server = createServer(async (req, res) => {
        if (req.url.startsWith('/api/')) {
          const upstream = httpRequest({ host: api.hostname, port: api.port, path: req.url, method: req.method, headers: { ...req.headers, host: api.host } }, (reply) => {
            res.writeHead(reply.statusCode, reply.headers);
            reply.pipe(res);
          });
          upstream.on('error', () => res.writeHead(502).end());
          req.pipe(upstream);
          return;
        }
        const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
        try {
          const body = await readFile(join(dist, path));
          res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
        } catch {
          res.writeHead(404).end();
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      origin = `http://sigap.test:${server.address().port}`;
    });
    test.afterAll(() => server?.close());

    // Izin lokasi memang tidak bisa diberikan ke asal yang tidak aman.
    test('L3 tanpa HTTPS: pesan wajar tanpa galat', async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(`${origin}/`);
      expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
      await page.locator('[data-action="enter-map"]:visible').first().click();
      await expect(page.locator('#quake-list .list-row, #quake-list .empty-note').first()).toBeAttached();
      await locateButton(page).click();
      await expect(detailMessage(page).locator('.detail-body')).toBeVisible();
      await expect(detailMessage(page).locator('.detail-body')).not.toContainText('Mencari lokasi');
      const locateMessage = (await detailMessage(page).locator('.detail-body').textContent()).trim();
      await page.locator('[data-tool="track"]').click();
      await expect(page.locator('#track-chip')).toContainText('HTTPS');
      saveResult('l3-tanpa-https', {
        lokasi_saya: locateMessage,
        pantau_posisi: (await page.locator('#track-chip').textContent()).trim(),
        galat: errors,
      });
      expect(locateMessage).toMatch(/HTTPS/);
      expect(errors).toEqual([]);
    });
  });

  test('L4 klik "Lokasi saya" sampai profil tampil ≤ 5 detik di jaringan seluler', async ({ browser, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Pembatasan jaringan memakai CDP Chromium');
    const results = [];
    const errors = [];
    // Titik baru (belum ada di cache server 10 menit per sel ±100 m) di beberapa daerah.
    const salt = (Date.now() % 997) / 1e5;
    for (const [name, lat, lon] of [['Bogor', -6.59 - salt, 106.79 + salt], ['Semarang', -7.0 - salt, 110.42 + salt], ['Makassar', -5.15 - salt, 119.43 + salt]]) {
      const { context, page } = await pageAt(browser, testInfo, { lat, lon });
      errors.push(...watchErrors(page));
      await openMap(page);
      // Profil "Slow 4G" Lighthouse: RTT 150 ms, unduh 1,6 Mbps, unggah 750 kbps.
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
      const start = performance.now();
      await locateButton(page).click();
      await expect(page.locator('#detail-view .detail-place')).toBeVisible({ timeout: 40_000 });
      await expect(page.locator('#detail-view .detail-body:not([aria-busy])')).toBeVisible();
      const ms = Math.round(performance.now() - start);
      const failedSources = await page.locator('#detail-view .hazard-list').getByText('Gagal dimuat').count();
      results.push({ lokasi: name, ms, tempat: (await page.locator('#detail-view .detail-place').textContent()).trim(), status: await outlookBanner(page), sumber_inarisk_gagal: failedSources });
      expect.soft(ms, `waktu profil ${name}`).toBeLessThanOrEqual(5_000);
      await context.close();
    }
    saveResult('l4-waktu-seluler', { jaringan: 'Slow 4G (RTT 150 ms, 1,6 Mbps)', hasil: results, galat: errors });
    expect(errors).toEqual([]);
  });

  test('L6 posisi di laut atau di luar Indonesia: pesan wajar, tidak macet', async ({ browser }, testInfo) => {
    const results = [];
    const errors = [];
    for (const [name, lat, lon] of [['Samudra Hindia', -9.5, 105.0], ['Singapura', 1.3521, 103.8198], ['Tokyo', 35.68, 139.69]]) {
      const { context, page } = await pageAt(browser, testInfo, { lat, lon });
      errors.push(...watchErrors(page));
      await openMap(page);
      await locateButton(page).click();
      const body = page.locator('#detail-view .detail-body');
      await expect(body).toBeVisible({ timeout: 30_000 });
      await expect(body).not.toContainText('Mencari lokasi', { timeout: 30_000 });
      await expect(page.locator('#detail-view .detail-body:not([aria-busy])')).toBeVisible({ timeout: 30_000 });
      const place = page.locator('#detail-view .detail-place');
      results.push({
        lokasi: name,
        judul: (await page.locator('#detail-view .detail-title').textContent()).trim(),
        tempat: (await place.count()) ? (await place.textContent()).trim() : '',
        pesan: (await outlookBanner(page)) ?? (await body.textContent()).trim().slice(0, 200),
      });
      if (name === 'Tokyo') {
        // Pantau posisi di luar Indonesia.
        await page.locator('[data-tool="track"]').click();
        await expect(page.locator('#track-chip')).toContainText('di luar wilayah Indonesia');
        results.push({ lokasi: 'Tokyo (pantau posisi)', pesan: (await page.locator('#track-chip').textContent()).trim() });
      }
      await context.close();
    }
    saveResult('l6-laut-luar-indonesia', { hasil: results, galat: errors });
    expect(results[0].tempat).toMatch(/^Perairan/);
    expect(results[1].pesan).toMatch(/Di luar wilayah Indonesia/);
    expect(results[2].judul).not.toBe('Cek risiko gagal');
    expect(results[2].pesan).toMatch(/di luar wilayah Indonesia/);
    expect(errors).toEqual([]);
  });
});
