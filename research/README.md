# Riset SIGAP-L — peringatan dini longsor berbasis data terbuka

Folder ini berisi skrip analisis untuk paper. Rancangan lengkapnya ada di rencana proyek (SIGAP-L v2). Protokol yang dikunci sebelum hasil dihitung ada di [`PROTOKOL.md`](PROTOKOL.md).

| Pertanyaan | Isi | Status |
|---|---|---|
| RQ-L1 | Skill prakiraan bulanan potensi gerakan tanah PVMBG dan peringatan curah hujan tinggi BMKG (CEWS), 2022–2025 | Hasil di [`results/rq_l1_ringkasan.md`](results/rq_l1_ringkasan.md) dan EDuMaP CEWS di [`results/rq_l1_edumap_cews.md`](results/rq_l1_edumap_cews.md) |
| RQ-L2 | Ambang hidrometeorologi (kelembapan tanah ERA5-Land × hujan) vs ambang hujan saja | Belum |
| RQ-L3 | Skill model SIGAP-L harian pada lead 0–2 hari vs produk resmi | Belum |
| RQ2 | Kinerja sistem: ketersediaan sinkronisasi dan latensi data | Ukuran di [`results/kinerja_sistem.md`](results/kinerja_sistem.md); perlu server yang selalu aktif untuk angka final |

## Menjalankan

Prasyarat: Python 3.11+, dan database PostGIS SIGAP yang sudah di-seed (`docker compose up -d`, lalu `npm run seed` di `server/`).

```powershell
python -m venv research/.venv
research/.venv/Scripts/python -m pip install -r research/requirements.txt

research/.venv/Scripts/python research/01_inventaris.py     # ±5 menit pertama kali (menjelajah 110 halaman MAGMA)
research/.venv/Scripts/python research/02_produk_resmi.py   # ±3 jam pertama kali (±8.400 titik PVMBG, 1 request/detik)
research/.venv/Scripts/python research/06_evaluasi_rq_l1.py # hitung metrik, tulis ke results/
research/.venv/Scripts/python research/09_kinerja_sistem.py # ketersediaan dan latensi dari database SIGAP (RQ2)
research/.venv/Scripts/python -m unittest discover -s research/tests
```

Semua respons sumber disimpan di cache `research/data/cache/`, beserta waktu pengambilan di `_manifest.jsonl`. Menjalankan ulang tidak mengunduh ulang dan memberi hasil yang sama. Skrip yang terhenti bisa langsung dijalankan lagi.

Balasan yang bukan data tidak pernah masuk cache. Kalau firewall situs ESDM membalas halaman blokir, skrip berhenti dengan galat `Blocked`; tunggu beberapa jam, lalu jalankan ulang. Balasan GeoServer yang tak terduga dicoba ulang, dan skrip berhenti dengan `UnexpectedResponse` bila tetap gagal. Isi cache lama yang tidak lolos pemeriksaan ini diambil ulang secara otomatis.

Data CEWS dibaca dari arsip perekam (branch `arsip-data`, folder `bmkg-cews/`). Bagian ini dilewati otomatis sampai arsip 2022–2025 lengkap.

**Nilai PVMBG di titik.** GetFeatureInfo mengembalikan 2–4 poligon untuk titik di dekat batas zona (17% titik sampel). Sejak 1 Okt 2026, `02_produk_resmi.py` memakai poligon yang memuat titik, bukan poligon pertama. Dampaknya terhadap hasil dicatat di `PROTOKOL.md` (catatan penerapan 1 Okt 2026).

**Arsip prospektif (Tahap 4).** Perekam di GitHub Actions menyimpan indikasi SIGAP untuk setiap siklus model ECMWF (00Z dan 12Z) ke branch `arsip-data` (`sigap-indikasi/`), lengkap dengan hujan di 3.219 titik pantau, versi aturan, dan hash titik pantau. Commit git memberi cap waktu publik sebelum kejadian, jadi verifikasi musim hujan 2026/27 bisa dilakukan per lead time (tanggal prakiraan − tanggal inisialisasi model), dan indikasi bisa dihitung ulang dengan aturan versi baru pada prakiraan yang sama persis. Waktu terbit peringatan CEWS juga tercatat sampai ±1 jam.

**Latensi (RQ2).** BMKG baru menerbitkan gempa di feed publik beberapa menit setelah kejadian: 15–31 menit (median 22,6) untuk 6 gempa dirasakan yang tertangkap saat server memantau, 26 Sep–1 Okt 2026. Karena itu latensi dilaporkan dalam dua bagian: jeda sumber (waktu kejadian → muncul di feed, diperkirakan dari event yang tertangkap saat server memantau) dan jeda sistem SIGAP (muncul di feed → tersimpan, paling lama satu interval sinkronisasi). Target "gempa masuk ≤ 2 menit dari kejadian" tidak bisa dicapai sistem mana pun yang memakai feed publik.

## Struktur

| Path | Isi |
|---|---|
| `01_inventaris.py` | Inventaris kejadian gerakan tanah: laporan lapangan PVMBG + tanggapan MAGMA, dedup, kode kab/kota |
| `02_produk_resmi.py` | Desain kasus-kontrol dan nilai produk resmi di tiap titik/periode |
| `06_evaluasi_rq_l1.py` | AUC berpasangan, POD/POFD/TSS, CI bootstrap klaster, analisis sensitivitas, dan EDuMaP untuk CEWS |
| `09_kinerja_sistem.py` | Ketersediaan sinkronisasi per sumber (gagal jaringan klien dipisah dari gagal sumber) dan latensi gempa BMKG |
| `sigap_riset/` | Modul bersama: klien HTTP ber-cache, query PostGIS, metrik, arsip CEWS, dan EDuMaP (Calvello & Piciullo 2016) |
| `tests/` | Uji metrik dengan data buatan, uji klien HTTP, dan uji EDuMaP dengan contoh di makalah aslinya |
| `data/` | Cache, data antara, dan sampel (tidak dikomit; bisa dibuat ulang) |
| `results/` | Tabel dan gambar hasil (dikomit) |

## Sumber data dan etika

- Kejadian: laporan pemeriksaan lapangan dan tanggapan gerakan tanah **PVMBG, Badan Geologi, Kementerian ESDM** (Portal MBG dan MAGMA Indonesia).
- Prakiraan potensi gerakan tanah bulanan dan ZKGT: **PVMBG** (layer WMS Portal MBG).
- Peringatan dini curah hujan tinggi: **BMKG** (CEWS).
- Batas wilayah: Kepmendagri 2025 (data cahyadsn/wilayah_boundaries, MIT).

Endpoint Portal MBG dan CEWS adalah API internal situs, bukan layanan yang didokumentasikan. Skrip memakai User-Agent yang jelas, jeda minimal 1–2 detik per request, dan cache supaya tiap data cukup diambil sekali. Data pribadi petugas (nama, NIP) tidak disimpan.
