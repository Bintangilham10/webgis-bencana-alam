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

npm run gps -- pengukuran.csv   # L1: galat "Lokasi saya" terhadap titik acuan (tanpa aplikasi berjalan)
npm run sus -- jawaban.csv      # lapis 5: skor SUS dan keberhasilan tugas dari CSV Google Form

npm run latensi:server -- --menit 1440   # latensi notifikasi langsung dari server produksi (lihat di bawah)
npm run test:skrip              # test hitungan skrip di scripts/ (tanpa aplikasi berjalan)
```

`SIGAP_URL` (bawaan `http://localhost:4173`) dan `SIGAP_API` (bawaan `http://localhost:3000`) bisa diarahkan ke server lain. Hasil ukur tiap skenario ditulis ke `hasil/` (tidak dikomit).

## Latensi notifikasi

Perekam ini mendengarkan aliran notifikasi (`/api/stream`) seperti browser dan mencatat tiap notifikasi sungguhan yang tiba: gempa BMKG, perubahan level gunung api, dan peringatan dini cuaca BMKG. Server yang diukur harus sudah punya `GET /api/time`.

```bash
# Data riset: server produksi, hasilnya di research/results/ (ikut dikomit)
npm run latensi:server -- --menit 1440       # 24 jam
npm run latensi:server -- --ringkas          # hitung ulang ringkasan tanpa merekam

# Coba-coba: server lain, hasilnya di hasil/ (tidak dikomit)
npm run latensi -- --api http://localhost:3000 --menit 10
npm run latensi -- --ringkas
```

`latensi:server` menulis ke `research/results/latensi_notifikasi.csv`, ringkasannya ke `research/results/latensi_notifikasi.md`, dan catatan sesinya ke `research/results/latensi_notifikasi.sesi.csv`. Rekaman kejadian nyata tidak bisa diulang, jadi ketiga berkas itu dikomit. `latensi` biasa menulis ke `hasil/latensi-notifikasi.csv`; `--csv <berkas>` mengganti tempatnya. Tiap jalan menambah baris ke berkas yang sama, jadi perekaman boleh dicicil beberapa sesi (`--menit` paling banyak 30.240, yaitu 21 hari). Ringkasan ditulis saat perekaman selesai atau dihentikan dengan Ctrl+C.

Dari baris notifikasi saja tidak terlihat kapan perekam tidak berjalan, jadi tiap sesi mencatat tiga kejadian di berkas `.sesi.csv`: `mulai` (perekam mulai mendengarkan), `terhenti` (laptop sempat tidur; kolom `detik` berisi lamanya), dan `selesai`. Kolom `sesi` berisi waktu mulai sesi itu dan sama di semua barisnya. Ringkasan memakainya untuk menyebut tiap sesi dan lama mendengarkannya, bukan satu rentang dari notifikasi pertama sampai terakhir. Sesi tanpa baris `selesai` berarti perekam dimatikan sebelum sempat menulisnya (jendela terminal ditutup, laptop dimatikan); lamanya tidak dihitung. Jadi hentikan perekam dengan Ctrl+C.

Yang diukur untuk tiap notifikasi:

| Kolom | Arti |
|---|---|
| `latensi_ms` | Latensi kirim: dari server menyimpan notifikasi (`created_at`) sampai datanya tiba di perekam. Jam perekam dan server tidak persis sama, jadi selisihnya diukur ke `/api/time` (tujuh kali bolak-balik, dipakai yang tercepat) di awal, tiap menit, dan tiap menyambung lagi. Ketidakpastiannya paling besar setengah `rtt_ms`, ditambah geser jam perekam sejak pengukuran terakhir |
| `jeda_sumber_s` | Jeda sejak waktu sumber: dari waktu yang dicantumkan sumber (waktu gempa terjadi, waktu BMKG menerbitkan peringatan) sampai server menyimpan notifikasinya. Di dalamnya ada jeda sumber menerbitkan datanya dan selang SIGAP memeriksa sumber (gempa tiap 1 menit, peringatan cuaca tiap 5 menit). Untuk gunung api kolom ini tidak diringkas, karena MAGMA tidak mencantumkan waktu penetapan level |
| `langsung` | `true` bila notifikasi dibuat selagi perekam mendengarkan. Yang `false` tetap dicatat tetapi tidak masuk ringkasan: kiriman ulang setelah sambungan putus, dan notifikasi yang dibuat selagi perekam terhenti |

Supaya angkanya bisa dipertanggungjawabkan:

- Rekam dari jaringan yang mewakili pengguna (internet rumah atau kampus), bukan dari server itu sendiri.
- Atur laptop supaya tidak tidur selama merekam. Bila laptop tetap tidur, perekam mengenalinya dari jam sistem yang melompat, menulis "Perekam terhenti", dan tidak menghitung notifikasi yang dibuat selama itu.
- Gempa hanya beberapa kali sehari, sedangkan peringatan cuaca datang berombongan tiap sinkronisasi. Ringkasan menulis jumlah notifikasi dan jumlah siaran; laporkan keduanya, beserta rentang waktu perekaman dan jaringan yang dipakai.
- Yang diukur adalah tibanya data di klien. Waktu browser menggambar notifikasi di layar tidak termasuk.
- Jam laptop bergeser terhadap jam server: pada laptop perekam terukur sekitar 1 ms per menit (24 Nov 2026, selisih diukur tiap 30 detik selama 6 menit). Karena itu selisih jam diukur ulang tiap menit, sehingga geser ini membuat latensi terhitung kurang paling banyak sekitar 1 ms.
- Waktu tiba dicatat begitu data terbaca; barisnya ditulis ke berkas sesudahnya. Berkas CSV boleh dibuka selagi merekam. Bila program lain menguncinya (misalnya Excel), perekam menulis "Rekaman belum bisa ditulis", menyimpan barisnya, dan menulisnya begitu berkas itu ditutup.

## Isi

| Berkas | Skenario |
|---|---|
| `tests/p1-lapisan.spec.js` | P1 lapisan dan peta dasar: waktu tampil tiap lapisan dan 6 peta dasar, legenda ikut berubah, lapisan satelit digambar ulang di zoom bulat saat peta dasar diganti |
| `tests/p2-popup.spec.js` | P2 popup gempa, gunung api, dan kab/kota dari daftar dan dari peta |
| `tests/p4-cek-risiko.spec.js` | P4 cek risiko 10 lokasi, dan titik pantau terparah dibandingkan indikasi kab/kota |
| `tests/p5-kartografi.spec.js` | P5 koordinat kursor WGS84/UTM/EPSG:3857 dibandingkan hitungan sendiri, skala batang, arah utara |
| `tests/p7-lintas-browser.spec.js` | P7 tata letak di 6 profil browser, tangkapan layar di `hasil/p7/` |
| `tests/p8-ketahanan.spec.js` | P8 sisi browser: API gagal, peta rawan InaRISK yang gagal dimuat |
| `tests/l-posisi.spec.js` | L2 izin ditolak, L3 tanpa Geolocation/HTTPS, L4 waktu di jaringan seluler, L6 laut dan luar Indonesia |
| `tests/fitur-baru.spec.js` | Peringatan CAP BMKG, notifikasi SSE, evakuasi, rute aman, pantau posisi |
| `scripts/akurasi.mjs` | P3 akurasi data |
| `scripts/kinerja.mjs` | P6 kinerja |
| `scripts/galat-gps.mjs` | L1 galat posisi per titik dan per perangkat, dari pengukuran di lapangan |
| `scripts/sus.mjs` | Lapis 5 skor SUS, keberhasilan tugas, dan profil responden, dari jawaban Google Form |
| `scripts/latensi-notifikasi.mjs` | Latensi notifikasi langsung: latensi kirim dan jeda sejak waktu sumber, dari notifikasi sungguhan |
| `scripts/latensi-notifikasi.test.mjs` | Test hitungan perekam latensi (`npm run test:skrip`) |
| `scripts/csv.mjs` | Pembaca CSV untuk skrip `gps`, `sus`, dan `latensi` |

P8 sisi server (sync_logs, data terakhir tetap dilayani) ada di `server/test/api.test.js`. L1, L5, dan uji pengguna (SUS) butuh perangkat dan responden nyata; langkah dan formulirnya ada di [`docs/pengujian/`](../docs/pengujian/), dan `gps` serta `sus` menghitung hasilnya.
