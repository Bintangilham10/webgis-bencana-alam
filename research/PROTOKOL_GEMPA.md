# Protokol Analisis RQ-G — Zona Notifikasi Gempa dan Perkiraan Intensitas di Lokasi Pengguna

**Versi 1.1, 26 November 2026.** Protokol ini dikunci sebelum hasil uji dihitung. Commit git yang memuat file ini menjadi cap waktunya. Versi 1.0 dikomit 25 November 2026 (`4bdd1d4e0`). Versi 1.1 mengubah pertanyaan utama setelah kalibrasi sementara pada data pengembangan, sebelum periode uji dimulai dan sebelum ada satu pun gempa uji; apa yang berubah dan mengapa ada di bagian 11, dan apa yang sudah dilihat ada di bagian 10. Perubahan setelah hasil terlihat hanya boleh dibuat sebagai versi baru, disertai alasan dan catatan apa yang berubah. Susunannya mengikuti [`PROTOKOL.md`](PROTOKOL.md) untuk RQ-L1.

## 1. Pertanyaan

Ketika BMKG menerbitkan sebuah gempa, sistem harus memutuskan siapa yang diberi tahu. Zona yang terlalu sempit melewatkan orang yang merasakan guncangan; zona yang terlalu lebar memberi tahu banyak orang yang tidak merasakan apa-apa, dan lama-lama notifikasinya diabaikan.

**RQ-G.** Aturan mana yang paling tepat menentukan zona notifikasi gempa: menjangkau tempat yang benar-benar merasakan guncangan, dengan wilayah yang diberi tahu sesempit mungkin?

Dua aturan yang paling ingin dibandingkan adalah radius tetap 150 km yang dipakai SIGAP sekarang dan zona dari hubungan intensitas–jarak yang dikalibrasi dengan laporan Indonesia (IPE-ID). Sejak versi 1.1 perbandingan utamanya dipisah menurut besar gempa, karena pada data pengembangan kedua aturan itu berbeda ke arah yang berlawanan untuk gempa kuat dan gempa kecil (bagian 10).

- **G1a (utama, konfirmatori).** Pada gempa M ≥ 5 selama periode uji, apakah zona IPE-ID menjangkau lebih banyak tempat yang merasakan daripada radius tetap 150 km?
- **G1b (utama, konfirmatori).** Pada gempa M < 5 selama periode uji, apakah IPE-ID memberi tahu lebih sedikit kab/kota daripada radius tetap 150 km? Selisih cakupannya dilaporkan bersama, karena penghematan itu dibayar dengan cakupan.
- **G1 gabungan (sekunder; pertanyaan utama di versi 1.0).** Pada semua gempa uji sekaligus, apakah IPE-ID memberi tahu lebih sedikit kab/kota tanpa menurunkan cakupan tempat yang merasakan lebih dari 5 poin persentase?
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

**Bila gempa uji terlalu sedikit.** Bila gempa uji yang punya sedikitnya satu laporan berkoordinat kurang dari 60, atau yang bermagnitudo 5 ke atas di antaranya kurang dari 8 (sejak versi 1.1), periode uji diperpanjang tujuh hari demi tujuh hari sampai kedua jumlah itu terpenuhi. Keputusan itu hanya melihat jumlah gempa, bukan hasil.

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

**Syarat fisis.** Hubungan terpilih harus punya c1 > 0 dan c2 < 0. Bila tidak, IPE-ID dinyatakan gagal dikalibrasi, G1a, G1b, dan G1 gabungan tidak diuji, dan kegagalan itu dilaporkan sebagai temuan.

**Ambang.** Supaya perbandingan dengan Tetap-150 adil, ambang IPE-ID dan ambang hubungan pustaka (4.3) ditetapkan dengan aturan yang sama: ambang tertinggi pada kisi 1,0; 1,1; …; 6,0 yang cakupannya pada data pengembangan masih sama dengan atau lebih besar dari cakupan Tetap-150 pada data yang sama. Bila ambang 1,0 pun tidak mencapainya, dipakai 1,0 dan hal itu dilaporkan. Aturan rujukan (4.2) tidak disetel; ia dipakai seperti tertulis di makalahnya.

**Pembekuan.** Koefisien, bentuk terpilih, semua ambang, dan rata-rata intensitas teramati di data pengembangan (tebakan konstan untuk G3, sejak versi 1.1) ditulis ke `results/gempa_model.json` dan dikomit sebelum periode uji berakhir. Sesudah itu tidak diubah. Kalibrasi yang dibekukan dihitung dari arsip yang diambil sesudah periode uji dimulai, supaya semua gempa pengembangan sudah masuk. Hasil pada data pengembangan dilaporkan terpisah dan tidak dipakai untuk menjawab G1a, G1b, atau G1 gabungan.

## 6. Analisis utama (G1a dan G1b)

Data uji dibagi dua menurut magnitudo BMKG (revisi terakhir): gempa M ≥ 5 dan gempa M < 5. Batas itu sama dengan batas kelas di sensitivitas 6 versi 1.0 dan dengan batas bawah data USGS; ia tidak dicari dari hasil. Ambang IPE-ID tetap satu untuk semua gempa (bagian 5).

Untuk IPE-ID (A) dan Tetap-150 (B), di tiap kelas:

- **Cakupan** = laporan terjangkau dibagi semua laporan, digabung dari semua gempa di kelas itu.
- **Selisih cakupan** = cakupan A − cakupan B.
- **Nisbah biaya** = jumlah kab/kota yang diberi tahu A dibagi jumlah yang diberi tahu B, dijumlahkan atas semua gempa di kelas itu. Selisih rata-rata per gempa ikut dilaporkan.

**Ketidakpastian.** Bootstrap klaster per gempa: gempa di kelas itu diambil ulang beserta semua laporannya, 10.000 resampel, seed 20261201, selang persentil. Karena pertanyaan utamanya dua, masing-masing memakai selang kepercayaan 97,5% dua sisi (koreksi Bonferroni untuk taraf 5%).

- **G1a terdukung** bila, pada gempa M ≥ 5, batas bawah selang 97,5% dari selisih cakupan lebih besar dari 0.
- **G1b terdukung** bila, pada gempa M < 5, batas atas selang 97,5% dari nisbah biaya lebih kecil dari 1. Selisih cakupan pada kelas itu dilaporkan dengan selang yang sama, tanpa syarat: berapa cakupan yang dikorbankan untuk penghematan itu adalah hasil yang dilaporkan, bukan hipotesis.

Keduanya dilaporkan apa pun hasilnya. Kelas yang tidak punya gempa atau laporan pada periode uji dilaporkan kosong.

## 7. Analisis sekunder

**G1 gabungan (rumusan versi 1.0).** Pada semua gempa uji sekaligus: selisih cakupan dan nisbah biaya IPE-ID terhadap Tetap-150 seperti di bagian 6, dengan selang 95%. Dua syarat versi 1.0 tetap dihitung dan dilaporkan: tidak lebih buruk (batas bawah satu sisi 95% dari selisih cakupan, yaitu persentil ke-5, lebih besar dari −0,05) dan lebih hemat (batas atas selang 95% dua sisi dari nisbah biaya lebih kecil dari 1). Dari data pengembangan, peluang kedua syarat itu terpenuhi dengan sekitar 100 gempa diperkirakan hanya 2% (bagian 10), jadi hasil "tidak terpenuhi" di sini tidak boleh dibaca sebagai bukti bahwa IPE-ID tidak lebih baik.

**G2.** Cakupan dan biaya aturan rujukan pada data uji, selisih cakupannya terhadap Tetap-150 dan terhadap IPE-ID, serta jumlah gempa yang radiusnya nol. Semua dengan selang 95% bootstrap per gempa.

**G3, laporan BMKG.** Untuk tiap hubungan yang menghasilkan intensitas (rujukan, pustaka, IPE-ID), dan untuk tebakan konstan (sejak versi 1.1): bias (perkiraan − teramati), galat mutlak rata-rata, dan akar galat kuadrat rata-rata pada laporan data uji, dengan selang 95% bootstrap per gempa. Karena laporan BMKG hanya berasal dari tempat yang merasakan, angka ini mengukur ketepatan di tempat yang melapor, bukan di semua tempat.

Tebakan konstan adalah rata-rata intensitas teramati di data pengembangan, sama untuk semua laporan. Ia ada karena laporan BMKG hampir semuanya berintensitas II sampai III: hubungan yang galatnya tidak jauh di bawah tebakan konstan belum menunjukkan bahwa ia bisa memperkirakan intensitas.

**G3, laporan USGS (DYFI).** Dihitung sesudah `gempa_model.json` dibekukan, pada 325 gempa M ≥ 5 dari `11_usgs_dyfi.py`:

- galat intensitas tiap hubungan pada kotak dengan sedikitnya 3 respons, tidak ditandai meragukan, dan berjarak episenter paling jauh 1.000 km, per kelas magnitudo dan per pita jarak;
- untuk Tetap-150, IPE pustaka, dan IPE-ID: bagian kotak "merasakan" (CDI ≥ 2) yang berada di dalam zona, dan bagian kotak "tidak merasakan" (CDI < 2) yang ikut berada di dalam zona. Analisis ini memakai semua kotak dalam 1.000 km, berapa pun jumlah responsnya. Aturan rujukan tidak dihitung di sini, karena memerlukan intensitas tertinggi laporan BMKG, yang tidak ada untuk gempa USGS.

Magnitudo USGS dipakai apa adanya. Pada tiga gempa yang ada di kedua sumber, magnitudo BMKG lebih besar 0,3 sampai 0,5 daripada USGS, jadi hasil untuk IPE-ID juga dilaporkan dengan magnitudo USGS ditambah 0,3 dan ditambah 0,5. Data DYFI tidak dipakai untuk kalibrasi.

## 8. Analisis sensitivitas

Semua dijalankan pada data uji, untuk G1a, G1b, dan G2, dan dilaporkan di samping analisis utama tanpa mengubah kesimpulan G1a dan G1b.

1. Toleransi lokasi: laporan dihitung terjangkau bila jaraknya tidak lebih dari radius + 25 km (laporan bertingkat kabupaten hanya diwakili satu titik).
2. Tanpa laporan yang ditandai `perlu_tinjau` oleh pencocokan nama lokasi.
3. Hanya laporan yang tingkat tempatnya lebih rinci daripada kabupaten, yaitu semua tingkat selain `kabupaten`: kota, ibu kota, kecamatan, desa, permukiman, dan pulau.
4. Laporan bertingkat kabupaten memakai titik wakil poligon (`lat_wakil`, `lon_wakil`), bukan ibu kota.
5. Hanya gempa yang parameternya tidak direvisi di arsip (`versi` = 1). Notifikasi dikirim dengan parameter pertama, sedangkan analisis utama memakai revisi terakhir.
6. Per kelas magnitudo (< 4; 4 sampai 4,9; ≥ 5) dan per kelas kedalaman (≤ 60 km; > 60 km), tanpa uji hipotesis.
7. Cakupan dirata-rata per gempa (tiap gempa berbobot sama), bukan digabung; untuk tiap kelas magnitudo dan untuk semua gempa.
8. Biaya sebagai luas lingkaran, bukan jumlah kab/kota; untuk tiap kelas magnitudo dan untuk semua gempa.
9. Untuk G3: intensitas teramati memakai batas atas rentang BMKG, bukan titik tengahnya.

## 9. Keterbatasan yang sudah diketahui

- **Hanya laporan positif.** Tempat yang tidak disebut BMKG belum tentu tidak merasakan. Cakupan bisa diukur; peringatan salah sasaran hanya bisa didekati lewat biaya dan lewat kotak "tidak merasakan" DYFI.
- **Kalibrasi dari laporan positif** cenderung membuat intensitas di jarak jauh terlalu tinggi, karena di jarak jauh hanya tempat yang kebetulan merasakan yang melapor. Ambang ditetapkan dari cakupan, jadi bias ini sebagian terserap; untuk perkiraan intensitas ia tetap ada.
- **Lokasi laporan** adalah titik wakil sebuah nama tempat; ketidakpastiannya untuk kab/kota di data pengembangan median 12 km, terjauh 110 km.
- **Zona lingkaran.** Guncangan nyata tidak simetris (arah patahan, kondisi tanah). Semua aturan yang dibandingkan sama-sama mengabaikannya.
- **Biaya tanpa penduduk.** Satu kab/kota dihitung satu, berapa pun penduduknya.
- **IPE-ID adalah hubungan zona terasa, bukan penaksir guncangan kuat.** Laporan yang dipakai mengalibrasinya hampir semuanya berintensitas II sampai III, jadi koefisiennya landai. Pada kalibrasi sementara (bagian 10), gempa M 7 pada jarak 30 km diperkirakan 4,1, sedangkan hubungan pustaka memberi sekitar 7. Nilai IPE-ID tidak boleh ditampilkan ke pengguna sebagai perkiraan intensitas gempa kuat; ia hanya dipakai untuk menentukan batas zona. Analisis DYFI di bagian 7 mengukur seberapa jauh ia meleset pada gempa kuat.
- **Ketepatan pada laporan BMKG mudah dicapai.** Karena intensitas yang dilaporkan hampir seragam, tebakan konstan pun galatnya kecil (0,48 MMI pada data pengembangan, dibanding 0,42 untuk IPE-ID). G3 pada laporan BMKG harus dibaca terhadap tebakan konstan itu.
- **Periode uji satu bulan**, dengan gempa M ≥ 5 yang kemungkinan hanya belasan. G1a bertumpu pada gempa sebanyak itu, dan selang bootstrap dari belasan gempa cenderung sedikit terlalu sempit; perilaku pada gempa kuat juga dilihat dari DYFI.
- **Magnitudo BMKG dan USGS berbeda** (bagian 7).
- **Parameter revisi terakhir**, bukan parameter saat notifikasi dikirim (sensitivitas 5).

## 10. Yang sudah dilihat sebelum protokol ini

Supaya jelas mana yang konfirmatori:

- Pada 24 November 2026 dibuat hitungan penjajakan kasar pada arsip sampai 17 November (155 gempa, 361 laporan, 71% nama lokasi tercocokkan saat itu). Hasilnya: radius tetap 150 km menjangkau 79,7% laporan (85,5% dengan toleransi 25 km); aturan rujukan 18,4% (41,8%), dengan radius median 33 km dan radius nol pada 18 gempa; perkiraan intensitas aturan rujukan lebih rendah rata-rata 1,12 MMI dari laporan, galat mutlak rata-rata 1,43.
- Jadi arah jawaban G2 sudah terlihat pada data pengembangan. Karena itulah G1 dan G2 dijawab hanya dari data uji, yang belum ada saat protokol ini ditulis.
- Saat versi 1.0 dikomit, belum ada hubungan intensitas yang dikalibrasi, belum ada ambang yang ditetapkan, dan belum ada perbandingan prediksi dengan data DYFI. Dari DYFI baru dihitung jumlah gempa, kotak, dan respons (`results/gempa_usgs_ringkasan.md`).

**Yang dilihat sesudah versi 1.0 dan sebelum versi 1.1** (25–26 November 2026). Kalibrasi sementara dijalankan dengan `12_evaluasi_gempa.py kalibrasi --sementara` pada data pengembangan yang sudah ada: 186 gempa, 425 laporan, arsip commit `8424f023e976`. Hasilnya tidak dibekukan dan akan berubah setelah data pengembangan lengkap. Data uji belum ada, dan data DYFI tetap belum dibandingkan dengan prediksi apa pun.

- IPE-ID sementara: I = 2,554 + 0,424·M − 0,994·log10(R), bentuk dasar (galat validasi silang 0,418; dengan suku anelastik 0,415). Ambang sementara: IPE-ID 2,4 dan IPE pustaka 1,9, untuk sasaran cakupan 81,4%.
- Semua gempa: cakupan dan kab/kota per gempa Tetap-150 81,4% dan 9,2; Rujukan 21,4% dan 0,6 (radius nol pada 19 gempa); IPE pustaka 81,4% dan 9,0; IPE-ID 84,0% dan 8,0. Selisih cakupan IPE-ID terhadap Tetap-150 2,6 poin (selang 95% −9,7 s.d. 14,4), nisbah biaya 0,86 (0,56 s.d. 1,31).
- Dengan simpangan baku bootstrap itu diskalakan menurut akar jumlah gempa, dan efek sebenarnya dianggap sama dengan taksiran di atas, peluang kedua syarat G1 versi 1.0 terpenuhi kira-kira 2% untuk 100 gempa dan 24% untuk 800 gempa. Pertanyaan utama versi 1.0 jadi hampir pasti tidak terjawab dengan data satu bulan.
- Penyebabnya terlihat bila gempa dipisah. Gempa M ≥ 5 (26 gempa, 113 laporan): Tetap-150 menjangkau 44,2% laporan dan IPE-ID 98,2% (selisih 54,0 poin, selang 97,5% 32,0 s.d. 70,1), dengan 4,7 dan 33,4 kab/kota per gempa. Gempa M < 5 (160 gempa, 312 laporan): IPE-ID memberi tahu 3,8 kab/kota per gempa dan Tetap-150 9,9 (nisbah 0,38, selang 97,5% 0,31 s.d. 0,46), dengan cakupan 78,8% dan 94,9% (selisih −16,0 poin, −27,4 s.d. −7,1). Bila digabung, dua perbedaan yang berlawanan itu saling menghapus.
- Galat mutlak rata-rata intensitas pada laporan yang sama: rantai rujukan 1,39 (bias −0,90), IPE pustaka 0,66, IPE-ID 0,41, tebakan konstan 0,48. Untuk gempa M 7 pada jarak 30 km, IPE-ID sementara memberi 4,1, IPE pustaka 7,2, rantai rujukan 6,9.

Karena pemisahan di M 5 dan arah kedua perbedaan itu sudah terlihat pada data pengembangan, G1a dan G1b, seperti G2, dijawab hanya dari data uji.

## 11. Reprodusibilitas dan riwayat versi

- Modul hitung: `sigap_riset/zona.py` (radius, cakupan, biaya, bootstrap) dan `sigap_riset/intensitas.py` (hubungan intensitas, kalibrasi, validasi silang), dengan uji di `tests/test_zona.py` dan `tests/test_intensitas.py`. Skrip `12_evaluasi_gempa.py` menjalankan langkah-langkah di atas dan menulis hasilnya (`kalibrasi`, `dyfi`, `uji`), dengan uji di `tests/test_evaluasi_gempa.py`. Tiap langkah menolak berjalan sebelum waktunya; `kalibrasi --sementara` hanya menulis ke folder data yang tidak dikomit.
- Himpunan beku dibuat dengan `10_gempa_dirasakan.py --sampai` dan `--commit`; commit arsip, waktu, dan sidik berkas dicatat di hasil.
- Seed bootstrap 20261201. Tidak ada langkah acak lain.

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1.0 | 25 Nov 2026 | Versi pertama (commit `4bdd1d4e0`) |
| 1.1 | 26 Nov 2026 | Dibuat sebelum periode uji dimulai, setelah kalibrasi sementara pada data pengembangan (bagian 10). **Alasan:** pertanyaan utama versi 1.0 menggabungkan semua gempa, padahal kedua aturan berbeda ke arah berlawanan untuk gempa kuat dan gempa kecil, sehingga peluang menjawabnya dengan data satu bulan hanya sekitar 2%. **Yang berubah:** (1) pertanyaan utama dipisah di M 5 menjadi G1a (cakupan pada gempa M ≥ 5) dan G1b (biaya pada gempa M < 5), masing-masing dengan selang 97,5%; batas M 5 sudah ada di sensitivitas 6 versi 1.0. (2) Pertanyaan utama versi 1.0 tetap dihitung dengan rumusan yang sama, sebagai analisis sekunder "G1 gabungan". (3) Periode uji juga diperpanjang bila gempa uji M ≥ 5 kurang dari 8. (4) G3 mendapat pembanding tebakan konstan. (5) Dua keterbatasan ditulis terang: IPE-ID adalah hubungan zona terasa, bukan penaksir guncangan kuat, dan ketepatan pada laporan BMKG mudah dicapai. **Yang diperjelas tanpa mengubah isi:** tingkat tempat pada sensitivitas 3, aturan rujukan tidak dihitung pada analisis zona DYFI, dan kalibrasi beku memakai arsip yang diambil sesudah periode uji dimulai. Aturan yang dibandingkan, cara kalibrasi, cara menetapkan ambang, data pengembangan, dan periode uji tidak berubah. |
