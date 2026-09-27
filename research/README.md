# Riset SIGAP-L — peringatan dini longsor berbasis data terbuka

Folder ini berisi skrip analisis untuk paper. Rancangan lengkapnya ada di rencana proyek (SIGAP-L v2). Protokol yang dikunci sebelum hasil dihitung ada di [`PROTOKOL.md`](PROTOKOL.md).

| Pertanyaan | Isi | Status |
|---|---|---|
| RQ-L1 | Skill prakiraan bulanan potensi gerakan tanah PVMBG dan peringatan curah hujan tinggi BMKG (CEWS), 2022–2025 | Hasil pertama di [`results/rq_l1_ringkasan.md`](results/rq_l1_ringkasan.md); EDuMaP untuk CEWS (sensitivitas 5) belum |
| RQ-L2 | Ambang hidrometeorologi (kelembapan tanah ERA5-Land × hujan) vs ambang hujan saja | Belum |
| RQ-L3 | Skill model SIGAP-L harian pada lead 0–2 hari vs produk resmi | Belum |

## Menjalankan

Prasyarat: Python 3.11+, dan database PostGIS SIGAP yang sudah di-seed (`docker compose up -d`, lalu `npm run seed` di `server/`).

```powershell
python -m venv research/.venv
research/.venv/Scripts/python -m pip install -r research/requirements.txt

research/.venv/Scripts/python research/01_inventaris.py     # ±5 menit pertama kali (menjelajah 110 halaman MAGMA)
research/.venv/Scripts/python research/02_produk_resmi.py   # ±3 jam pertama kali (±8.400 titik PVMBG, 1 request/detik)
research/.venv/Scripts/python research/06_evaluasi_rq_l1.py # hitung metrik, tulis ke results/
research/.venv/Scripts/python -m unittest discover -s research/tests
```

Semua respons sumber disimpan di cache `research/data/cache/`, beserta waktu pengambilan di `_manifest.jsonl`. Menjalankan ulang tidak mengunduh ulang dan memberi hasil yang sama. Skrip yang terhenti bisa langsung dijalankan lagi.

Balasan yang bukan data tidak pernah masuk cache. Kalau firewall situs ESDM membalas halaman blokir, skrip berhenti dengan galat `Blocked`; tunggu beberapa jam, lalu jalankan ulang. Balasan GeoServer yang tak terduga dicoba ulang, dan skrip berhenti dengan `UnexpectedResponse` bila tetap gagal. Isi cache lama yang tidak lolos pemeriksaan ini diambil ulang secara otomatis.

Data CEWS dibaca dari arsip perekam (branch `arsip-data`, folder `bmkg-cews/`). Bagian ini dilewati otomatis sampai arsip 2022–2025 lengkap.

## Struktur

| Path | Isi |
|---|---|
| `01_inventaris.py` | Inventaris kejadian gerakan tanah: laporan lapangan PVMBG + tanggapan MAGMA, dedup, kode kab/kota |
| `02_produk_resmi.py` | Desain kasus-kontrol dan nilai produk resmi di tiap titik/periode |
| `06_evaluasi_rq_l1.py` | AUC berpasangan, POD/POFD/TSS, CI bootstrap klaster, analisis sensitivitas |
| `sigap_riset/` | Modul bersama: klien HTTP ber-cache, query PostGIS, metrik |
| `tests/` | Uji metrik dengan data buatan |
| `data/` | Cache, data antara, dan sampel (tidak dikomit; bisa dibuat ulang) |
| `results/` | Tabel dan gambar hasil (dikomit) |

## Sumber data dan etika

- Kejadian: laporan pemeriksaan lapangan dan tanggapan gerakan tanah **PVMBG, Badan Geologi, Kementerian ESDM** (Portal MBG dan MAGMA Indonesia).
- Prakiraan potensi gerakan tanah bulanan dan ZKGT: **PVMBG** (layer WMS Portal MBG).
- Peringatan dini curah hujan tinggi: **BMKG** (CEWS).
- Batas wilayah: Kepmendagri 2025 (data cahyadsn/wilayah_boundaries, MIT).

Endpoint Portal MBG dan CEWS adalah API internal situs, bukan layanan yang didokumentasikan. Skrip memakai User-Agent yang jelas, jeda minimal 1–2 detik per request, dan cache supaya tiap data cukup diambil sekali. Data pribadi petugas (nama, NIP) tidak disimpan.
