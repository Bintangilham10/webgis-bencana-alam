# Hasil pengujian SIGAP Bencana

Laporan ini menjalankan rencana pengujian dan evaluasi di slide Tugas 1 *Kebutuhan Dasar Sistem* (slide 14–17): lima lapis pengujian, skenario P1–P8 dan L1–L6, serta ukuran kinerja sistem. Pengujian dijalankan 24 Oktober 2026 dini hari WIB: dua putaran penuh, ditambah putaran per skenario saat memperbaiki cacat. Angka yang bergantung pada server luar ditulis sebagai rentang antarputaran. Putaran akhir: 25 dari 26 test e2e lulus (yang gagal: P1 untuk lapisan dari server luar). Cara menjalankan ulang ada di bagian akhir.

## Ringkasan

| Lapis | Isi | Status | Bukti |
|---|---|---|---|
| 1 Unit | Parser sumber, aturan indikasi, cache | **Lulus**: 138 test server, 55 perekam, 22 riset | `npm test` di `server/`, `recorder/`; `unittest` di `research/` |
| 2 Integrasi | API dan PostGIS pada basis data uji terpisah | **Lulus** (bagian dari 138 test server) | `server/test/api.test.js` dengan `TEST_DATABASE_URL` |
| 3 Fungsional peta | P1–P5, L2–L6, fitur baru | **Lulus**, kecuali P1 untuk lapisan dari server luar yang lambat | [`e2e/`](../../e2e) (Playwright) |
| 4 Non-fungsional | P6 kinerja, P7 kompatibilitas, P8 ketahanan | P7 dan P8 **lulus**; P6 lulus untuk API dan desktop, **belum** untuk LCP di HP | `e2e/`, `scripts/kinerja.mjs` |
| 5 Pengguna | Tugas nyata + kuesioner SUS, ≥ 15 responden | **Belum dijalankan** | butuh responden |

Pengujian ini juga menemukan 11 cacat, dua di antaranya menyangkut keselamatan informasi: saat layanan InaRISK mati, cek risiko menyebut titik berzona banjir tinggi yang akan diguyur hujan lebat sebagai "Normal … di luar zona bahaya", dan hampir setiap cek risiko menunggu 10 detik. Semuanya sudah diperbaiki dan diuji ulang (lihat [Cacat yang ditemukan](#cacat-yang-ditemukan-dan-diperbaiki)).

## Skenario P1–P8

| ID | Skenario | Kriteria lulus | Hasil | Status |
|---|---|---|---|---|
| P1 | Lapisan dan peta dasar | Tampil ≤ 3 detik; legenda ikut berubah | Lapisan dari server SIGAP tampil dalam ≤ 0,08 detik. Legenda berubah tepat untuk 24 dari 24 sakelar dan pilihan, tanpa galat JavaScript. Peta dasar 0,1–1,9 detik, kecuali sekali Relief (OpenTopoMap) 5,7 detik. Yang bergantung pada server luar: GDACS 1,5–4,3 detik (diambil server dari gdacs.org saat diminta), hujan IMERG 2,8–4,0 detik dan awan Himawari 3,3–3,5 detik (NASA GIBS, 55 petak, petak pertama ±1,5 detik), indeks InaRISK gempa bumi, cuaca ekstrem, dan gunung api 0,3–0,5 detik, ZKGT 5,5 detik, sedangkan indeks banjir dan longsor tidak selesai dalam 30 detik karena layanan InaRISK BNPB sedang mati. | Sebagian: yang dilayani SIGAP lulus |
| P2 | Popup dan interaksi | Popup benar; peta terbang ke titik | Gempa dari daftar dan dari penanda, 3 gunung api dari penanda dan dari daftar, kab/kota dari daftar dan dari klik peta: isi popup sama dengan API, dan popup beserta titiknya berada di bagian peta yang tidak tertutup panel. | Lulus |
| P3 | Akurasi data | ≥ 95% cocok; kelas InaRISK identik | Gempa 27 dari 27 cocok dengan feed BMKG (waktu, magnitudo, kedalaman, koordinat). Level 69 dari 69 gunung api sama dengan tabel tingkat aktivitas MAGMA. Indeks dan kelas InaRISK identik di 150 dari 150 perbandingan (50 titik × gempa bumi, cuaca ekstrem, gunung api). Banjir dan tanah longsor belum dapat dibandingkan karena layanannya mati saat uji. | Lulus (banjir dan longsor diulang) |
| P4 | Cek risiko lokasi | Profil ≤ 5 detik; status sama dengan kab/kota | 10 lokasi dari Banda Aceh sampai Jayapura: kab/kota 10 dari 10 benar, profil tampil dalam 0,19–1,09 detik. Status di titik pantau terparah dari 5 kab/kota Waspada, diuji tepat setelah run indikasi baru supaya prakiraannya sama: sama di 4 dari 4 yang dapat dibandingkan; 1 titik "belum dapat dinilai" karena layanan InaRISK tanah longsor mati (sebelum perbaikan no. 10 titik itu tertulis Normal). | Lulus |
| P5 | Kartografi | WGS84, UTM, EPSG:3857 sesuai zona | 10 posisi kursor di zona UTM 47–56, utara dan selatan khatulistiwa: zona selalu benar, selisih ≤ 1,13 m (UTM) dan ≤ 0,96 m (EPSG:3857) dari hitungan independen (sebatas pembulatan tampilan). Skala batang selisih < 1% dari jarak di lapangan, angka skala < 2%, utara di atas. | Lulus |
| P6 | Kinerja | LCP ≤ 2,5 detik; API p95 ≤ 1 detik | API p95: `/api/outlook` 17 ms, `/api/wilayah` kab/kota 153 ms (diukur langsung di server). LCP desktop 0,65 detik (skor kinerja 94); LCP HP 3,3 detik (skor 63) pada simulasi 4G lambat dan CPU 4× lebih lambat. | Sebagian |
| P7 | Kompatibilitas dan responsif | Tanpa cacat tata letak | Chrome 156, Edge 156, Firefox 155, WebKit 26.6 (mesin Safari), Android 390 px, iPhone 390 px: tanpa gulir mendatar, tanpa elemen yang keluar layar atau saling menimpa, popup dan kartu cek risiko utuh, tanpa galat JavaScript. Empat cacat tata letak ditemukan dan diperbaiki lebih dulu. | Lulus |
| P8 | Ketahanan sumber | Data terakhir tetap tampil; tercatat di sync_logs | Galat HTTP 503, timeout, dan halaman yang berubah format untuk gempa BMKG, MAGMA, dan peringatan CAP tercatat di `sync_logs`, sedangkan API tetap melayani data terakhir dan waktu sinkron terakhirnya. Di browser, API gempa yang gagal tidak menghapus penanda dan daftar; status berubah menjadi "Sebagian data gagal dimuat" dan pulih sendiri. Di server produksi, MAGMA gagal 108 kali beruntun sejak 21 Okt 04:58Z karena halamannya berubah, dan status 69 gunung api terakhir tetap dilayani. | Lulus |

## Skenario posisi pengguna L1–L6

| ID | Uji | Kriteria lulus | Hasil | Status |
|---|---|---|---|---|
| L1 | Akurasi "Lokasi saya" di 5 titik acuan luar ruang | Galat ≤ 50 m di luar ruang | Butuh HP dan titik acuan nyata. | Belum (manual) |
| L2 | Izin lokasi ditolak | Pesan jelas; pilih di peta tetap bisa | Pesan "Izin lokasi ditolak. Izinkan akses lokasi di browser, atau cari lokasi secara manual."; mode pilih titik menghasilkan profil Kabupaten Katingan, Kalimantan Tengah. | Lulus (setelah perbaikan) |
| L3 | Browser tanpa Geolocation atau tanpa HTTPS | Pesan yang wajar, tanpa galat | Tanpa Geolocation: "Browser ini tidak mendukung penentuan lokasi." Tanpa HTTPS (asal `http://` asli, bukan localhost): "Penentuan lokasi butuh koneksi aman (HTTPS)…", dan pantau posisi menulis hal yang sama. | Lulus (setelah perbaikan) |
| L4 | Waktu klik sampai profil tampil | ≤ 5 detik (jaringan seluler) | Pada profil 4G lambat (RTT 150 ms, 1,6 Mbps) di Bogor, Semarang, dan Makassar: 0,5–3,3 detik di semua putaran. | Lulus |
| L5 | Android Chrome, iOS Safari, laptop | Tanpa cacat; catat selisih akurasi | Emulasi Android dan iPhone 390 px lulus P7; perangkat nyata belum diuji. | Sebagian (manual) |
| L6 | Posisi di laut atau di luar Indonesia | Pesan wajar, sistem tidak macet | Samudra Hindia: "Perairan, ±280,7 km dari Kabupaten Sukabumi". Singapura: "Di luar wilayah Indonesia (±19,7 km dari Kota Batam)". Tokyo: "Titik ini di luar wilayah Indonesia…"; pantau posisi: "Posisi di luar wilayah Indonesia". | Lulus (setelah perbaikan) |

## Fitur yang dijanjikan "Berikutnya"

| Fitur | Diuji | Status |
|---|---|---|
| Peringatan CAP BMKG per kab/kota | Daftar Ikhtisar, poligon berarsir, popup sama dengan `/api/cap` | Lulus |
| Notifikasi (SSE) | Panel "Tersambung", simulasi memunculkan toast dan badge; kirim langsung dan sambung ulang dengan `Last-Event-ID` diuji di server | Lulus |
| Tempat evakuasi dari OpenStreetMap | Daftar terdekat dengan penanda zona tinggi (di Kampung Melayu 3 dari 5 tempat evakuasi terdekat berada di zona banjir tinggi InaRISK) | Lulus |
| Rute aman dan pelacakan posisi | Rute ke tempat evakuasi di luar zona, chip "Sisa … ke tujuan", lalu "Di luar rute aman" setelah posisi bergeser ±450 m | Lulus |

## Kinerja sistem (evaluasi, slide 17)

Sinkronisasi dan jeda diukur dari server produksi Azure yang menyala terus 13–23 Okt 2026 ([`research/results/kinerja_sistem_server.md`](../../research/results/kinerja_sistem_server.md)); waktu respons API, cek risiko, dan rute aman diukur di lingkungan uji lokal (`e2e/scripts/kinerja.mjs`), karena server Azure sudah dihapus.

| Ukuran | Target | Hasil |
|---|---|---|
| Sinkronisasi sukses | ≥ 95% | Gempa BMKG 14.640 dari 14.640 (100%), semua slot jadwal berjalan; indikasi SIGAP 21 dari 21; MAGMA 77,9% karena halamannya berubah format sejak 21 Okt |
| Jeda SIGAP (feed BMKG → tersimpan) | ≤ 2 menit | ≤ 60 detik untuk 26 gempa dirasakan |
| Jeda sumber BMKG (kejadian → feed) | (dipisah) | Median 17,1 menit, p90 40,1 menit |
| Waktu respons API | p95 ≤ 1 detik | p95 5–153 ms untuk 10 endpoint (diukur lokal, tanpa jarak jaringan) |
| Cek risiko | ≤ 5 detik | Titik baru p50 0,35 detik, p95 1,1 detik di luar cek pertama; dari cache ±2 ms; cek pertama setelah server dinyalakan saat layanan InaRISK mati ±10 detik (sekali per gangguan setelah perbaikan no. 11) |
| Rute aman | (tidak ada target) | p50 0,37 detik, maks 0,83 detik (Valhalla FOSSGIS) |

## Cacat yang ditemukan dan diperbaiki

| No | Cacat | Ditemukan oleh | Perbaikan |
|---|---|---|---|
| 1 | Mode "pilih titik" tidak bekerja di daratan: klik di atas kab/kota (lapisan indikasi menyala bawaan), poligon peringatan cuaca, atau penanda membuka popup, karena popup Leaflet menghentikan klik sebelum sampai ke peta | L2 | Selama memilih titik, semua bidang dan penanda peta tembus klik (`web/src/styles/map.css`) |
| 2 | Galat JavaScript `Cannot read properties of null (reading 'removeLayer')` saat peta rawan diganti sementara gambar InaRISK masih dimuat lalu gagal, ditambah gambar tak terlihat yang tertinggal di peta (cacat esri-leaflet 3.0.19, versi terbaru) | P1, P8 | Gambar yang masih dimuat dilepas beserta penangannya saat lapisannya dilepas (`web/src/layers/hazards.js`), dengan uji regresi |
| 3 | Di layar pendek (iPhone 390 × 664, HP mendatar) bilah alat kanan menimpa angka skala, skala batang, atribusi, dan lembar bawah | P7 | Grup tombol yang tidak muat pindah ke kolom baru di kirinya (`map.css`) |
| 4 | Di HP legenda menimpa skala batang | P7 | Lebar legenda menyisakan ruang skala batang |
| 5 | Menu filter dari kolom kiri bilah alat terpotong tepi layar | P7 (perbaikan no. 3) | Lebar menu dibatasi ruang di kiri grupnya (`web/src/map/toolbar.js`) |
| 6 | Chip pantau posisi yang kosong tetap tampil (atribut `hidden` kalah oleh `display: flex`): bilah gelap di bawah bilah atas di HP, titik kecil di desktop | P7 | `.track-chip[hidden] { display: none }`, dan P7 kini memeriksa semua elemen `hidden` |
| 7 | "Lokasi saya" di situs `http://` menyalahkan izin ("Izin lokasi ditolak") | L3 | Pesan HTTPS sebelum meminta lokasi (`web/src/main.js`) |
| 8 | Titik di luar kawasan Indonesia (mis. Tokyo) menampilkan "Cek risiko gagal", teks teknis koordinat, dan tombol "Coba lagi" | L6 | Pesan "Titik ini di luar wilayah Indonesia…" tanpa memanggil server (`web/src/features/risk-check.js`) |
| 9 | `robots.txt` tidak ada, skor SEO 92 | P6 | `web/public/robots.txt` (API tidak dirayapi); SEO 100 |
| 10 | Saat identify InaRISK banjir/longsor gagal, cek risiko menghitung kelasnya sebagai "di luar zona bahaya" dan menulis "Normal untuk 3 hari ke depan", padahal indikasi kab/kota di titik pantau yang sama Waspada (zona tinggi, hujan 73,3 mm/hari). Rasa aman yang keliru | P4 (titik pantau terparah, setelah run indikasi baru) | Kelas yang gagal dimuat dibedakan dari "di luar zona": bila hujannya lebat, indikasinya "tidak diketahui" dan kartu menulis "Indikasi … belum dapat dinilai" (`recorder/src/lib/warning-rules.js`, `web/src/ui/risk-detail.js`), dengan test aturan |
| 11 | Layanan InaRISK yang mati dicoba lagi oleh permintaan pengguna setiap 5 menit, jadi selama gangguan cek risiko pertama tiap 5 menit menunggu batas waktu 10 detik; di situs yang pengunjungnya jarang, hampir setiap cek | P4, L4, P6 | Layanan yang gagal dilewati sampai pemeriksaan latar tiap 2 menit mendapat jawaban (`server/src/sources/inarisk.js`), dengan test |

## Belum lulus dan rekomendasi

- **LCP di HP 3,3 detik (P6).** Elemen LCP adalah judul halaman depan, yang muncul dengan animasi setelah layar pembuka menunggu data gempa dan gunung api termuat; globe three.js di latar juga memakan ±2,5 detik CPU di HP lambat. Halamannya sendiri dikirim server dalam 5 ms. Pilihan perbaikan: mulai animasi halaman depan tanpa menunggu data (angka langsung menyusul), dan muat globe setelah halaman tampil di HP.
- **Cek risiko pertama setelah server dinyalakan, saat layanan InaRISK sedang mati, ±10 detik (P4).** Setelah perbaikan no. 11 ini hanya terjadi sekali per gangguan: batas waktu 10 detik tetap dipertahankan karena server BNPB kadang butuh ±8 detik saat "dingin".
- **Lapisan dari server luar > 3 detik saat server itu lambat (P1).** InaRISK, ZKGT, dan NASA GIBS dimuat langsung oleh browser. Pilihan perbaikan: cache petak di server SIGAP.
- **Best Practices 92–96.** Ikon GDACS dari gdacs.org menyertakan cookie pihak ketiga, dan petak peta dasar Esri tidak punya versi resolusi tinggi.

## Lingkungan uji

- Laptop Windows 11 Home, AMD Ryzen 7 6800H, Node.js 25.9, koneksi internet rumah di Indonesia.
- Browser: Chrome 156 dan Edge 156 (terpasang di sistem), Firefox 155 dan WebKit 26.6 dari Playwright 1.63. Profil HP: Pixel 7 (Chromium) dan iPhone 13 (WebKit) pada lebar 390 px. Lighthouse 13.5.
- Web: build produksi (`vite build`, disajikan `vite preview`).
- API: kode di repo ini pada basis data salinan server produksi 23 Okt 2026 (`sigap-produksi-2026-10-23.dump`), dimigrasi sampai 010 dan diisi peringatan CAP dan fasilitas OSM terbaru. Job yang berjalan: gempa BMKG, USGS, EMSC, peringatan CAP, dan MAGMA. Run indikasi 12 jam tidak dijadwalkan, supaya kuota Open-Meteo tidak terpakai; satu run dijalankan manual (24 Okt 00.54 WIB, 3.218 titik) sebelum uji titik pantau P4, supaya indikasi kab/kota dan cek risiko memakai prakiraan yang sama. Untuk skrip P3 dan P6 pembatas laju API dinaikkan, karena skrip memanggil cek risiko berurutan.
- Layanan luar saat uji: indeks banjir dan tanah longsor InaRISK BNPB tidak menjawab (timeout) sepanjang malam; layanan lain normal.

## Uji manual yang tersisa

- **L1** akurasi: di 5 titik acuan luar ruang yang koordinatnya diketahui (mis. tugu atau patok), tekan "Lokasi saya" di HP dan catat koordinat yang tampil di kartu cek risiko; galat = jarak ke titik acuan, target ≤ 50 m.
- **L5** perangkat: ulangi alur peta, popup, cek risiko, rute aman, dan pantau posisi di HP Android (Chrome), iPhone (Safari), dan laptop; catat cacat dan selisih akurasi.
- **Lapis 5** pengguna: ≥ 15 mahasiswa dan warga mengerjakan 5 tugas (cari kab/kota, cek risiko, baca level, ganti lapisan, cari nomor darurat), lalu mengisi kuesioner SUS; target SUS ≥ 68 dan tugas selesai ≥ 90%.
- **P3** banjir dan tanah longsor: jalankan ulang `npm run akurasi` di `e2e/` setelah layanan InaRISK pulih.

## Menjalankan ulang

```bash
# 1. Aplikasi: API dan build produksi web
cd server && npm run dev
cd web && npm run build && npm run preview

# 2. Pengujian
cd e2e
npm install
npx playwright install firefox webkit
npm test            # P1, P2, P4, P5, P7, P8, L2–L4, L6, fitur baru di 6 profil browser
npm run akurasi     # P3
npm run kinerja     # P6
cd ../server && TEST_DATABASE_URL=postgres://sigap:sigap@localhost:5433/sigap_test npm test   # lapis 1–2 dan P8 sisi server
```

Hasil ukur mentah tiap skenario tertulis di `e2e/hasil/` (JSON, tangkapan layar, laporan Lighthouse dan Playwright).
