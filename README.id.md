<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
  <img src="docs/images/logo-light.svg" width="80" height="80" alt="Logo SIGAP Bencana: huruf S dari tiga garis kontur di sekitar titik puncak amber">
</picture>

# SIGAP Bencana

*English version: [README.md](README.md)*

Sistem web pemetaan **peringatan dini dan mitigasi bencana alam Indonesia** berbasis data spasial terbuka.
Tugas Besar mata kuliah Teknologi Pemetaan Berbasis Web (ACK4LBB3), Telkom University.

> **Bukan sumber peringatan resmi.** Untuk keputusan keselamatan, ikuti BMKG, PVMBG/MAGMA, dan BNPB/BPBD setempat.

## Fitur saat ini

- **Antarmuka gelap kaca + mode terang:**
  - peta memenuhi layar;
  - pencarian, panel bertab (Ikhtisar, Lapisan, Info), bilah alat, dan legenda melayang sebagai panel kaca buram;
  - warna polos tanpa gradien: panel abu netral, satu aksen biru untuk tombol utama dan pilihan aktif, sedangkan warna mencolok hanya dipakai untuk data bahaya;
  - tombol matahari/bulan mengganti tema antarmuka (tersimpan di browser); peta dasar tidak ikut berganti;
  - di HP panel menjadi lembar bawah (*bottom sheet*) yang bisa digeser;
  - tab Info memuat nomor darurat (112, 117, 115, 119, 113, 110).
  
  Tanpa framework CSS; font Plus Jakarta Sans dimuat mandiri (±27 KB). Efek kaca otomatis diganti panel pekat bila sistem meminta transparansi dikurangi.
- **Animasi:**
  - layar pembuka dengan logo tergambar dan gelombang seismik;
  - penanda tab meluncur; isi panel dan detail cek risiko bergeser masuk;
  - angka statistik menghitung naik; daftar muncul berurutan; batang bahaya/hujan terisi bertahap;
  - gempa < 24 jam memancarkan gelombang (gempa terbaru bergelombang merah); gunung api yang sedang erupsi mengepulkan abu dan percikan lava, Siaga/Awas bercincin;
  - garis jarak tergambar pelan; peta "terbang" ke lokasi; tombol memantul saat ditekan;
  - klik gempa atau gunung api (di peta maupun di daftar) menerbangkan peta mendekat ke titik itu (zoom 10 untuk gempa, 12 untuk gunung api) di area yang tidak tertutup panel, lalu popup terbuka dan titiknya disorot cincin biru.
  
  Semua animasi mati otomatis bila pengguna mengaktifkan "kurangi gerakan".
- **Peta dasar:** kanvas abu-abu terang dan gelap (Esri), kemanusiaan (HOT), OpenStreetMap, relief (OpenTopoMap), dan citra satelit (Esri), dipilih lewat menu bergambar. Peta dasar awal menyesuaikan tema saat halaman dibuka. Warna garis sesar, lempeng, batas wilayah, dan tepi simbol mengikuti terang-gelapnya peta dasar supaya tetap kontras.
- **Elemen kartografi:** legenda dinamis yang bisa dilipat, skala batang, arah utara, angka skala 1:n beserta klasifikasinya, dan koordinat kursor dalam WGS84, UTM, dan EPSG:3857.
- **Gempa BMKG:** disinkronkan tiap 60 detik. Simbolnya cakram berlapis seukuran magnitudo, berwarna kelas kedalaman, dan makin pudar seiring umur (sampai 7 hari). Popup memuat penanda potensi tsunami dan tautan shakemap.
- **Status gunung api:** 69 gunung api dari MAGMA/PVMBG, disinkronkan tiap 30 menit. Simbolnya kerucut berfaset berwarna level PVMBG (gaya terinspirasi ikon peta MAGMA, digambar sendiri); Siaga/Awas lebih besar. Status sedang erupsi dan VONA (peringatan abu vulkanik untuk penerbangan) ikut diambil dari MAGMA.
- **Filter penanda:** tombol corong di bilah alat kanan menyalakan atau mematikan penanda gempa dan gunung api, serta menyaring gempa menurut kedalaman, magnitudo minimum, dan waktu (24 jam, 3 hari, 7 hari), dan gunung api menurut tingkat aktivitas. Menu menunjukkan jumlah titik yang tampil; titik biru di tombol menandakan ada penanda yang disembunyikan. Gempa atau gunung api yang dipilih dari daftar tetap ditampilkan walau tersaring.
- **Peta rawan InaRISK BNPB:** gempa bumi, cuaca ekstrem, banjir, tanah longsor, dan gunung api, masing-masing dalam 3 kelas bahaya. Ditambah zona kerentanan gerakan tanah (ZKGT) PVMBG dengan warna kelas yang sama.
- **Indikasi SIGAP 3 hari per kab/kota:** 514 kab/kota dinilai ulang tiap 12 jam untuk hujan lebat, banjir, dan tanah longsor. Nyala bawaan di peta, dengan pilihan tampilan Tertinggi, Hujan lebat, Banjir, dan Tanah longsor. Cara kerjanya:
  - kelas bahaya banjir dan longsor InaRISK seluruh Indonesia (±550 m) dimuat ke raster PostGIS, lalu di-clip per kab/kota; luas tiap kelas per kab/kota ikut dicatat;
  - tiap kab/kota punya sampai 3 titik pantau per bahaya di sel 0,25° berkelas tertinggi, ditambah 1 titik acuan. Kelas tiap titik dicek ke nilai asli InaRISK 100 m (`getSamples`), karena ekspor 550 m dihaluskan server. Hasilnya, cek risiko di titik itu menunjukkan kelas yang sama;
  - hujan harian Open-Meteo 3 hari lalu dan 3 hari ke depan diambil tepat di tiap titik pantau, pada koordinat yang sama dengan cek risiko. Di Indonesia Open-Meteo memakai ECMWF IFS 9 km, jauh lebih rapat dari sel 0,25°, jadi hujan tidak dirata-rata per sel. Satu run ±3.200 panggilan (100 titik per permintaan dengan jeda), karena itu dijalankan tiap 12 jam supaya tetap di dalam kuota gratis;
  - aturan v0.1 (`server/src/config/rules.json`): hujan lebat mengikuti kategori BMKG (lebat Waspada, sangat lebat Siaga, ekstrem Awas); banjir dan longsor menggabungkan hujan harian tertinggi dengan kelas bahaya di titik; untuk longsor, akumulasi 3 hari ≥ 100 mm (termasuk hujan hari-hari terakhir) dihitung setara hujan lebat. Level kab/kota = level tertinggi dari titik-titiknya;
  - popup kab/kota memuat ketiga bahaya beserta alasan dan hari puncaknya, level CEWS BMKG sebagai pembanding, dan tombol cek risiko di titik pantau terparah. Ikhtisar menampilkan jumlah kab/kota per level dan daftar yang Waspada ke atas;
  - setiap run disimpan (`indikasi_run`, `indikasi_wilayah`), termasuk kab/kota yang Normal, untuk uji prospektif. Aturannya belum dikalibrasi, jadi selalu diberi label indikasi sistem, bukan peringatan resmi.
- **Hujan dan longsor:**
  - peringatan dini curah hujan tinggi BMKG (CEWS) dasarian berjalan, digambar di batas kab/kota (Waspada, Siaga, Awas) dan didaftar di Ikhtisar; klik untuk menuju wilayahnya;
  - hujan terkini dari satelit NASA GPM IMERG (rata-rata 30 menit, terlambat ±5 jam);
  - riwayat 1.884 kejadian longsor PVMBG dan MAGMA, segitiga ungu yang makin gelap makin baru.
- **Logo Kontur:** huruf S dari tiga garis kontur di sekitar titik puncak amber. Di layar pembuka, titik muncul lebih dulu, garis kontur tergambar bergantian, lalu sinyal memancar dari titik itu.
- **Data geologi dan wilayah:** sesar aktif PuSGeN 2024, batas lempeng tektonik, dan batas 514 kabupaten/kota (Kepmendagri 2025).
- **Pencarian lokasi:** nama kab/kota dicari di database sendiri, tempat lain lewat Nominatim OpenStreetMap. Pencarian berjalan saat Enter ditekan, sesuai kebijakan Nominatim.
- **Cek risiko lokasi:** pilih titik dengan pencarian, tombol "lokasi saya", mode pilih titik, atau klik kanan/tekan lama di peta. Profil tampil di panel samping (peta tidak tertutup) dan dibuka dengan satu status 3 hari ke depan (Normal/Waspada/Siaga/Awas). Isinya:
  - indeks lima bahaya InaRISK dengan kelas BNPB;
  - indikasi 3 hari untuk hujan lebat, banjir, dan tanah longsor (hujan × kelas bahaya, aturan v0.1 di `server/src/config/rules.json`, sama dengan indikasi per kab/kota);
  - prakiraan hujan dan elevasi;
  - jarak ke sesar aktif dan gunung api terdekat, digambar sebagai garis di peta;
  - gempa di sekitar lokasi dan saran kesiapsiagaan;
  - tanah longsor dan hujan: potensi gerakan tanah bulanan PVMBG dan ZKGT, peringatan hujan tinggi BMKG untuk kab/kota itu, hujan 3 hari terakhir, peluang hujan ≥ 50 mm dari 51 anggota ensemble ECMWF, kemiringan lereng, dan riwayat longsor dalam 5 km.
- **Perekam arsip data riset** (`recorder/`): GitHub Actions merekam tiap 15 menit ke branch `arsip-data`. Yang direkam:
  - peringatan dini cuaca dan gempa BMKG, status gunung api MAGMA, dan laporan PetaBencana;
  - untuk riset longsor dan hujan: peringatan dini curah hujan tinggi BMKG (CEWS, per dasarian, termasuk arsip sejak 2022), prakiraan bulanan potensi gerakan tanah PVMBG di titik tiap kab/kota, laporan pemeriksaan lapangan PVMBG (baru/berubah), ringkasan ensemble hujan ECMWF 3 hari, kejadian mingguan BNPB, dan berita longsor yang dicocokkan ke kab/kota.

  Titik kab/kota untuk perekam dibuat dengan `npm run export:recorder` di folder `server/` (hasilnya `recorder/data/wilayah.json`, ikut dikomit).

  Jadwal `schedule` GitHub Actions sering molor (kenyataannya ±6 run per hari), jadi run juga dipicu dari luar tiap 15 menit oleh layanan cron gratis cron-job.org yang memanggil API `workflow_dispatch`. Cara memasangnya:
  1. Di GitHub (Settings → Developer settings → Fine-grained tokens), buat token yang hanya bisa mengakses repo ini, dengan izin **Actions: Read and write**. Beri masa berlaku sampai setelah musim hujan.
  2. Di cron-job.org, buat job tiap 15 menit berisi `POST https://api.github.com/repos/Bintangilham10/webgis-bencana-alam/actions/workflows/rekam-data.yml/dispatches` dengan header `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, dan `X-GitHub-Api-Version: 2022-11-28`, serta body `{"ref":"main"}`. Kalau benar, balasannya HTTP 204.

  Token ini hanya bisa memicu, membatalkan, atau menonaktifkan run workflow. Token tidak bisa mengubah kode maupun isi arsip. Cabut token di GitHub kalau sudah tidak dipakai.

## Struktur

| Folder | Isi |
|---|---|
| `server/` | API Express + PostGIS, penjadwal sinkronisasi, migrasi, dan seed data |
| `web/` | Frontend Vite + Leaflet |
| `recorder/` | Perekam arsip data (berjalan di GitHub Actions) |
| `docker-compose.yml` | Database PostgreSQL 18 + PostGIS 3.6 |

## Menjalankan secara lokal

Prasyarat: Node.js 22 atau lebih baru dan Docker Desktop.

```bash
docker compose up -d        # database di localhost:5433

cd server
npm install
npm run migrate             # membuat tabel
npm run seed                # batas wilayah, gunung api, sesar, riwayat longsor, zona bahaya (±5 menit pertama kali)
npm run dev                 # API di http://localhost:3000/api; indikasi 3 hari pertama siap ±10 menit kemudian
```

Di terminal lain:

```bash
cd web
npm install
npm run dev                 # buka http://localhost:5173
```

Buka alamat itu di browser biasa (Chrome, Edge, Brave, atau Firefox). Di browser bawaan VS Code peta dasar Kemanusiaan (HOT) tampil kosong, karena server OSM Prancis menolak User-Agent VS Code (HTTP 403).

Server menghitung indikasi 3 hari tiap 12 jam dan tidak mengulanginya saat dimulai ulang bila run terakhir masih segar. Untuk memperbarui kapan saja (mis. sebelum demo), jalankan `npm run indikasi` di folder `server/`. Satu run memakai ±sepertiga kuota harian gratis Open-Meteo.

Konfigurasi bawaan sudah cocok dengan `docker-compose.yml`. Salin `.env.example` menjadi `.env` hanya bila perlu mengubahnya.

### Test

```bash
cd server && npm test       # unit test
cd recorder && npm test
```

Test integrasi server memakai database terpisah supaya data pengembangan tidak tersentuh:

```bash
docker compose exec db createdb -U sigap sigap_test     # sekali saja
cd server
TEST_DATABASE_URL=postgres://sigap:sigap@localhost:5433/sigap_test npm test
```

Di PowerShell: `$env:TEST_DATABASE_URL="postgres://sigap:sigap@localhost:5433/sigap_test"; npm test`

## API

| Endpoint | Isi |
|---|---|
| `GET /api/health` | Status database dan sinkronisasi tiap sumber |
| `GET /api/earthquakes?days=7` | Gempa dalam 1–90 hari terakhir (GeoJSON) |
| `GET /api/volcanoes` | Gunung api beserta status level, erupsi, dan VONA |
| `GET /api/faults` | Segmen sesar aktif PuSGeN 2024 |
| `GET /api/wilayah?tingkat=provinsi` atau `kabkota` | Batas wilayah, disederhanakan untuk tampilan |
| `GET /api/risk?lat=-6.2&lon=106.85` | Profil risiko satu titik (cache 10 menit per sel ±100 m), termasuk bagian `landslide`: potensi gerakan tanah bulanan PVMBG, peringatan hujan tinggi BMKG, hujan 3 hari terakhir, peluang ensemble, kemiringan lereng, dan riwayat longsor dalam 5 km |
| `GET /api/rain-warnings` | Kab/kota berstatus Waspada, Siaga, atau Awas pada peringatan dini curah hujan tinggi BMKG dasarian ini (GeoJSON) |
| `GET /api/landslides` | Riwayat kejadian gerakan tanah PVMBG dan MAGMA (GeoJSON) |
| `GET /api/rain-warnings/summary` | Peringatan hujan BMKG tanpa geometri, dengan provinsi dan batas wilayah, untuk daftar |
| `GET /api/rain-now` | Waktu dan URL petak peta hujan satelit NASA IMERG terbaru |
| `GET /api/outlook` | Indikasi SIGAP 3 hari terbaru: level hujan lebat, banjir, dan tanah longsor per kab/kota beserta alasan, hari puncak, dan titik pantau terparah, plus jumlah kab/kota per level |
| `GET /api/geocode?q=bandung` | Pencarian kab/kota (database) dan tempat lain (Nominatim) |

## Sumber data dan atribusi

| Data | Sumber | Ketentuan |
|---|---|---|
| Gempa bumi | [BMKG](https://data.bmkg.go.id/) | Wajib mencantumkan BMKG sebagai sumber |
| Indeks bahaya (cek titik, sampel, dan raster kelas ±550 m untuk indikasi 3 hari), sesar aktif | [InaRISK BNPB](https://inarisk.bnpb.go.id/); model sesar PuSGeN 2024 | Cantumkan BNPB dan PuSGeN |
| Status gunung api | [MAGMA Indonesia](https://magma.esdm.go.id/), PVMBG Kementerian ESDM | Cantumkan PVMBG |
| Prakiraan potensi gerakan tanah bulanan, ZKGT, dan riwayat kejadian longsor | PVMBG, Badan Geologi, Kementerian ESDM ([Portal MBG](https://vsi.esdm.go.id/portalmbg/) dan MAGMA Indonesia) | Cantumkan PVMBG. Riwayat disusun ulang oleh `research/01_inventaris.py` tanpa data pribadi |
| Peringatan dini curah hujan tinggi | [BMKG CEWS](https://cews.bmkg.go.id/) | Wajib mencantumkan BMKG sebagai sumber |
| Batas lempeng | Bird (2003) PB2002, konversi H. Ahlenius/Nordpil | ODC-By |
| Batas wilayah | Kepmendagri No 300.2.2-2430 Tahun 2025, [cahyadsn/wilayah_boundaries](https://github.com/cahyadsn/wilayah_boundaries) | MIT |
| Laporan warga (arsip riset) | [PetaBencana.id](https://petabencana.id/) | CC BY-NC 4.0 |
| Prakiraan hujan (juga untuk indikasi 3 hari) dan elevasi | [Open-Meteo](https://open-meteo.com/) (elevasi dari Copernicus DEM 90 m) | CC BY 4.0, gratis untuk nonkomersial |
| Hujan satelit | [NASA GPM IMERG](https://gpm.nasa.gov/data/imerg) Early Run, lewat NASA GIBS | Data terbuka NASA; cantumkan NASA |
| Pencarian tempat | [Nominatim](https://nominatim.org/) © OpenStreetMap contributors | ODbL; maksimal 1 request/detik, tanpa autocomplete |
| Peta dasar | Esri; © OpenStreetMap contributors (ODbL); Humanitarian OpenStreetMap Team; OpenTopoMap | CC-BY-SA untuk OpenTopoMap |
