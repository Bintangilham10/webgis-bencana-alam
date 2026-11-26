# Riset SIGAP-L — peringatan dini longsor berbasis data terbuka

Folder ini berisi skrip analisis untuk paper. Rancangan lengkapnya ada di rencana proyek (SIGAP-L v2). Protokol yang dikunci sebelum hasil dihitung ada di [`PROTOKOL.md`](PROTOKOL.md) (RQ-L1) dan [`PROTOKOL_GEMPA.md`](PROTOKOL_GEMPA.md) (RQ-G).

| Pertanyaan | Isi | Status |
|---|---|---|
| RQ-L1 | Skill prakiraan bulanan potensi gerakan tanah PVMBG dan peringatan curah hujan tinggi BMKG (CEWS), 2022–2025 | Hasil di [`results/rq_l1_ringkasan.md`](results/rq_l1_ringkasan.md) dan EDuMaP CEWS di [`results/rq_l1_edumap_cews.md`](results/rq_l1_edumap_cews.md) |
| RQ-L2 | Ambang hidrometeorologi (kelembapan tanah ERA5-Land × hujan) vs ambang hujan saja | Belum |
| RQ-L3 | Skill model SIGAP-L harian pada lead 0–2 hari vs produk resmi | Belum |
| RQ2 | Kinerja sistem: ketersediaan sinkronisasi dan latensi data | Server produksi Azure 13–23 Okt 2026 di [`results/kinerja_sistem_server.md`](results/kinerja_sistem_server.md); laptop pengembangan 26 Sep–1 Okt di [`results/kinerja_sistem.md`](results/kinerja_sistem.md); latensi notifikasi sampai ke klien (sesi pertama 24 Nov 2026) di [`results/latensi_notifikasi.md`](results/latensi_notifikasi.md) |
| RQ-G | Zona notifikasi gempa dan perkiraan intensitas di lokasi pengguna: radius tetap 150 km, aturan rujukan, hubungan dari pustaka, dan hubungan yang dikalibrasi dari laporan dirasakan BMKG | Protokol dikunci di [`PROTOKOL_GEMPA.md`](PROTOKOL_GEMPA.md). Data siap: [`results/gempa_dirasakan_ringkasan.md`](results/gempa_dirasakan_ringkasan.md) dan [`results/gempa_usgs_ringkasan.md`](results/gempa_usgs_ringkasan.md). Kalibrasi memakai gempa sebelum 1 Des 2026; uji konfirmatori memakai gempa Desember 2026 dan baru dihitung setelah bulan itu berakhir. Belum ada hasil |

## Menjalankan

Prasyarat: Python 3.11+, dan database PostGIS SIGAP yang sudah di-seed (`docker compose up -d`, lalu `npm run seed` di `server/`).

```powershell
python -m venv research/.venv
research/.venv/Scripts/python -m pip install -r research/requirements.txt

research/.venv/Scripts/python research/01_inventaris.py     # ±5 menit pertama kali (menjelajah 110 halaman MAGMA)
research/.venv/Scripts/python research/02_produk_resmi.py   # ±3 jam pertama kali (±8.400 titik PVMBG, 1 request/detik)
research/.venv/Scripts/python research/06_evaluasi_rq_l1.py # hitung metrik, tulis ke results/
research/.venv/Scripts/python research/09_kinerja_sistem.py # ketersediaan dan latensi dari database SIGAP (RQ2)
research/.venv/Scripts/python research/10_gempa_dirasakan.py # ±30 detik; pertama kali mengunduh GeoNames Indonesia (10 MB)
research/.venv/Scripts/python research/11_usgs_dyfi.py --sampai 2026-11-24 # ±12 menit pertama kali (±650 permintaan, satu per detik)
research/.venv/Scripts/python research/12_evaluasi_gempa.py kalibrasi --sementara # coba kalibrasi RQ-G pada data yang sudah ada; hasil ke data/gempa/sementara/
research/.venv/Scripts/python -m unittest discover -s research/tests
```

Angka server produksi dihitung dari dump `sigap-produksi-2026-10-23.dump` yang dipulihkan ke basis data terpisah (tanpa `TRUNCATE sync_logs` seperti di `deploy/restore-db.sh`), dengan jendela waktu server berjalan; perintah lengkapnya ada di docstring `09_kinerja_sistem.py`.

Semua respons sumber disimpan di cache `research/data/cache/`, beserta waktu pengambilan di `_manifest.jsonl`. Menjalankan ulang tidak mengunduh ulang dan memberi hasil yang sama. Skrip yang terhenti bisa langsung dijalankan lagi.

Balasan yang bukan data tidak pernah masuk cache. Kalau firewall situs ESDM membalas halaman blokir, skrip berhenti dengan galat `Blocked`; tunggu beberapa jam, lalu jalankan ulang. Balasan GeoServer yang tak terduga dicoba ulang, dan skrip berhenti dengan `UnexpectedResponse` bila tetap gagal. Isi cache lama yang tidak lolos pemeriksaan ini diambil ulang secara otomatis.

Data CEWS dibaca dari arsip perekam (branch `arsip-data`, folder `bmkg-cews/`). Bagian ini dilewati otomatis sampai arsip 2022–2025 lengkap.

**Nilai PVMBG di titik.** GetFeatureInfo mengembalikan 2–4 poligon untuk titik di dekat batas zona (17% titik sampel). Sejak 1 Okt 2026, `02_produk_resmi.py` memakai poligon yang memuat titik, bukan poligon pertama. Dampaknya terhadap hasil dicatat di `PROTOKOL.md` (catatan penerapan 1 Okt 2026).

**Arsip prospektif (Tahap 4).** Perekam di GitHub Actions menyimpan indikasi SIGAP untuk setiap siklus model ECMWF (00Z dan 12Z) ke branch `arsip-data` (`sigap-indikasi/`), lengkap dengan hujan di 3.219 titik pantau, versi aturan, dan hash titik pantau. Commit git memberi cap waktu publik sebelum kejadian, jadi verifikasi musim hujan 2026/27 bisa dilakukan per lead time (tanggal prakiraan − tanggal inisialisasi model), dan indikasi bisa dihitung ulang dengan aturan versi baru pada prakiraan yang sama persis. Waktu terbit peringatan CEWS juga tercatat sampai ±1 jam.

**Latensi (RQ2).** BMKG baru menerbitkan gempa di feed publik beberapa menit setelah kejadian: median 17,1 menit (p90 40,1) untuk 26 gempa dirasakan yang tertangkap server produksi, 13–23 Okt 2026 (laptop, 26 Sep–1 Okt: median 22,6 menit dari 6 gempa). Karena itu latensi dilaporkan dalam dua bagian: jeda sumber (waktu kejadian → muncul di feed, diperkirakan dari event yang tertangkap saat server memantau) dan jeda sistem SIGAP (muncul di feed → tersimpan, paling lama satu interval sinkronisasi, ≤ 60 detik di server). Target "gempa masuk ≤ 2 menit dari kejadian" tidak bisa dicapai sistem mana pun yang memakai feed publik.

**Latensi notifikasi (RQ2).** Dua bagian di atas berhenti saat data tersimpan di server. Bagian ketiga, dari server menyimpan notifikasi sampai datanya tiba di klien lewat aliran notifikasi (`/api/stream`), diukur terhadap server produksi dengan perekam di `e2e/` (cara kerja dan syaratnya di [`e2e/README.md`](../e2e/README.md#latensi-notifikasi)). Perekaman dicicil beberapa sesi, dan berkas hasilnya bertambah tiap sesi; kapan perekam mendengarkan dicatat per sesi di `results/latensi_notifikasi.sesi.csv`. Sesi pertama, 24 Nov 2026 (perekam mendengarkan 16.40–19.51 WIB, 3 jam 10 menit; notifikasi pertama 16.54 WIB, terakhir 19.50 WIB), mencatat 34 notifikasi dalam 13 siaran, semuanya peringatan dini cuaca BMKG. Nomor urutnya tidak terputus (2655–2688), jadi di antara keduanya tidak ada notifikasi yang terlewat. Latensi kirim median 14 ms, persentil ke-90 19 ms, paling lama 28 ms. Waktu bolak-balik ke server 23–25 ms, sehingga ketidakpastian jamnya (paling besar ±13 ms) hampir sebesar nilainya: yang bisa disimpulkan adalah latensi kirim kira-kira sebesar jeda jaringan satu arah, bukan angka pastinya. Selama sesi itu jam laptop perekam bergeser 1,02 ms per menit terhadap jam server (selisih 257 ms → 438 ms dalam 177 menit), jadi selisih jam yang diukur ulang tiap menit tertinggal paling banyak sekitar 1 ms. Pada 19.30 WIB server di-deploy ulang (`8949d1da9` → `47a0caec2`); perekam menyambung lagi sendiri, dan empat notifikasi sesudahnya (13–16 ms) tidak berbeda dari sebelumnya. Gempa dan perubahan level gunung api belum terekam.

**Ketersediaan (RQ2).** Di server yang menyala terus, sinkronisasi gempa BMKG berhasil 14.640 dari 14.640 kali dan semua slot jadwal berjalan, jauh di atas laptop (85,5%, karena laptop sering offline). MAGMA berhasil 77,9%: sejak 21 Okt 04:58Z halaman MAGMA berganti format, sehingga 108 sinkronisasi gagal beruntun sampai server dimatikan. Selama itu status 69 gunung api terakhir tetap dilayani, dan pembacanya diperbaiki untuk halaman baru pada 23 Okt.

**Data gempa dirasakan.** Skrip `10` dan `11` tidak memerlukan database. Keduanya menyiapkan data untuk menguji seberapa tepat sebuah model memperkirakan guncangan di lokasi pengguna; belum ada hasil model di sini. Rencana ujinya (aturan yang dibandingkan, data pengembangan dan data uji, ukuran, dan syarat kesimpulan) dikunci di [`PROTOKOL_GEMPA.md`](PROTOKOL_GEMPA.md); hitungannya ada di `sigap_riset/zona.py` dan `sigap_riset/intensitas.py`.

- `10_gempa_dirasakan.py` membaca daftar "Dirasakan" BMKG dari arsip perekam (feed BMKG sendiri hanya memuat 15 gempa terakhir), memilih revisi terakhir tiap gempa, lalu memberi koordinat pada tiap nama lokasi dari dua daftar tetap: 514 kab/kota dan GeoNames Indonesia. Aturan pemilihannya ada di `sigap_riset/geokode.py`, dan kolom `kepastian` mencatat aturan mana yang menentukan tiap lokasi. Tempat yang perlu ditinjau tercantum di ringkasan; koreksi tangan ditulis di [`lokasi_manual.csv`](lokasi_manual.csv) (kolom `nama`, `keterangan`, `tempat`, `lat`, `lon`, `presisi`, `catatan`) dan selalu didahulukan.
- `11_usgs_dyfi.py` mengambil laporan guncangan USGS ("Did You Feel It?") untuk gempa M ≥ 5 sejak 2010 yang punya sedikitnya 10 respons: intensitas per kotak 10 km beserta jumlah responsnya. Data ini menutup kekurangan arsip BMKG, yang baru dua bulan dan hampir tidak memuat intensitas V ke atas.
- Untuk himpunan beku yang dirujuk makalah, jalankan `10` dengan `--sampai <tanggal> --commit <hash arsip>` dan `11` dengan `--sampai <tanggal>` yang sama; hash arsip dan sidik berkas GeoNames tercatat di ringkasan.
- Kedua sumber hanya mencatat tempat yang melapor merasakan. Tempat yang tidak disebut belum tentu tidak merasakan, jadi rancangan evaluasinya harus memperhitungkan itu. Seperti RQ-L1, tulis dan komit protokol analisisnya sebelum menghitung hasil model.

## Struktur

| Path | Isi |
|---|---|
| `01_inventaris.py` | Inventaris kejadian gerakan tanah: laporan lapangan PVMBG + tanggapan MAGMA, dedup, kode kab/kota |
| `02_produk_resmi.py` | Desain kasus-kontrol dan nilai produk resmi di tiap titik/periode |
| `06_evaluasi_rq_l1.py` | AUC berpasangan, POD/POFD/TSS, CI bootstrap klaster, analisis sensitivitas, dan EDuMaP untuk CEWS |
| `09_kinerja_sistem.py` | Ketersediaan sinkronisasi per sumber (gagal jaringan klien dipisah dari gagal sumber) dan latensi gempa BMKG |
| `10_gempa_dirasakan.py` | Gempa dirasakan BMKG dari arsip perekam: satu baris per gempa dan per lokasi laporan, dengan koordinat |
| `11_usgs_dyfi.py` | Laporan guncangan USGS (DYFI) per kotak 10 km untuk gempa M ≥ 5 sejak 2010 |
| `12_evaluasi_gempa.py` | RQ-G menurut `PROTOKOL_GEMPA.md`, tiga langkah: `kalibrasi` (IPE-ID dan ambang dari data pengembangan), `dyfi` (hubungan yang dibekukan pada laporan USGS), dan `uji` (uji konfirmatori). Tiap langkah menolak berjalan sebelum waktunya; `kalibrasi --sementara` mencoba pada data yang sudah ada tanpa membekukan apa pun |
| `lokasi_manual.csv` | Koreksi tangan untuk koordinat lokasi laporan BMKG (dikomit; boleh kosong) |
| `sigap_riset/` | Modul bersama: klien HTTP ber-cache, query PostGIS, metrik, arsip perekam (CEWS, gempa dirasakan), pencocokan nama lokasi, pembaca USGS, EDuMaP (Calvello & Piciullo 2016), hubungan intensitas–jarak gempa, dan zona notifikasinya |
| `tests/` | Uji metrik dengan data buatan, uji klien HTTP, uji EDuMaP dengan contoh di makalah aslinya, uji pengurai gempa dirasakan, pencocokan lokasi, serta pembaca USGS dengan potongan data asli, dan uji hubungan intensitas serta zona notifikasi gempa dengan data buatan |
| `data/` | Cache, data antara, dan sampel (tidak dikomit; bisa dibuat ulang) |
| `results/` | Tabel dan gambar hasil (dikomit) |

## Sumber data dan etika

- Kejadian: laporan pemeriksaan lapangan dan tanggapan gerakan tanah **PVMBG, Badan Geologi, Kementerian ESDM** (Portal MBG dan MAGMA Indonesia).
- Prakiraan potensi gerakan tanah bulanan dan ZKGT: **PVMBG** (layer WMS Portal MBG).
- Peringatan dini curah hujan tinggi: **BMKG** (CEWS).
- Batas wilayah: Kepmendagri 2025 (data cahyadsn/wilayah_boundaries, MIT).
- Gempa dirasakan: **BMKG** (feed `gempadirasakan` dan `autogempa`, lewat arsip perekam).
- Laporan guncangan gempa kuat: **U.S. Geological Survey**, katalog ComCat dan produk "Did You Feel It?" (domain publik).
- Koordinat nama tempat: **GeoNames** (CC BY 4.0), berkas `ID.zip`.

Endpoint Portal MBG dan CEWS adalah API internal situs, bukan layanan yang didokumentasikan. Skrip memakai User-Agent yang jelas, jeda minimal 1–2 detik per request, dan cache supaya tiap data cukup diambil sekali. Data pribadi petugas (nama, NIP) tidak disimpan.
