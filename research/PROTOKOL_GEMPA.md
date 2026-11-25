# Protokol Analisis RQ-G — Zona Notifikasi Gempa dan Perkiraan Intensitas di Lokasi Pengguna

**Versi 1.0, 25 November 2026.** Protokol ini dikunci sebelum hasil dihitung. Commit git yang memuat file ini menjadi cap waktunya. Perubahan setelah hasil terlihat hanya boleh dibuat sebagai versi baru, disertai alasan dan catatan apa yang berubah (bagian 11). Susunannya mengikuti [`PROTOKOL.md`](PROTOKOL.md) untuk RQ-L1.

## 1. Pertanyaan

Ketika BMKG menerbitkan sebuah gempa, sistem harus memutuskan siapa yang diberi tahu. Zona yang terlalu sempit melewatkan orang yang merasakan guncangan; zona yang terlalu lebar memberi tahu banyak orang yang tidak merasakan apa-apa, dan lama-lama notifikasinya diabaikan.

**RQ-G.** Aturan mana yang paling tepat menentukan zona notifikasi gempa: menjangkau tempat yang benar-benar merasakan guncangan, dengan wilayah yang diberi tahu sesempit mungkin?

- **G1 (utama, konfirmatori).** Pada gempa dirasakan BMKG selama periode uji, apakah aturan berbasis hubungan intensitas–jarak yang dikalibrasi dengan laporan Indonesia (IPE-ID) memberi tahu lebih sedikit kab/kota daripada radius tetap 150 km yang dipakai SIGAP sekarang, tanpa menurunkan cakupan tempat yang merasakan lebih dari 5 poin persentase?
- **G2 (sekunder).** Berapa bagian tempat yang merasakan yang terjangkau oleh aturan rujukan (Firdaus dkk., 2026), dibandingkan dengan radius tetap dan dengan IPE-ID?
- **G3 (sekunder).** Seberapa tepat tiap hubungan memperkirakan intensitas di sebuah lokasi, pada laporan BMKG periode uji dan pada laporan USGS "Did You Feel It?" (DYFI) untuk gempa kuat sejak 2010?

## 2. Data

| Komponen | Sumber | Cara akses |
|---|---|---|
| Gempa dirasakan dan daftar lokasinya | BMKG, feed `gempadirasakan` dan `autogempa`, lewat arsip perekam SIGAP (branch `arsip-data`, folder `bmkg-gempa/`) | `10_gempa_dirasakan.py --sampai <tanggal> --commit <hash>` |
| Koordinat lokasi laporan | `recorder/data/wilayah.json` (514 kab/kota) dan GeoNames Indonesia, dengan aturan di `sigap_riset/geokode.py` | Sama dengan baris di atas |
| Laporan guncangan gempa kuat | USGS ComCat dan DYFI, M ≥ 5, sedikitnya 10 respons, 2010–2026, kotak wilayah aplikasi | `11_usgs_dyfi.py` |
| Titik wakil kab/kota (untuk biaya) | `recorder/data/wilayah.json`, kolom `lat` dan `lon` | Dibaca langsung |

**Dua himpunan BMKG, dipisah menurut waktu gempa (UTC):**

- **Data pengembangan:** gempa sebelum 1 Desember 2026 00.00 UTC. Dipakai untuk mengalibrasi IPE-ID dan menetapkan ambang (bagian 5). Sebagian sudah pernah dilihat; lihat bagian 10.
- **Data uji:** gempa dari 1 Desember 2026 00.00 UTC sampai sebelum 1 Januari 2027 00.00 UTC. Belum ada saat protokol ini ditulis. Tidak boleh dipakai untuk apa pun sebelum periode itu berakhir.

Arsip untuk data uji dibekukan pada commit `arsip-data` pertama yang waktunya sedikitnya 48 jam setelah periode uji berakhir, supaya revisi daftar lokasi oleh BMKG sudah masuk. Hash commit itu dicatat di hasil.

**Bila gempa uji terlalu sedikit.** Bila gempa uji yang punya sedikitnya satu laporan berkoordinat kurang dari 60, periode uji diperpanjang tujuh hari demi tujuh hari sampai jumlahnya 60 atau lebih. Keputusan itu hanya melihat jumlah gempa, bukan hasil.

## 3. Satuan analisis

- **Gempa.** Satu baris `bmkg_kejadian.csv` yang punya sedikitnya satu laporan berkoordinat. Parameter gempa (magnitudo, kedalaman, episenter) adalah revisi terakhir di arsip.
- **Laporan.** Satu lokasi di daftar "Dirasakan" sebuah gempa, dengan koordinat dari `10_gempa_dirasakan.py`. Laporan bertingkat kabupaten memakai koordinat ibu kota kabupatennya.
- **Intensitas teramati.** Titik tengah rentang yang ditulis BMKG ("II-III" menjadi 2,5; "III" menjadi 3).
- **Jarak.** Jarak episenter adalah jarak lingkaran besar dari episenter ke titik lokasi. Jarak hiposenter adalah akar dari (jarak episenter² + kedalaman²).
- **Terjangkau.** Sebuah laporan terjangkau oleh sebuah aturan bila jarak episenternya tidak lebih dari radius aturan itu untuk gempanya, dan radius itu lebih dari nol.
- **Biaya.** Jumlah kab/kota yang titik wakilnya berada di dalam radius. Ukuran ini dipilih karena laut tidak ikut terhitung dan karena notifikasi SIGAP bisa diarahkan per kab/kota. Luas lingkaran (π × radius²) dilaporkan sebagai pelengkap.

Daftar BMKG hanya memuat tempat yang melaporkan merasakan gempa. Karena itu yang bisa diukur dari data BMKG adalah cakupan (tempat yang merasakan dan terjangkau), bukan peringatan yang salah sasaran. Biaya menjadi penggantinya: pada cakupan yang sama, aturan yang memberi tahu lebih sedikit kab/kota lebih baik.

## 4. Aturan yang dibandingkan

Semua aturan berbentuk lingkaran di sekitar episenter. Untuk gempa bermagnitudo M dan berkedalaman h, tiap aturan menghasilkan satu radius di permukaan.

### 4.1 Tetap-150 (yang dipakai SIGAP sekarang)

Radius 150 km untuk semua gempa. Inilah jarak yang dipakai SIGAP untuk pilihan notifikasi "Hanya sekitar lokasi saya" (`NEAR_KM.gempa` di `web/src/features/notifications.js`).

### 4.2 Rujukan (Firdaus dkk., 2026)

Aturan di Firdaus dkk. (2026), "Geofenced Earthquake Notification System Using Haversine-Based Distance Calculation and MMI Intensity Estimation", *International Journal of Geoinformatics* 22(8), 171–184, dipakai seperti tertulis di makalahnya:

- jarak hiposenter Rh = √(d² + h²), dengan d jarak episenter dan h kedalaman (persamaan 3);
- log10(PGA) = 1,30 + 0,41·M − log10(Rh + 0,032 × 10^(0,41·M)) − 0,0034·Rh, PGA dalam Gal (persamaan 4, dari Fukushima dan Tanaka, 1990);
- MMI = 3,66·log10(PGA) − 1,66 untuk semua intensitas (persamaan 5, dari Wald dkk., 1999);
- radius adalah jarak episenter tempat MMI hitungan sama dengan intensitas sasaran, yaitu intensitas tertinggi yang dilaporkan BMKG untuk gempa itu ("II-III" menjadi 3).

Tiga hal yang tidak tertulis di makalah itu ditetapkan di sini:

- Persamaan 4 tercetak "1010^(0,41M)". Dengan 10^(0,41M), delapan dari sepuluh baris Tabel 2 makalah itu terulang sampai dua desimal (`tests/test_intensitas.py`), jadi itulah yang dipakai. Dua baris lainnya (9 dan 10) tidak cocok dengan magnitudo, kedalaman, dan MMI yang tercetak di barisnya sendiri.
- Bila tepat di atas hiposenter pun MMI hitungan sudah di bawah sasaran, radiusnya nol: tidak ada yang diberi tahu. Jumlah gempa seperti itu dilaporkan.
- Radius dicari dengan cara yang sama dengan aturan lain (bagi dua, ketelitian 0,05 km).

Dua catatan tentang rumus asalnya, yang tidak mengubah cara aturan ini diuji. Fukushima dan Tanaka (1990) mendefinisikan jarak sebagai jarak terdekat ke bidang patahan dan magnitudo sebagai magnitudo gelombang permukaan; makalah rujukan memasukkan jarak hiposenter dan magnitudo BMKG. Wald dkk. (1999) menurunkan persamaan 5 untuk intensitas V sampai VIII; makalah rujukan memakainya untuk semua intensitas.

Aturan ini memerlukan daftar intensitas BMKG, jadi hanya bisa dihitung untuk gempa yang daftar "Dirasakan"-nya sudah terbit. Semua gempa di data pengembangan dan data uji memenuhi syarat itu.

### 4.3 IPE pustaka (Allen dkk., 2012)

Hubungan intensitas–jarak dari Allen, Wald, dan Worden (2012), "Intensity attenuation for active crustal regions", *Journal of Seismology* 16, 409–433, versi jarak hiposenter, dipakai apa adanya:

- MMI = c0 + c1·M + c2·ln √(R² + RM²), ditambah c4·ln(R / 50) bila R > 50 km;
- RM = m1 + m2·exp(M − 5);
- c0 = 2,085; c1 = 1,428; c2 = −1,402; c4 = 0,078; m1 = −0,209; m2 = 2,042. Koefisien dibaca dari implementasi rujukan GEM OpenQuake (`hazardlib/gsim/allen_2012_ipe.py`, kelas `AllenEtAl2012Rhypo`); suku tapak tidak dipakai, seperti di implementasi itu.

Radiusnya adalah jarak episenter terjauh yang perkiraan intensitasnya masih di atas atau sama dengan ambang yang ditetapkan di bagian 5.

Menurut abstrak makalahnya, hubungan ini berlaku untuk gempa bermagnitudo momen 5,0 sampai 7,9, intensitas II ke atas, dan jarak kurang dari 300 km, di wilayah kerak aktif. Sebagian besar gempa dirasakan BMKG lebih kecil dari M 5, dan sebagian berpusat dalam, jadi pada sebagian besar data hubungan ini dipakai di luar rentang berlakunya; seberapa jauh ia meleset di sana ikut diukur (G3). Bentuk dan koefisien versi jarak hiposenter di atas baru dicocokkan dengan implementasi OpenQuake; teks lengkap makalahnya belum dibaca, dan itu harus dilakukan sebelum hasilnya ditulis di makalah. Aturan ini ada untuk memisahkan dua hal: manfaat memakai hubungan intensitas–jarak secara umum, dan manfaat mengalibrasinya dengan laporan Indonesia.

### 4.4 IPE-ID (yang diusulkan)

Hubungan intensitas–jarak berbentuk linear yang dikalibrasi dari data pengembangan (bagian 5). Radiusnya adalah jarak episenter terjauh yang perkiraan intensitasnya masih di atas atau sama dengan ambang IPE-ID. Radius dicari dengan bagi dua sampai ketelitian 0,05 km, paling jauh 2.000 km (`sigap_riset/zona.py`).

## 5. Kalibrasi IPE-ID dan penetapan ambang

Semua langkah di bagian ini hanya memakai data pengembangan.

**Bentuk.** I = c0 + c1·M + c2·log10(R), dengan I intensitas (MMI), M magnitudo BMKG, dan R jarak hiposenter dalam km (paling kecil 1 km). Bentuk kedua menambah suku anelastik c3·R.

**Kalibrasi.** Kuadrat terkecil biasa, bobot sama untuk tiap laporan (`sigap_riset/intensitas.py`).

**Memilih bentuk.** Kedua bentuk dinilai dengan validasi silang per gempa: tiap laporan diperkirakan oleh hubungan yang dikalibrasi tanpa semua laporan dari gempa yang sama. Bentuk dengan suku anelastik hanya dipakai bila koefisiennya fisis (c1 > 0, c2 < 0, c3 ≤ 0) dan galat mutlak rata-ratanya lebih kecil sedikitnya 0,02 MMI daripada bentuk dasar. Selain itu dipakai bentuk dasar.

**Syarat fisis.** Hubungan terpilih harus punya c1 > 0 dan c2 < 0. Bila tidak, IPE-ID dinyatakan gagal dikalibrasi, G1 tidak diuji, dan kegagalan itu dilaporkan sebagai temuan.

**Ambang.** Supaya perbandingan dengan Tetap-150 adil, ambang IPE-ID dan ambang hubungan pustaka (4.3) ditetapkan dengan aturan yang sama: ambang tertinggi pada kisi 1,0; 1,1; …; 6,0 yang cakupannya pada data pengembangan masih sama dengan atau lebih besar dari cakupan Tetap-150 pada data yang sama. Bila ambang 1,0 pun tidak mencapainya, dipakai 1,0 dan hal itu dilaporkan. Aturan rujukan (4.2) tidak disetel; ia dipakai seperti tertulis di makalahnya.

**Pembekuan.** Koefisien, bentuk terpilih, dan semua ambang ditulis ke `results/gempa_model.json` dan dikomit sebelum periode uji berakhir. Sesudah itu tidak diubah. Hasil pada data pengembangan dilaporkan terpisah dan tidak dipakai untuk menjawab G1.

## 6. Analisis utama (G1)

Pada data uji, untuk IPE-ID (A) dan Tetap-150 (B):

- **Cakupan** = laporan terjangkau dibagi semua laporan, digabung dari semua gempa.
- **Selisih cakupan** = cakupan A − cakupan B.
- **Nisbah biaya** = jumlah kab/kota yang diberi tahu A dibagi jumlah yang diberi tahu B, dijumlahkan atas semua gempa uji. Selisih rata-rata per gempa ikut dilaporkan.

**Ketidakpastian.** Bootstrap klaster per gempa: gempa diambil ulang beserta semua laporannya, 10.000 resampel, seed 20261201, selang persentil.

**G1 dinyatakan terdukung bila kedua hal ini terpenuhi:**

1. tidak lebih buruk: batas bawah satu sisi 95% dari selisih cakupan (persentil ke-5) lebih besar dari −0,05;
2. lebih hemat: batas atas selang 95% dua sisi dari nisbah biaya (persentil ke-97,5) lebih kecil dari 1.

Bila hanya satu yang terpenuhi, atau tidak ada, G1 dinyatakan tidak terdukung, dan keduanya tetap dilaporkan. Batas 5 poin persentase ditetapkan di sini, sebelum data uji ada.

## 7. Analisis sekunder

**G2.** Cakupan dan biaya aturan rujukan pada data uji, selisih cakupannya terhadap Tetap-150 dan terhadap IPE-ID, serta jumlah gempa yang radiusnya nol. Semua dengan selang 95% bootstrap per gempa.

**G3, laporan BMKG.** Untuk tiap hubungan yang menghasilkan intensitas (rujukan, pustaka, IPE-ID): bias (perkiraan − teramati), galat mutlak rata-rata, dan akar galat kuadrat rata-rata pada laporan data uji, dengan selang 95% bootstrap per gempa. Karena laporan BMKG hanya berasal dari tempat yang merasakan, angka ini mengukur ketepatan di tempat yang melapor, bukan di semua tempat.

**G3, laporan USGS (DYFI).** Dihitung sesudah `gempa_model.json` dibekukan, pada 325 gempa M ≥ 5 dari `11_usgs_dyfi.py`:

- galat intensitas tiap hubungan pada kotak dengan sedikitnya 3 respons, tidak ditandai meragukan, dan berjarak episenter paling jauh 1.000 km, per kelas magnitudo dan per pita jarak;
- untuk tiap aturan: bagian kotak "merasakan" (CDI ≥ 2) yang berada di dalam zona, dan bagian kotak "tidak merasakan" (CDI < 2) yang ikut berada di dalam zona. Analisis ini memakai semua kotak dalam 1.000 km, berapa pun jumlah responsnya.

Magnitudo USGS dipakai apa adanya. Pada tiga gempa yang ada di kedua sumber, magnitudo BMKG lebih besar 0,3 sampai 0,5 daripada USGS, jadi hasil untuk IPE-ID juga dilaporkan dengan magnitudo USGS ditambah 0,3 dan ditambah 0,5. Data DYFI tidak dipakai untuk kalibrasi.

## 8. Analisis sensitivitas

Semua dijalankan pada data uji, untuk G1 dan G2, dan dilaporkan di samping analisis utama tanpa mengubah kesimpulan G1.

1. Toleransi lokasi: laporan dihitung terjangkau bila jaraknya tidak lebih dari radius + 25 km (laporan bertingkat kabupaten hanya diwakili satu titik).
2. Tanpa laporan yang ditandai `perlu_tinjau` oleh pencocokan nama lokasi.
3. Hanya laporan yang tingkat tempatnya lebih rinci daripada kabupaten.
4. Laporan bertingkat kabupaten memakai titik wakil poligon (`lat_wakil`, `lon_wakil`), bukan ibu kota.
5. Hanya gempa yang parameternya tidak direvisi di arsip (`versi` = 1). Notifikasi dikirim dengan parameter pertama, sedangkan analisis utama memakai revisi terakhir.
6. Per kelas magnitudo (< 4; 4 sampai 4,9; ≥ 5) dan per kelas kedalaman (≤ 60 km; > 60 km), tanpa uji hipotesis.
7. Cakupan dirata-rata per gempa (tiap gempa berbobot sama), bukan digabung.
8. Biaya sebagai luas lingkaran, bukan jumlah kab/kota.
9. Untuk G3: intensitas teramati memakai batas atas rentang BMKG, bukan titik tengahnya.

## 9. Keterbatasan yang sudah diketahui

- **Hanya laporan positif.** Tempat yang tidak disebut BMKG belum tentu tidak merasakan. Cakupan bisa diukur; peringatan salah sasaran hanya bisa didekati lewat biaya dan lewat kotak "tidak merasakan" DYFI.
- **Kalibrasi dari laporan positif** cenderung membuat intensitas di jarak jauh terlalu tinggi, karena di jarak jauh hanya tempat yang kebetulan merasakan yang melapor. Ambang ditetapkan dari cakupan, jadi bias ini sebagian terserap; untuk perkiraan intensitas ia tetap ada.
- **Lokasi laporan** adalah titik wakil sebuah nama tempat; ketidakpastiannya untuk kab/kota di data pengembangan median 12 km, terjauh 110 km.
- **Zona lingkaran.** Guncangan nyata tidak simetris (arah patahan, kondisi tanah). Semua aturan yang dibandingkan sama-sama mengabaikannya.
- **Biaya tanpa penduduk.** Satu kab/kota dihitung satu, berapa pun penduduknya.
- **Periode uji satu bulan**, dengan gempa kuat yang kemungkinan hanya beberapa. Kesimpulan G1 berlaku untuk campuran gempa pada periode itu; perilaku pada gempa kuat dilihat dari DYFI.
- **Magnitudo BMKG dan USGS berbeda** (bagian 7).
- **Parameter revisi terakhir**, bukan parameter saat notifikasi dikirim (sensitivitas 5).

## 10. Yang sudah dilihat sebelum protokol ini

Supaya jelas mana yang konfirmatori:

- Pada 24 November 2026 dibuat hitungan penjajakan kasar pada arsip sampai 17 November (155 gempa, 361 laporan, 71% nama lokasi tercocokkan saat itu). Hasilnya: radius tetap 150 km menjangkau 79,7% laporan (85,5% dengan toleransi 25 km); aturan rujukan 18,4% (41,8%), dengan radius median 33 km dan radius nol pada 18 gempa; perkiraan intensitas aturan rujukan lebih rendah rata-rata 1,12 MMI dari laporan, galat mutlak rata-rata 1,43.
- Jadi arah jawaban G2 sudah terlihat pada data pengembangan. Karena itulah G1 dan G2 dijawab hanya dari data uji, yang belum ada saat protokol ini ditulis.
- Belum ada hubungan intensitas yang dikalibrasi, belum ada ambang yang ditetapkan, dan belum ada perbandingan prediksi dengan data DYFI. Dari DYFI baru dihitung jumlah gempa, kotak, dan respons (`results/gempa_usgs_ringkasan.md`).

## 11. Reprodusibilitas dan riwayat versi

- Modul hitung: `sigap_riset/zona.py` (radius, cakupan, biaya, bootstrap) dan `sigap_riset/intensitas.py` (hubungan intensitas, kalibrasi, validasi silang), dengan uji di `tests/test_zona.py` dan `tests/test_intensitas.py`. Skrip `12_evaluasi_gempa.py`, yang menjalankan langkah-langkah di atas dan menulis hasilnya, ditambahkan sebelum kalibrasi dijalankan dan harus mengikuti protokol ini.
- Himpunan beku dibuat dengan `10_gempa_dirasakan.py --sampai` dan `--commit`; commit arsip, waktu, dan sidik berkas dicatat di hasil.
- Seed bootstrap 20261201. Tidak ada langkah acak lain.

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1.0 | 25 Nov 2026 | Versi pertama |
