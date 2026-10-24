import { defineConfig, devices } from '@playwright/test';

// Aplikasi yang diuji harus sudah berjalan: API (`npm run dev` di server/) dan
// build produksi web (`npm run build && npm run preview` di web/, port 4173, /api
// diteruskan ke port 3000). SIGAP_URL bisa diarahkan ke server lain.
const baseURL = process.env.SIGAP_URL ?? 'http://localhost:4173';
const desktop = { width: 1440, height: 900 };

export default defineConfig({
  testDir: 'tests',
  outputDir: 'hasil/artefak',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Satu API lokal dan sumber luar yang dibatasi lajunya (Nominatim 1 req/detik,
  // InaRISK), jadi test berjalan satu per satu.
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'hasil/laporan', open: 'never' }], ['json', { outputFile: 'hasil/playwright.json' }]],
  use: {
    baseURL,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    // Aplikasi mematikan animasi terbang peta bila gerakan dikurangi, jadi posisi
    // peta langsung bisa diperiksa.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // P7: Chrome dan Edge memakai browser terpasang di sistem; Safari diwakili WebKit.
  // Browser selain Chrome hanya menjalankan test bertanda @lintas-browser; layar
  // HP 390 px juga menjalankan test bertanda @hp.
  projects: [
    {
      name: 'chrome',
      // sigap.test → 127.0.0.1: asal http:// yang bukan localhost untuk uji L3 tanpa HTTPS.
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: desktop, launchOptions: { args: ['--host-resolver-rules=MAP sigap.test 127.0.0.1'] } },
      grepInvert: /@hp/,
    },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: desktop }, grep: /@lintas-browser/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: desktop }, grep: /@lintas-browser/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: desktop }, grep: /@lintas-browser/ },
    { name: 'hp-android', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, grep: /@lintas-browser|@hp/ },
    { name: 'hp-iphone', use: { ...devices['iPhone 13'] }, grep: /@lintas-browser|@hp/ },
  ],
});
