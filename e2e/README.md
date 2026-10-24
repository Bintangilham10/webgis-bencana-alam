# Pengujian e2e SIGAP Bencana

Menjalankan rencana pengujian di slide Tugas 1 (lapis 3 fungsional peta dan lapis 4 non-fungsional) terhadap aplikasi yang sedang berjalan. Hasil terakhir dan analisisnya ada di [`docs/pengujian/README.md`](../docs/pengujian/README.md).

## Menjalankan

Aplikasi harus berjalan lebih dulu: API (`npm run dev` di `server/`, basis data berisi data) dan build produksi web (`npm run build && npm run preview` di `web/`, port 4173).

```bash
cd e2e
npm install
npx playwright install firefox webkit   # Chrome dan Edge memakai browser terpasang

npm test                 # semua skenario di 6 profil browser (Chrome, Edge, Firefox, WebKit, Android 390 px, iPhone 390 px)
npm run test:chrome      # hanya Chrome
npm run akurasi          # P3: gempa vs BMKG, gunung api vs MAGMA, kelas InaRISK di 50 titik
npm run kinerja          # P6: waktu respons API, cek risiko, rute aman, Lighthouse HP dan desktop
npm run laporan          # laporan HTML Playwright
```

`SIGAP_URL` (bawaan `http://localhost:4173`) dan `SIGAP_API` (bawaan `http://localhost:3000`) bisa diarahkan ke server lain. Hasil ukur tiap skenario ditulis ke `hasil/` (tidak dikomit).

## Isi

| Berkas | Skenario |
|---|---|
| `tests/p1-lapisan.spec.js` | P1 lapisan dan peta dasar: waktu tampil tiap lapisan dan 6 peta dasar, legenda ikut berubah |
| `tests/p2-popup.spec.js` | P2 popup gempa, gunung api, dan kab/kota dari daftar dan dari peta |
| `tests/p4-cek-risiko.spec.js` | P4 cek risiko 10 lokasi, dan titik pantau terparah dibandingkan indikasi kab/kota |
| `tests/p5-kartografi.spec.js` | P5 koordinat kursor WGS84/UTM/EPSG:3857 dibandingkan hitungan sendiri, skala batang, arah utara |
| `tests/p7-lintas-browser.spec.js` | P7 tata letak di 6 profil browser, tangkapan layar di `hasil/p7/` |
| `tests/p8-ketahanan.spec.js` | P8 sisi browser: API gagal, peta rawan InaRISK yang gagal dimuat |
| `tests/l-posisi.spec.js` | L2 izin ditolak, L3 tanpa Geolocation/HTTPS, L4 waktu di jaringan seluler, L6 laut dan luar Indonesia |
| `tests/fitur-baru.spec.js` | Peringatan CAP BMKG, notifikasi SSE, evakuasi, rute aman, pantau posisi |
| `scripts/akurasi.mjs` | P3 akurasi data |
| `scripts/kinerja.mjs` | P6 kinerja |

P8 sisi server (sync_logs, data terakhir tetap dilayani) ada di `server/test/api.test.js`. L1, L5, dan uji pengguna (SUS) butuh perangkat dan responden nyata.
