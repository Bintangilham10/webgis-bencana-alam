# Arsip Data Bencana — SIGAP Bencana

Branch ini diisi otomatis oleh perekam `recorder/` (workflow GitHub Actions `rekam-data.yml`) kira-kira tiap 15 menit. Tujuannya menyimpan data yang tidak diarsipkan publik oleh sumbernya, untuk riset peringatan dini.

Arsip bersifat **append-only**: file yang sudah ada tidak pernah ditimpa. Data yang berubah disimpan sebagai file baru.

## Struktur

| Path | Sumber | Isi |
|---|---|---|
| `bmkg-cap/YYYY/MM/DD/<identifier>.xml` | BMKG — peringatan dini cuaca (nowcast, CAP 1.2) | XML asli tiap peringatan, termasuk poligon area. Tanggal = waktu terbit (UTC) |
| `bmkg-cap/indeks/YYYY/MM.jsonl` | | Ringkasan tiap peringatan (jenis, severity, masa berlaku, area) + `first_seen_at` |
| `bmkg-gempa/<feed>/YYYY/MM/<waktu>__<hash>.json` | BMKG — `autogempa`, `gempaterkini`, `gempadirasakan` | Data asli per gempa. Hash berbeda untuk waktu yang sama = revisi parameter oleh BMKG |
| `magma/terkini.json` | PVMBG — MAGMA Indonesia | Status level semua gunung api saat ini |
| `magma/snapshot/YYYY/MM/DD/<waktu>.json` | | Salinan lengkap setiap kali ada perubahan level |
| `magma/perubahan.jsonl` | | Riwayat perubahan level: `from` → `to` per gunung api |
| `petabencana/YYYY/MM/<pkey>__<hash>.json` | PetaBencana.id | Laporan warga (GeoJSON Feature) |
| `bmkg-cews/YYYY/MM/dasarian-N__<hash>.json` | BMKG — Peringatan Dini Curah Hujan Tinggi (CEWS) | Daftar kab/kota per level (aman, waspada, siaga, awas) untuk satu dasarian, beserta kode Kepmendagri (`kode` null bila nama tidak dikenali, mis. "DANAU"). Hash berbeda = peringatan direvisi. Diperiksa tiap 3 jam (praktis setiap run); arsip sejak Jan 2022 diisi bertahap |
| `pvmbg-prakiraan/YYYY/MM.jsonl` | PVMBG — Prakiraan Wilayah Potensi Terjadi Gerakan Tanah (bulanan) | Potensi gerakan tanah (`potensi`) dan zona kerentanan (`zkgt`) di satu titik tiap kab/kota, dari GetFeatureInfo layer `pmbgi:prakiraan_{tahun}_{bulan}` |
| `pvmbg-laporan/snapshot/YYYY-MM-DD.json` | PVMBG — laporan pemeriksaan lapangan gerakan tanah (Portal MBG) | Salinan utuh saat pertama direkam dan setiap kali ada perubahan |
| `pvmbg-laporan/perubahan.jsonl` | | Laporan `baru`, `berubah`, atau `hilang` dibanding pemeriksaan sebelumnya (mingguan) |
| `open-meteo-ens/YYYY/MM/DD.jsonl` | Open-Meteo — ensemble ECMWF IFS 0,25° (51 anggota) | Ringkasan curah hujan harian 3 hari di satu titik tiap kab/kota: median, p90, maksimum, dan peluang ≥ 20/50/100 mm. Direkam sekali sehari pada run pertama setelah 15.00 WIB (semua titik dalam satu run, ±4 menit) |
| `bnpb-mingguan/YYYY/MM/<id>__<hash>.json` | BNPB — Kejadian Bencana Mingguan (ArcGIS) | Kejadian per kab/kota beserta korban dan kronologi; diperiksa harian |
| `berita-longsor/YYYY/MM/<hash>.json` | Google News (RSS, bahasa Indonesia) | Judul, sumber, waktu, dan tautan berita longsor, plus kab/kota yang disebut (`kab_kota`, dengan `keyakinan`), tanda `luar_negeri`, dan `jenis` (kejadian/imbauan/lainnya, heuristik kata kunci) |
| `<sumber>/status.json`, `pvmbg-laporan/terkini.json` | | File status perekam (waktu periksa terakhir, kemajuan backfill); bukan data arsip |
| `_runs/YYYY/MM/DD.jsonl` | | Log tiap run: berhasil/gagal, jumlah item, dan durasi per sumber |

## Catatan waktu

- Semua timestamp ISO 8601 UTC. Partisi folder memakai tanggal UTC.
- `first_seen_at` dan `detected_at` adalah waktu run perekam, **bukan** waktu kejadian atau terbit. Jadwalnya tiap 15 menit, tetapi GitHub Actions sering menunda jadwal: 25–27 Sep 2026 run terjadwal rata-rata hanya tiap ±3,7 jam (±6 kali sehari). Peringatan CAP yang berumur pendek bisa terlewat di antara dua run.
- Run yang hilang terlihat dari celah di `_runs/`. Hitung ketersediaan sumber dari file ini.
- Tanggal harian, bulan, dan dasarian pada `bmkg-cews/`, `pvmbg-prakiraan/`, dan `open-meteo-ens/` memakai WIB, karena produknya disusun per tanggal lokal.
- Titik kab/kota diambil dari `recorder/data/wilayah.json` (satu titik di dalam tiap wilayah, Kepmendagri 2025).

## Lisensi & atribusi

- Data gempa dan peringatan dini cuaca: **BMKG** (sumber wajib dicantumkan).
- Tingkat aktivitas gunung api: **PVMBG — MAGMA Indonesia, Kementerian ESDM**.
- Laporan warga: **PetaBencana.id**, CC BY-NC 4.0.
- Peringatan dini curah hujan tinggi: **BMKG** (sumber wajib dicantumkan).
- Prakiraan potensi dan laporan pemeriksaan gerakan tanah: **PVMBG, Badan Geologi, Kementerian ESDM**.
- Ensemble curah hujan: **Open-Meteo** (CC BY 4.0), data model **ECMWF**.
- Kejadian bencana mingguan: **BNPB**.
- Berita: hak cipta pada penerbit masing-masing; arsip hanya menyimpan judul dan tautan untuk riset.

Arsip ini untuk riset nonkomersial. Ikuti lisensi masing-masing sumber saat memakai ulang data.
