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
| `_runs/YYYY/MM/DD.jsonl` | | Log tiap run: berhasil/gagal, jumlah item, dan durasi per sumber |

## Catatan waktu

- Semua timestamp ISO 8601 UTC. Partisi folder memakai tanggal UTC.
- `first_seen_at` dan `detected_at` adalah waktu run perekam, **bukan** waktu kejadian atau terbit. Resolusinya ±15 menit, bisa lebih lama bila jadwal GitHub Actions tertunda.
- Run yang hilang terlihat dari celah di `_runs/`. Hitung ketersediaan sumber dari file ini.

## Lisensi & atribusi

- Data gempa dan peringatan dini cuaca: **BMKG** (sumber wajib dicantumkan).
- Tingkat aktivitas gunung api: **PVMBG — MAGMA Indonesia, Kementerian ESDM**.
- Laporan warga: **PetaBencana.id**, CC BY-NC 4.0.

Arsip ini untuk riset nonkomersial. Ikuti lisensi masing-masing sumber saat memakai ulang data.
