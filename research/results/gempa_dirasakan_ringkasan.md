# Gempa dirasakan BMKG: himpunan data dan koordinat lokasi laporan

Dibuat oleh `10_gempa_dirasakan.py`. Angka di bawah berubah setiap arsip bertambah; untuk himpunan beku pakai `--sampai`.

## Sumber dan versi

| Hal | Nilai |
|---|---|
| Arsip perekam | commit `8424f023e976` (2026-11-24T01:45:41Z) |
| Batas waktu gempa | tanpa batas |
| Rentang gempa | 2026-09-21T05:59:25Z sampai 2026-11-22T07:54:39Z |
| GeoNames Indonesia | isi bertanggal 2026-11-23, sha256 `550b6ffe7c34a65a` |
| Kab/kota tanpa ibu kota di GeoNames | 41 dari 514 (dipakai titik GeoNames atau titik wakil poligon) |

## Jumlah

| Hal | Nilai |
|---|---|
| Gempa dirasakan | 186 |
| Gempa dengan daftar lokasi | 186 |
| Laporan lokasi | 425 |
| Laporan berkoordinat | 425 (100.0%) |
| Nama lokasi berbeda | 238 |
| Gempa dengan lebih dari satu versi di arsip | 18 |

Gempa menurut magnitudo (yang punya daftar lokasi):

| Magnitudo | Gempa |
|---|---|
| < 3 | 16 |
| 3–3,9 | 38 |
| 4–4,9 | 106 |
| 5–5,9 | 21 |
| ≥ 6 | 5 |

Gempa menurut intensitas tertinggi yang dilaporkan (MMI):

| MMI tertinggi | Gempa |
|---|---|
| II | 34 |
| III | 121 |
| IV | 25 |
| V | 6 |

Laporan menurut intensitas (batas atas rentang):

| MMI | Laporan |
|---|---|
| I | 1 |
| II | 121 |
| III | 255 |
| IV | 41 |
| V | 7 |

## Koordinat lokasi

Laporan berkoordinat menurut tingkat tempat:

| Tingkat | Laporan |
|---|---|
| kota | 64 |
| kabupaten | 241 |
| ibu kota | 36 |
| kecamatan | 68 |
| desa | 10 |
| permukiman | 4 |
| pulau | 2 |

Laporan menurut cara tempatnya ditentukan:

| Cara | Arti | Laporan |
|---|---|---|
| tunggal | hanya satu tempat bernama itu dalam jangkauan wajar | 312 |
| peringkat | beberapa tempat, satu yang tingkatnya paling tinggi | 94 |
| keterangan | dibatasi keterangan wilayah di teks BMKG | 4 |
| tetangga | beberapa tempat setingkat, dipilih yang terdekat ke lokasi lain di daftar yang sama | 10 |
| terdekat | beberapa tempat setingkat, dipilih yang terdekat ke episenter | 1 |
| mirip | ejaan berbeda satu atau dua huruf | 4 |
| manual | dari lokasi_manual.csv | 0 |
| tidak ketemu | belum berkoordinat | 0 |

Jarak episenter ke lokasi laporan: median 64 km, persentil ke-90 208 km, terjauh 820 km.

Untuk 123 kab/kota yang muncul di laporan, koordinat yang dipakai (ibu kota) berjarak median 12 km dari titik wakil poligonnya, terjauh 110 km (Kabupaten Nias Selatan). Sebesar itulah ketidakpastian lokasi laporan bertingkat kab/kota.

## Yang perlu ditinjau penulis

7 dari 241 baris di `gempa_dirasakan_lokasi.csv` ditandai `perlu_tinjau` (7 laporan). Periksa tiap baris di peta; bila pilihannya salah, isi `research/lokasi_manual.csv` (kolom `nama`, `keterangan`, `tempat`, `lat`, `lon`, `presisi`, `catatan`) lalu jalankan ulang skrip ini.

| Nama di laporan | Keterangan | Tempat terpilih | Tingkat | Cara | Laporan | Catatan |
|---|---|---|---|---|---|---|
| Jampea Kep. Selayar |  | Bentengjampea | permukiman | mirip | 1 |  |
| Kab. Melu |  | Kabupaten Belu | kabupaten | mirip | 1 |  |
| Kab. Nias Selatan |  | Kabupaten Nias Selatan | kabupaten | tunggal | 1 | di luar jangkauan wajar 174 km |
| Kab. Timur Tengah Utara |  | Kabupaten Timor Tengah Utara | kabupaten | mirip | 1 |  |
| Karawang Selatan |  | Kabupaten Karawang | kabupaten | tunggal | 1 | bagian selatan wilayah ini; koordinat mewakili seluruh wilayah |
| Luwuk |  | Luwuk | ibu kota | peringkat, terdekat | 2 |  |
| Ranometo |  | Kecamatan Ranomeeto | kecamatan | mirip | 1 |  |

## Batasan data

- Daftar BMKG hanya memuat tempat yang melaporkan merasakan gempa. Tempat yang tidak disebut belum tentu tidak merasakan, jadi data ini tidak bisa dipakai langsung untuk menghitung peringatan yang salah sasaran.
- Laporan bertingkat kabupaten diberi koordinat ibu kota kabupaten; guncangan bisa saja dirasakan di bagian lain kabupaten itu. Titik wakil poligon ada di kolom `lat_wakil` dan `lon_wakil` untuk uji kepekaan.
- Perekam mulai berjalan 25 Sep 2026 (feed saat itu memuat gempa sejak 21 Sep) dan baru tiap 15 menit sejak 27 Sep 2026 13.45 UTC, jadi gempa sebelum itu bisa terlewat.
- Koordinat tempat berasal dari GeoNames (CC BY 4.0) dan dipilih oleh aturan di `sigap_riset/geokode.py`; belum diverifikasi satu per satu.
