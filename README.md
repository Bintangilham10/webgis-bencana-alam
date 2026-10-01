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
| `bmkg-cews/YYYY/MM/dasarian-N__<hash>.json` | BMKG — Peringatan Dini Curah Hujan Tinggi (CEWS) | Daftar kab/kota per level (aman, waspada, siaga, awas) untuk satu dasarian, beserta kode Kepmendagri (`kode` null bila nama tidak dikenali, mis. "DANAU"). Hash berbeda = peringatan direvisi. Diperiksa tiap jam selama dasarian berjalan atau berikutnya belum terbit (jadi `first_seen_at` = waktu terbit ±1 jam), lalu tiap 3 jam; `bmkg-cews/status.json` (`seen`) mencatat kapan produk tiap dasarian pertama terlihat. Arsip sejak Jan 2022 diisi bertahap |
| `pvmbg-prakiraan/YYYY/MM.jsonl` | PVMBG — Prakiraan Wilayah Potensi Terjadi Gerakan Tanah (bulanan) | Potensi gerakan tanah (`potensi`) dan zona kerentanan (`zkgt`) di satu titik tiap kab/kota, dari GetFeatureInfo layer `pmbgi:prakiraan_{tahun}_{bulan}`. `n_poligon` = jumlah poligon yang dikembalikan. **Pakai baris terakhir per `kode` dengan `pembaca: 2`.** Baris tanpa `pembaca` (versi 1, sampai 1 Okt 2026) memakai poligon pertama, yang di dekat batas zona bisa salah zona; bulan-bulan itu direkam ulang |
| `pvmbg-laporan/snapshot/YYYY-MM-DD.json` | PVMBG — laporan pemeriksaan lapangan gerakan tanah (Portal MBG) | Salinan utuh saat pertama direkam dan setiap kali ada perubahan |
| `pvmbg-laporan/perubahan.jsonl` | | Laporan `baru`, `berubah`, atau `hilang` dibanding pemeriksaan sebelumnya (mingguan) |
| `open-meteo-ens/YYYY/MM/DD.jsonl` | Open-Meteo — ensemble ECMWF IFS 0,25° (51 anggota) | Ringkasan curah hujan harian 3 hari di satu titik tiap kab/kota: median, p90, maksimum, dan peluang ≥ 20/50/100 mm. Direkam sekali sehari pada run pertama setelah 15.00 WIB (semua titik dalam satu run, ±4 menit) |
| `bnpb-mingguan/YYYY/MM/<id>__<hash>.json` | BNPB — Kejadian Bencana Mingguan (ArcGIS) | Kejadian per kab/kota beserta korban dan kronologi; diperiksa harian |
| `sigap-indikasi/YYYY/MM/DD/<HH>Z.json` | SIGAP — indikasi hujan lebat, banjir, dan tanah longsor per kab/kota per hari | Satu file per siklus model ECMWF IFS (00Z/12Z, tanggal dan jam = inisialisasi model, UTC). Hujan diambil mulai run pertama setelah siklus tersedia di Open-Meteo, dengan jatah ±8 menit per run; sisanya dicicil lewat `sigap-indikasi/pending.json` (file kerja), jadi satu siklus bisa butuh beberapa run (`runs`, `first_fetched_at`, `completed_at`). Berisi `model_init`, `model_available`, `rules_version` + `rules_sha256`, hash daftar titik pantau, tanggal prakiraan (`dates`, 4 hari, WIB), jumlah kab/kota per level per hari (`counts`), dan level 0–3 per kab/kota untuk `hujan`, `banjir`, `longsor` per tanggal (`null` = hujan tidak tersedia). `locations_missing` > 0 berarti siklus disimpan sebelum semua titik terambil (setelah 6 run atau karena siklus berikutnya sudah terbit); hujan satu siklus tidak pernah dicampur dengan siklus lain. File pertama (`2026/10/01/00Z.json`) ditulis versi awal perekam dan memakai `fetched_at`, `attempts`, dan `locations_failed` sebagai ganti `first_fetched_at`/`completed_at`, `runs`, dan `locations_missing`; isinya lengkap (3.218 titik, 0 gagal). Aturan dan titik pantau sama dengan server SIGAP (`recorder/src/lib/rules.json`, `recorder/data/titik-pantau.json`) |
| `sigap-indikasi/YYYY/MM/DD/<HH>Z-hujan.jsonl` | Open-Meteo — ECMWF IFS 9 km | Hujan harian di tiap titik pantau yang dipakai indikasi di atas: satu baris `[lat, lon, …]` dengan urutan kolom di `hujan_kolom` (3 hari lalu + 4 hari prakiraan, mm). Cukup untuk menghitung ulang indikasi persis atau dengan aturan versi baru |
| `berita-longsor/YYYY/MM/<hash>.json` | Google News (RSS, bahasa Indonesia) | Judul, sumber, waktu, dan tautan berita longsor, plus kab/kota yang disebut (`kab_kota`, dengan `keyakinan`), tanda `luar_negeri`, dan `jenis` (kejadian/imbauan/lainnya, heuristik kata kunci) |
| `<sumber>/status.json`, `pvmbg-laporan/terkini.json` | | File status perekam (waktu periksa terakhir, kemajuan backfill); bukan data arsip |
| `_runs/YYYY/MM/DD.jsonl` | | Log tiap run: berhasil/gagal, jumlah item, dan durasi per sumber. Sejak 1 Okt 2026 satu run menulis dua baris (sumber utama, lalu `sigap-indikasi`) yang dikaitkan oleh `run_id` (nomor run GitHub Actions) |

## Catatan waktu

- Semua timestamp ISO 8601 UTC. Partisi folder memakai tanggal UTC.
- `first_seen_at` dan `detected_at` adalah waktu run perekam, **bukan** waktu kejadian atau terbit. Jadwalnya tiap 15 menit, tetapi GitHub Actions sering menunda jadwal: 25–27 Sep 2026 run terjadwal rata-rata hanya tiap ±3,7 jam (±6 kali sehari), sehingga peringatan CAP yang berumur pendek bisa terlewat di antara dua run. Sejak 27 Sep 2026 13:45 UTC, run juga dipicu dari luar tiap 15 menit (cron-job.org → `workflow_dispatch`). Karena itu, bandingkan kelengkapan data sebelum dan sesudah waktu ini secara terpisah.
- Run yang hilang terlihat dari celah di `_runs/`. Hitung ketersediaan sumber dari file ini.
- Tanggal harian, bulan, dan dasarian pada `bmkg-cews/`, `pvmbg-prakiraan/`, `open-meteo-ens/`, dan tanggal prakiraan di `sigap-indikasi/` memakai WIB, karena produknya disusun per tanggal lokal. Folder `sigap-indikasi/` dipartisi menurut waktu inisialisasi model (UTC), jadi lead time = tanggal prakiraan − tanggal inisialisasi.
- Titik kab/kota diambil dari `recorder/data/wilayah.json` (satu titik di dalam tiap wilayah, Kepmendagri 2025).

## Lisensi & atribusi

- Data gempa dan peringatan dini cuaca: **BMKG** (sumber wajib dicantumkan).
- Tingkat aktivitas gunung api: **PVMBG — MAGMA Indonesia, Kementerian ESDM**.
- Laporan warga: **PetaBencana.id**, CC BY-NC 4.0.
- Peringatan dini curah hujan tinggi: **BMKG** (sumber wajib dicantumkan).
- Prakiraan potensi dan laporan pemeriksaan gerakan tanah: **PVMBG, Badan Geologi, Kementerian ESDM**.
- Ensemble curah hujan dan hujan di titik pantau: **Open-Meteo** (CC BY 4.0), data model **ECMWF**.
- Indikasi SIGAP: turunan sistem SIGAP dari data Open-Meteo dan kelas bahaya **InaRISK BNPB**; bukan peringatan resmi.
- Kejadian bencana mingguan: **BNPB**.
- Berita: hak cipta pada penerbit masing-masing; arsip hanya menyimpan judul dan tautan untuk riset.

Arsip ini untuk riset nonkomersial. Ikuti lisensi masing-masing sumber saat memakai ulang data.
