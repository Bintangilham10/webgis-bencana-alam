import { expect, test } from '@playwright/test';
import { inside, openMap, saveResult, visibleMapArea, watchErrors } from './helpers.js';

// P2 Popup dan interaksi: klik gempa, gunung api, kab/kota; klik dari daftar.
// Kriteria lulus: popup benar (isinya sama dengan data API); peta terbang ke titik
// (penanda dan popupnya berada di bagian peta yang tidak tertutup panel).

const decimal = (value) => String(Math.round(value * 10) / 10).replace('.', ',');
const popup = (page) => page.locator('.leaflet-popup-content');

// Judul popup dibaca setelah teksnya tampil (isi popup baru dirender sesaat setelah dibuka).
async function popupTitle(page) {
  const title = popup(page).locator('h3');
  await expect(title).toHaveText(/\S/);
  return (await title.textContent()).trim();
}

// Klik penanda ke-n yang titik tengahnya tidak tertutup penanda lain atau panel,
// seperti klik pengguna.
async function clickUncoveredMarker(page, selector, nth = 0) {
  const indexes = await page.evaluate((sel) => {
    const markers = [...document.querySelectorAll(sel)];
    return markers
      .map((m, i) => {
        const r = m.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.width > 0 && hit && m.contains(hit) ? i : -1;
      })
      .filter((i) => i >= 0);
  }, selector);
  expect(indexes.length, `ada ${nth + 1} penanda ${selector} yang tidak tertutup`).toBeGreaterThan(nth);
  await page.locator(selector).nth(indexes[nth]).click();
}

async function closePopup(page) {
  await page.keyboard.press('Escape');
  await page.locator('.leaflet-popup-close-button').click({ timeout: 2_000 }).catch(() => {});
  await expect(popup(page)).toHaveCount(0);
}

test.describe('P2 popup dan interaksi', () => {
  test('gempa dari daftar Ikhtisar dan dari penanda di peta', async ({ page, request }) => {
    const errors = watchErrors(page);
    const { features } = await (await request.get('/api/earthquakes?days=7')).json();
    const byId = new Map(features.map((f) => [f.properties.id, f.properties]));
    await openMap(page);

    // Dari daftar: popup gempa yang dipilih, dan peta terbang ke titiknya.
    const row = page.locator('#quake-list [data-quake]').first();
    const id = await row.getAttribute('data-quake');
    const quake = byId.get(id);
    await row.click();
    await expect(popup(page).locator('h3')).toHaveText(`Gempa M ${decimal(quake.magnitude)}`);
    await expect(popup(page)).toContainText(`${quake.depth_km} km`);
    const area = await visibleMapArea(page);
    const tip = await page.locator('.leaflet-popup-tip').boundingBox();
    const box = await page.locator('.leaflet-popup').boundingBox();
    expect(inside(tip, area), 'ujung popup (titik gempa) di bagian peta yang terlihat').toBe(true);
    expect(inside(box, area), 'popup utuh di bagian peta yang terlihat').toBe(true);
    const listResult = { id, magnitude: quake.magnitude, popup: await popupTitle(page) };
    await closePopup(page);

    // Dari penanda di peta: popup harus cocok dengan salah satu gempa di API.
    await page.locator('[data-tool="home"]').click();
    await clickUncoveredMarker(page, '.leaflet-quakes-pane .quake-icon');
    const heading = await popupTitle(page);
    const time = (await popup(page).locator('dd').first().textContent()).trim();
    const match = features.find((f) => heading === `Gempa M ${decimal(f.properties.magnitude)}`);
    expect(match, `gempa "${heading}" ada di data API`).toBeTruthy();
    saveResult('p2-gempa', { dari_daftar: listResult, dari_peta: { popup: heading, waktu: time }, galat: errors });
    expect(errors).toEqual([]);
  });

  test('gunung api dari penanda di peta dan dari daftar', async ({ page, request }) => {
    const errors = watchErrors(page);
    const { features } = await (await request.get('/api/volcanoes')).json();
    await openMap(page);
    const levels = { 1: 'Normal', 2: 'Waspada', 3: 'Siaga', 4: 'Awas' };
    const checked = [];

    // Tiga penanda yang tidak tertutup: nama dan level di popup sama dengan API.
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-tool="home"]').click();
      await clickUncoveredMarker(page, '.leaflet-marker-pane .volcano-icon', i);
      const name = (await popupTitle(page)).replace(/^Gunung\s+/i, '');
      const pill = (await popup(page).locator('.level-pill').textContent()).trim();
      const volcano = features.find((f) => f.properties.nama.replace(/^Gunung\s+/i, '') === name);
      expect(volcano, `gunung ${name} ada di API`).toBeTruthy();
      expect(pill).toContain(levels[volcano.properties.level]);
      checked.push({ nama: name, level_popup: pill, level_api: volcano.properties.level });
      await closePopup(page);
    }

    // Daftar Ikhtisar hanya memuat Siaga/Awas; bila ada, klik juga dari daftar.
    const row = page.locator('#volcano-alerts [data-volcano]').first();
    if (await row.count()) {
      const kode = await row.getAttribute('data-volcano');
      await row.click();
      await expect(popup(page)).toBeVisible();
      const volcano = features.find((f) => f.properties.kode === kode);
      await expect(popup(page).locator('h3')).toContainText(volcano.properties.nama.replace(/^Gunung\s+/i, ''));
      const tip = await page.locator('.leaflet-popup-tip').boundingBox();
      expect(inside(tip, await visibleMapArea(page))).toBe(true);
      checked.push({ dari_daftar: kode });
    }
    saveResult('p2-gunung-api', { hasil: checked, galat: errors });
    expect(errors).toEqual([]);
  });

  test('kab/kota: popup indikasi SIGAP sama dengan data indikasi', async ({ page, request }) => {
    const errors = watchErrors(page);
    const outlook = await (await request.get('/api/outlook')).json();
    const regionByName = new Map(outlook.regions.map((r) => [r.nama, r]));
    // Tampilan bawaan "Tertinggi": level tertinggi dari hujan lebat, banjir, dan longsor.
    const LABELS = ['Normal', 'Waspada', 'Siaga', 'Awas'];
    const expectedLabel = (region) => LABELS[Math.max(...Object.values(region.hazards).map((h) => h.level))];
    await openMap(page);
    const results = [];

    // Dari daftar Ikhtisar (kab/kota Waspada ke atas), bila ada.
    const row = page.locator('#outlook-list [data-outlook]').first();
    if (await row.count()) {
      const kode = await row.getAttribute('data-outlook');
      const region = outlook.regions.find((r) => r.kode === kode);
      await row.click();
      await expect(popup(page).locator('h3')).toHaveText(region.nama);
      await expect(popup(page).locator('.popup-heading .level-pill')).toHaveText(expectedLabel(region));
      const tip = await page.locator('.leaflet-popup-tip').boundingBox();
      expect(inside(tip, await visibleMapArea(page)), 'popup di bagian peta yang terlihat').toBe(true);
      results.push({ dari_daftar: region.nama, level: expectedLabel(region) });
      await closePopup(page);
    }

    // Dari peta: setelah menuju Kabupaten Garut, klik bagian peta yang terlihat. Bila
    // yang terkena poligon lain (mis. peringatan cuaca BMKG), titik di sebelahnya dicoba.
    await page.locator('#search input').fill('Kabupaten Garut');
    await page.locator('#search input').press('Enter');
    await page.locator('.search-result', { hasText: 'Kabupaten Garut' }).first().click();
    await page.locator('#detail-view [data-action="close"]').click();
    const area = await visibleMapArea(page);
    let region = null;
    for (const dx of [0, -60, 60, -120, 120]) {
      await page.mouse.click((area.left + area.right) / 2 + dx, (area.top + area.bottom) / 2);
      await expect(popup(page).locator('h3')).toBeVisible();
      region = regionByName.get(await popupTitle(page));
      if (region) break;
      await closePopup(page);
    }
    expect(region, 'popup kab/kota dari klik peta').toBeTruthy();
    await expect(popup(page).locator('.popup-heading .level-pill')).toHaveText(expectedLabel(region));
    results.push({ dari_peta: region.nama, level: expectedLabel(region) });
    saveResult('p2-kabkota', { hasil: results, galat: errors });
    expect(errors).toEqual([]);
  });
});
