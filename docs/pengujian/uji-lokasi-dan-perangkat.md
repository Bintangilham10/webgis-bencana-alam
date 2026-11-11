# Uji posisi dan perangkat (L1, L5)

Dua skenario di slide 16 yang butuh perangkat nyata dan tidak bisa diotomatiskan:

| ID | Uji | Kriteria lulus |
|---|---|---|
| L1 | Akurasi "Lokasi saya" dibandingkan dengan 5 titik acuan luar ruang | Galat ≤ 50 m di luar ruang |
| L5 | Android Chrome, iOS Safari, laptop | Tanpa cacat; catat selisih akurasi |

**Prasyarat.** SIGAP harus online lewat HTTPS (lihat [`deploy/README.md`](../../deploy/README.md)): HP tidak bisa membuka `localhost` laptop, dan browser menolak penentuan lokasi di situs `http://`. Nyalakan GPS/lokasi akurasi tinggi di HP.

## L1: akurasi posisi

**Memilih 5 titik acuan.** Pilih tempat terbuka (langit terlihat, jauh dari gedung tinggi) yang punya penanda jelas di citra satelit: tengah tugu, sudut lapangan, pusat bundaran, atau patok. Sebar di beberapa lokasi, mis. kampus, taman, dan jalan besar.

**Koordinat acuan.** Ambil koordinat penanda itu dari citra satelit pada zoom terdekat:

- lewat SIGAP di laptop: peta dasar "Citra satelit" (tombol "Ganti peta dasar" di bilah alat kanan), arahkan kursor tepat ke penanda, dan baca baris `WGS84 …` di kotak koordinat kanan bawah (5 desimal, ±1 m); atau
- lewat Google Maps mode satelit: klik kanan (laptop) atau tekan lama (HP) tepat di penanda; koordinatnya muncul di menu atau kotak pencarian.

Galat letak citra satelit resolusi tinggi biasanya jauh di bawah 50 m. Untuk memastikan, ambil koordinat dari keduanya; bila selisihnya lebih dari ±10 m, pilih penanda lain.

**Di tiap titik, untuk tiap perangkat:**

1. Berdiri tepat di penanda. Buka SIGAP → "Buka peta", lalu nyalakan **Pantau posisi saya** (ikon panah di bilah alat kanan) dan izinkan akses lokasi bila diminta.
2. Tunggu sampai angka "akurasi ±… m" di chip bagian atas layar tidak turun lagi (biasanya kurang dari 1 menit). Catat angka itu.
3. Tekan **Lokasi saya** (tab Ikhtisar, atau ikon bidik di bilah alat kanan) dan catat koordinat di bawah judul kartu "Lokasi Anda", mis. `-6.97310, 107.63020 · 714 m dpl`.
4. Matikan pantau posisi (ikon panah lagi), lalu pindah ke titik berikutnya.

Pantau posisi dinyalakan lebih dulu supaya GPS sudah mengunci saat "Lokasi saya" ditekan: "Lokasi saya" boleh memakai posisi yang diambil browser sampai 1 menit sebelumnya, dan sebelum GPS mengunci posisinya bisa masih kasar.

**Mencatat dan menghitung.** Salin [`templat-galat-gps.csv`](templat-galat-gps.csv) ke spreadsheet, isi satu baris per perangkat per titik, lalu unduh sebagai CSV:

| perangkat | titik | lat_acuan | lon_acuan | lat_sigap | lon_sigap | akurasi_m |
|---|---|---|---|---|---|---|
| HP Android | Tugu kampus | -6.97300 | 107.63000 | -6.97310 | 107.63020 | 12 |

```bash
cd e2e
npm run gps -- "C:\path\ke\pengukuran.csv"
```

Skrip menghitung galat tiap titik (jarak haversine ke titik acuan), lalu median, galat terbesar, dan jumlah titik yang lulus untuk tiap perangkat. Hasilnya tampil di layar dan ditulis ke `e2e/hasil/l1-galat-gps.md`. Angka desimal berkoma dari spreadsheet berbahasa Indonesia juga diterima.

## L5: perangkat

Kerjakan langkah berikut di **HP Android (Chrome)**, **iPhone (Safari)**, dan **laptop (Chrome atau Edge)**. Isi "OK" atau tulis masalahnya (apa yang terjadi, di layar mana; tangkapan layar bila bisa). Catat juga merek/model, versi sistem, dan versi browser.

| No | Langkah | Android | iPhone | Laptop |
|---|---|---|---|---|
| 1 | Halaman depan tampil utuh, "Buka peta" membuka peta | | | |
| 2 | Penanda gempa dan gunung api tampil; popup bisa dibuka dan ditutup | | | |
| 3 | Cari "Kabupaten Garut" → kartu cek risiko tampil dan bisa digulir sampai bawah | | | |
| 4 | "Lokasi saya" → izin lokasi → kartu "Lokasi Anda" | | | |
| 5 | Tab Lapisan: nyalakan dan matikan beberapa lapisan; legenda ikut berubah | | | |
| 6 | Di kartu cek risiko, bagian "Evakuasi dan fasilitas terdekat": ikon rute aman di salah satu tempat → rute tampil di peta dan ringkasannya di kartu (bila ada tempat di daerah itu) | | | |
| 7 | Pantau posisi (ikon panah): chip di atas menampilkan akurasi, atau sisa jarak bila ada rute; setelah berjalan beberapa puluh meter, posisi di peta ikut bergeser | | | |
| 8 | Tombol lonceng → panel notifikasi menulis "Tersambung"; "Uji notifikasi (simulasi)" memunculkan pemberitahuan | | | |
| 9 | Ganti mode gelap/terang | | | |
| 10 | Putar layar ke posisi mendatar: bilah alat, legenda, dan skala tidak saling menimpa | | | |
| | Selisih akurasi (median galat L1, m) | | | |

Masalah yang ditemukan dicatat di [`README.md`](README.md) pada baris L5, dan median galat per perangkat dari L1 menjadi baris "selisih akurasi".
