# Protokol Analisis RQ-L1 — Skill Produk Peringatan Longsor Resmi

**Versi 1.1, 27 September 2026.** Protokol ini dikunci sebelum hasil dihitung. Commit git yang memuat file ini menjadi cap waktunya. Perubahan setelah hasil terlihat hanya boleh dibuat sebagai versi baru, disertai alasan dan catatan apa yang berubah. Perubahan dari versi 1.0 ada di bagian 9.

## 1. Pertanyaan

**RQ-L1.** Seberapa baik dua produk resmi berikut membedakan lokasi-waktu kejadian longsor dari lokasi-waktu tanpa kejadian, untuk periode Januari 2022–Desember 2025?
- **(a)** Prakiraan Wilayah Potensi Terjadi Gerakan Tanah bulanan dari PVMBG.
- **(b)** Peringatan Dini Curah Hujan Tinggi dasarian dari BMKG (CEWS).

Sub-pertanyaan:
- **L1a (spasial).** Pada bulan/dasarian yang sama, apakah kelas produk di lokasi kejadian lebih tinggi daripada di lokasi kontrol dalam provinsi yang sama?
- **L1b (temporal).** Di lokasi yang sama, apakah kelas produk pada bulan/dasarian kejadian lebih tinggi daripada pada bulan/dasarian lain?
- **L1c (nilai tambah prakiraan).** Apakah potensi bulanan PVMBG lebih diskriminatif daripada zona kerentanan gerakan tanah (ZKGT) statis yang mendasarinya?

## 2. Data

| Komponen | Sumber | Cara akses |
|---|---|---|
| Kejadian longsor | Laporan pemeriksaan lapangan PVMBG (Portal MBG, `api/get-field-reports`) dan tanggapan gerakan tanah MAGMA (`/v1/gerakan-tanah/tanggapan`) | `01_inventaris.py` |
| Potensi bulanan PVMBG | Layer WMS `pmbgi:prakiraan_{tahun}_{bulan}`, atribut `zona_perki` | GetFeatureInfo per titik, `02_produk_resmi.py` |
| ZKGT | Atribut `unsur` pada layer bulan yang sama | Sama dengan baris di atas |
| Peringatan hujan BMKG | CEWS layer `pcht_das`, daftar kab/kota per level per dasarian | Arsip perekam (`bmkg-cews/`) atau endpoint `areacoverage.php` |
| Batas wilayah | Kab/kota dan provinsi, Kepmendagri 2025 | PostGIS SIGAP (tabel `wilayah`) |

## 3. Kasus

- **Definisi.** Satu kasus adalah satu kejadian gerakan tanah dengan tanggal lokal antara 1 Januari 2022 dan 31 Desember 2025, dan koordinat yang jatuh di dalam poligon kab/kota Indonesia.
- **Titik dalam satu laporan.** Titik laporan PVMBG dengan `doc_id` dan tanggal yang sama, yang berjarak ≤ 1 km satu sama lain, digabung menjadi satu kejadian. Titik yang dipakai adalah titik pertama.
- **Dua sumber, satu kejadian.** Kejadian MAGMA dan PVMBG yang berselisih ≤ 3 hari dan berjarak ≤ 2 km dianggap sama.
- **Entri yang dibuang.** Entri bertipe "Kajian Lokasi", "Calon Lahan Relokasi", atau "Geolistrik" bukan kejadian dan dibuang. Entri tanpa tipe tetap dipakai dan diberi tanda.
- **Presisi tanggal** (sejak v1.1). Laporan lapangan PVMBG yang hanya mengetahui tahun kejadian diisi tanggal 1 Januari atau 31 Desember, dan yang hanya mengetahui bulannya diisi tanggal 1. Setiap kejadian diberi tanda `presisi_tanggal`:
  - `tahun`: laporan lapangan PVMBG bertanggal 1 Januari atau 31 Desember;
  - `bulan`: laporan lapangan PVMBG bertanggal 1 pada bulan lain (bisa juga tanggal asli, jadi artinya "mungkin hanya bulan");
  - `hari`: selain itu, termasuk semua tanggapan MAGMA yang mencantumkan tanggal dan jam kejadian.

  Analisis utama prakiraan bulanan PVMBG dan ZKGT memakai presisi `hari` dan `bulan`. Analisis utama CEWS (per dasarian) hanya memakai presisi `hari`. Jumlah kasus per presisi dilaporkan.
- **Bulan tanpa layer PVMBG.** Kasus pada bulan yang layernya tidak ada (404) atau kosong dikeluarkan dari analisis PVMBG. "Kosong" berarti titik rujukan di zona Tinggi Banjarnegara (−7,275; 109,67) tidak mengembalikan poligon. Layer yang membalas pesan error GeoServer juga dianggap tidak ada. Hasil pemeriksaan 27 Sep 2026: 2025-11 tidak ada (404), 2025-12 rusak ("The requested Style can not be used with this layer"). Jumlah kasus yang dikeluarkan dilaporkan.

## 4. Kontrol

- **Spasial (L1a).** 10 titik acak per kasus di dalam provinsi yang sama, dengan bulan/dasarian yang sama. Titik dibuat dengan `ST_GeneratePoints`, dan seed diturunkan dari id kasus (CRC32).
- **Spasial kab/kota (sensitivitas).** 10 titik acak tambahan di dalam kab/kota yang sama, dengan cara yang sama.
- **Temporal (L1b).** 6 periode lain per kasus di titik yang sama: bulan lain untuk PVMBG, dasarian lain untuk CEWS.
  - Periode dipilih acak dengan seed tetap dari periode yang tersedia pada 2022–2025.
  - Periode dalam jarak ±1 bulan/dasarian dari kejadian tidak ikut dipilih.
- **Alasan desain.** Kontrol spasial menguji "di mana", kontrol temporal menguji "kapan". Kontrol temporal tidak terpengaruh bias lokasi pelaporan.

## 5. Skor dan metrik

**Skor ordinal:**
- PVMBG dan ZKGT: di luar poligon atau Sangat Rendah = 0, Rendah = 1, Menengah = 2, Tinggi = 3.
- CEWS: Aman = 0, Waspada = 1, Siaga = 2, Awas = 3. Kab/kota yang tidak tercantum dianggap Aman.

**Metrik utama.** AUC berpasangan (indeks konkordansi bersyarat).
- Tiap kasus hanya dibandingkan dengan kontrolnya sendiri: c = rata-rata [1(skor kasus > skor kontrol) + 0,5 × 1(sama)], lalu c dirata-rata di semua kasus.
- Dengan cara ini bulan/dasarian dan wilayah terkendali, sesuai rumusan L1a dan L1b. AUC gabungan (semua kasus vs semua kontrol) dilaporkan sebagai pelengkap.
- CI 95% dari bootstrap klaster: tiap resampel mengambil kasus beserta kontrolnya.
- 2.000 resampel, seed 20260927.

**Metrik ambang.** Peringatan didefinisikan sebagai skor ≥ 2, dan secara terpisah skor = 3. Untuk tiap definisi dilaporkan:
- POD, yaitu fraksi kasus yang diberi peringatan;
- POFD, yaitu fraksi kontrol yang diberi peringatan (perkiraan luas atau lama peringatan);
- TSS = POD − POFD;
- rasio frekuensi = POD / POFD.

**L1c.** Selisih AUC berpasangan (potensi bulanan − ZKGT) pada kasus dan kontrol yang sama, dengan CI dari bootstrap klaster yang sama.

**Kriteria interpretasi** (ditetapkan sekarang):
- Produk punya diskriminasi spasial atau temporal bila batas bawah CI 95% AUC > 0,5.
- Potensi bulanan memberi nilai tambah atas ZKGT bila batas bawah CI 95% selisih AUC > 0.

## 6. Analisis sensitivitas

Semua analisis berikut dilaporkan apa pun hasilnya:
1. Hanya kasus bertipe diketahui.
2. Kontrol spasial diambil dalam kab/kota yang sama, bukan provinsi.
3. Per sumber inventaris (PVMBG lapangan vs MAGMA).
4. Per tahun.
5. Khusus CEWS: EDuMaP (Calvello & Piciullo 2016) pada unit kab/kota × dasarian, dengan cakupan penuh.
6. Tanpa bulan PVMBG yang cakupannya tidak lengkap. Suatu bulan dianggap tidak lengkap bila fraksi kontrol provinsi yang jatuh di dalam poligon layer < 50% dari median fraksi semua bulan. Layer seperti ini membuat lokasi di "lubang" terbaca skor 0.
7. Semua kasus tanpa memandang presisi tanggal, yaitu definisi kasus versi 1.0 (sejak v1.1).

## 7. Keterbatasan yang sudah diketahui

- Inventaris tidak lengkap dan bias ke kejadian yang ditanggapi PVMBG (berdampak atau berisiko).
- Koordinat bisa berupa titik pemeriksaan, bukan titik longsor persis.
- Laporan lapangan 2023–2024 tidak bertipe, jadi sebagian bisa bukan kejadian.
- Layer bulanan PVMBG hanya bisa dibaca per titik (GetMap ditutup), sehingga EDuMaP penuh untuk PVMBG belum bisa dikerjakan.
- ZKGT di dalam layer diperbarui pada 2025.
- Tanggal laporan lapangan tidak memuat jam; periode ditentukan dari tanggal lokal.
- Tanda presisi tanggal bersifat heuristik. Kejadian yang memang terjadi pada tanggal 1 ikut ditandai `bulan`, dan tanggal pengganti lain (mis. tanggal pemeriksaan) tidak terdeteksi.

## 8. Reprodusibilitas

- Semua respons sumber disimpan di cache `research/data/cache/`.
- Tanggal pengambilan dicatat di keluaran.
- Seed acak tetap.
- Skrip dijalankan berurutan: `01_inventaris.py` → `02_produk_resmi.py` → `06_evaluasi_rq_l1.py`. Nomor 03–05 disiapkan untuk RQ-L2/L3.

Protokol RQ-L2 dan RQ-L3 (ambang hidrometeorologi dan model SIGAP-L) ditulis terpisah sebelum model dilatih.

## 9. Riwayat versi

- **1.0 (27 Sep 2026)**: versi awal, commit 88819cd.
- **1.1 (27 Sep 2026)**: menambahkan presisi tanggal (bagian 3) dan sensitivitas 7 (bagian 6).
  - Alasannya ditemukan saat memeriksa riwayat kejadian untuk peta SIGAP: 83 dari 788 kejadian laporan lapangan PVMBG jatuh pada 1 Januari, padahal sebaran merata hanya memberi ±2 kejadian, dan 154 jatuh pada tanggal 1.
  - Di rentang RQ-L1 (2022–2025, 326 kandidat) ada 7 kasus presisi `tahun` dan 25 kasus presisi `bulan`.
  - Saat perubahan ini dibuat, sampel PVMBG penuh belum selesai diambil. Skrip evaluasi baru dijalankan pada sampel uji 3 kasus untuk memeriksa kode, dan belum ada hasil yang dilihat.

**Catatan penerapan (27 Sep 2026).** Catatan ini ditulis setelah hasil dihitung. Isinya tidak mengubah definisi, metrik, atau kriteria apa pun.
- **Dasarian CEWS tanpa produk.** Setelah backfill arsip perekam selesai, 7 dasarian tetap kosong di sumber BMKG: semua daftar kosong, termasuk Aman (dicek langsung untuk 2024-02 dasarian 2). Dasarian tersebut adalah 2022-09 das 2 dan 3, 2022-10 das 1 dan 2, 2024-02 das 2, 2024-06 das 3, dan 2025-05 das 3. Semuanya dikeluarkan dengan aturan yang sama seperti bulan PVMBG yang tidak ada (bagian 3).
- **ZKGT di dalam layer bulanan tidak statis.** Di titik yang sama, kelas ZKGT berbeda antarbulan pada ±12% pasangan bulan, terutama pada layer 2022. Karena itu label "ZKGT (statis)" pada keluaran diganti menjadi "ZKGT (dalam layer bulanan)". Perhitungannya tetap sama.
- **Sensitivitas 3 (per sumber).** Kejadian yang dicatat MAGMA sekaligus laporan lapangan PVMBG tampil sebagai kelompok ketiga (3 kasus), terpisah dari dua kelompok sumber tunggal.
- **Parameter EDuMaP (sensitivitas 5).** Ditetapkan 28 Sep 2026, sebelum EDuMaP dihitung. Saat itu hasil utama RQ-L1 sudah terlihat, begitu juga sebaran jumlah kejadian per kab/kota per dasarian (tanpa level CEWS-nya).
  - Kelas kejadian: 0, 1, 2–3, dan ≥ 4 kejadian (kriteria absolut). Kelas peringatan: Aman, Waspada, Siaga, Awas.
  - Kriteria A: alert = Siaga ke atas, kejadian = ≥ 1 longsor. Kriteria B: warna menurut selisih kelas.
  - Lead time dan over time 0. Satuan waktu dasarian, durasi dalam hari. Zona peringatan: semua 514 kab/kota.
  - Analisis tambahan: alert = Waspada ke atas, dan hanya kab/kota yang punya ≥ 1 kejadian tercatat.
  - Implementasinya diuji dengan contoh Tabel 7–8 Calvello & Piciullo (2016): ke-14 indikator cocok sampai dua desimal.

