import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { checkRiskBySearch, saveResult, watchErrors } from './helpers.js';

// P7 Kompatibilitas dan responsif: Chrome, Edge, Firefox, Safari (WebKit); layar 390 px.
// Kriteria lulus: tanpa cacat tata letak. Diperiksa otomatis: tidak ada gulir
// mendatar, elemen antarmuka utuh di dalam layar dan tidak saling menimpa, popup dan
// kartu cek risiko utuh, tanpa galat JavaScript. Tangkapan layar tiap langkah
// disimpan di hasil/p7/ untuk diperiksa mata.

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hasil', 'p7');

// Elemen yang selalu terlihat dan tidak boleh saling menimpa.
const CHROME = {
  logo: '.brand',
  pencarian: '#search .search-form',
  kesegaran: '#freshness',
  notifikasi: '#notif-toggle',
  tema: '#theme-toggle',
  'arah utara': '.north-arrow',
  'bilah alat': '.map-toolbar',
  legenda: '.map-legend',
  'skala batang': '.leaflet-control-scale',
};

const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

async function layoutProblems(page) {
  const view = page.viewportSize();
  const problems = [];
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (scrollWidth > view.width + 1) problems.push(`gulir mendatar: lebar halaman ${scrollWidth} px > layar ${view.width} px`);
  // Atribut hidden kalah oleh aturan display di CSS: elemen kosong tetap tampil.
  const shownHidden = await page.evaluate(() =>
    [...document.querySelectorAll('[hidden]')]
      .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
      .map((el) => (el.id ? `#${el.id}` : `.${[...el.classList].join('.')}`)),
  );
  if (shownHidden.length) problems.push(`elemen hidden tetap tampil: ${shownHidden.join(', ')}`);
  const boxes = {};
  for (const [name, selector] of Object.entries(CHROME)) {
    const element = page.locator(selector).first();
    if (!(await element.isVisible())) continue;
    const box = await element.boundingBox();
    boxes[name] = box;
    if (box.x < -1 || box.x + box.width > view.width + 1 || box.y < -1 || box.y + box.height > view.height + 1) {
      problems.push(`${name} keluar layar (${Math.round(box.x)}, ${Math.round(box.y)}, ${Math.round(box.width)}×${Math.round(box.height)})`);
    }
  }
  const names = Object.keys(boxes);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const area = overlapArea(boxes[names[i]], boxes[names[j]]);
      if (area > 4) problems.push(`${names[i]} menimpa ${names[j]} (${Math.round(area)} px²)`);
    }
  }
  return problems;
}

async function insideViewport(page, selector) {
  const view = page.viewportSize();
  const box = await page.locator(selector).first().boundingBox();
  return box && box.x >= -1 && box.y >= -1 && box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1;
}

test.describe('P7 kompatibilitas dan responsif', { tag: '@lintas-browser' }, () => {
  test('halaman depan, peta, popup, dan cek risiko tanpa cacat tata letak', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    const project = testInfo.project.name;
    mkdirSync(SHOTS, { recursive: true });
    const shot = (step) => page.screenshot({ path: join(SHOTS, `${project}-${step}.jpg`), type: 'jpeg', quality: 80 });
    const steps = {};

    await page.goto('/');
    await expect(page.locator('#landing h1').first()).toBeVisible();
    const landingWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    steps.halaman_depan = landingWidth > page.viewportSize().width + 1 ? [`gulir mendatar ${landingWidth} px`] : [];
    await shot('1-halaman-depan');

    await page.locator('[data-action="enter-map"]:visible').first().click();
    await expect(page.locator('#landing')).toBeHidden();
    await expect(page.locator('#quake-list .list-row').first()).toBeAttached();
    await page.waitForTimeout(800);
    steps.peta = await layoutProblems(page);
    await shot('2-peta');

    // Gempa terbaru dari daftar: popup utuh di layar. Di HP lembar bawah dibuka dulu.
    if (await page.locator('#sheet-handle').isVisible()) await page.locator('#sheet-handle').click();
    await page.locator('#quake-list [data-quake]').first().click();
    await expect(page.locator('.leaflet-popup-content h3')).toHaveText(/Gempa M/);
    await page.waitForTimeout(500);
    steps.popup = (await insideViewport(page, '.leaflet-popup')) ? [] : ['popup gempa terpotong tepi layar'];
    await shot('3-popup');
    await page.keyboard.press('Escape');

    // Cek risiko lewat pencarian: kartu profil tampil dan bisa digulir sampai bawah.
    // Bagian evakuasi dan debit sungai dimuat belakangan dan memanjangkan kartu, jadi
    // pengguliran diulang sampai footer tetap terlihat.
    const ms = await checkRiskBySearch(page, { query: 'Kota Bandung', pick: 'Bandung' });
    const footer = page.locator('#detail-view .detail-footer');
    await expect(async () => {
      await footer.scrollIntoViewIfNeeded();
      await expect(footer).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    steps.cek_risiko = await layoutProblems(page);
    await shot('4-cek-risiko');

    saveResult(`p7-${project}`, { layar: page.viewportSize(), waktu_cek_risiko_ms: ms, masalah: steps, galat: errors });
    for (const [step, problems] of Object.entries(steps)) expect.soft(problems, `cacat tata letak: ${step}`).toEqual([]);
    expect(errors).toEqual([]);
  });
});
