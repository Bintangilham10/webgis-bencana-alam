# Gempa kuat di wilayah Indonesia: laporan guncangan USGS (DYFI)

Dibuat oleh `11_usgs_dyfi.py`.

## Sumber dan versi

| Hal | Nilai |
|---|---|
| Kueri katalog | <https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2010-01-01&endtime=2026-11-24&minlatitude=-12&maxlatitude=7&minlongitude=94&maxlongitude=142&minmagnitude=5.0&minfelt=10&orderby=time-asc> |
| Syarat | M ≥ 5, sedikitnya 10 respons DYFI, 2010-01-01 sampai 2026-11-24 |
| Wilayah | lintang -12° sampai 7°, bujur 94° sampai 142° (sama dengan aplikasi) |
| Permintaan ke USGS pada jalan ini | 11 (sisanya dari cache `data/cache/usgs/`, waktu ambil di `_manifest.jsonl`) |

## Jumlah

| Hal | Nilai |
|---|---|
| Gempa | 325 |
| Gempa tanpa berkas DYFI yang terbaca | 0 |
| Baris laporan (kotak 10 km, atau kota pada 12 gempa lama) | 5957 |
| Baris dengan ≥ 3 respons dan tidak ditandai meragukan | 1354 |
| Baris dengan CDI 1 (responden tidak merasakan) | 253 |
| Total respons | 17819 |
| Gempa yang juga punya ShakeMap | 222 |

Gempa menurut magnitudo:

| Magnitudo | Gempa |
|---|---|
| 5–5,4 | 107 |
| 5,5–5,9 | 78 |
| 6–6,4 | 68 |
| 6,5–6,9 | 43 |
| ≥ 7 | 29 |

Gempa menurut tahun:

| Tahun | Gempa |
|---|---|
| 2010 | 18 |
| 2011 | 19 |
| 2012 | 18 |
| 2013 | 12 |
| 2014 | 3 |
| 2015 | 17 |
| 2016 | 14 |
| 2017 | 19 |
| 2018 | 32 |
| 2019 | 38 |
| 2020 | 22 |
| 2021 | 15 |
| 2022 | 22 |
| 2023 | 22 |
| 2024 | 11 |
| 2025 | 14 |
| 2026 | 29 |

Kotak menurut intensitas (CDI dibulatkan ke kelas MMI):

| Intensitas | Semua kotak | Kotak ≥ 3 respons dan tidak meragukan |
|---|---|---|
| ≤ II | 1602 | 137 |
| III | 1875 | 499 |
| IV | 1304 | 418 |
| V | 645 | 164 |
| VI | 268 | 58 |
| VII | 142 | 36 |
| ≥ VIII | 121 | 42 |

Kotak menurut jumlah respons:

| Respons | Kotak |
|---|---|
| 1 | 3793 |
| 2 | 810 |
| 3–9 | 1050 |
| ≥ 10 | 304 |

Jarak episenter ke kotak: median 179 km, persentil ke-90 627 km, terjauh 3435 km.

Gempa menurut negara di nama tempat USGS (kosong = di laut tanpa nama negara):

| Negara | Gempa |
|---|---|
| Indonesia | 209 |
| Philippines | 84 |
| Timor Leste | 17 |
| (tanpa nama negara) | 10 |
| Malaysia | 4 |
| Palau | 1 |

## Batasan data

- Laporan DYFI datang dari warga yang mengisi kuesioner daring, jadi lebih banyak dari kota besar dan dari pengguna internet. Kotak dengan satu atau dua respons tidak stabil.
- CDI sebanding dengan MMI tetapi berdesimal dan diturunkan dari kuesioner, sedangkan daftar BMKG berupa rentang MMI dari pengamatan petugas. Menggabungkan keduanya perlu diuji dulu pada gempa yang ada di kedua sumber.
- Hanya kotak yang punya responden yang muncul. Kotak tanpa responden belum tentu tidak merasakan, tetapi CDI 1 memang berarti respondennya tidak merasakan.
- Sebagian respons datang dari sangat jauh (lebih dari 1.500 km); analisis perlu menetapkan batas jarak.
- Wilayah kueri berbentuk kotak, jadi memuat juga gempa di negara tetangga (kolom `negara`).
