# Hasil RQ-L1 — skill produk peringatan longsor resmi

Dihitung 2026-10-01 00:57 UTC dari cache data (diambil 2026-09-27 s.d. 2026-09-27). Protokol: `research/PROTOKOL.md`.
Bootstrap klaster 2000 kali. Layer PVMBG yang tidak ada/rusak: 2023-04, 2023-09, 2023-10, 2023-11, 2024-08, 2025-11, 2025-12.
Bulan bercakupan tidak lengkap (sensitivitas): 2022-12 (median cakupan 1.00).
Presisi tanggal kasus PVMBG: {'hari': 280, 'bulan': 23, 'tahun': 7}. Analisis utama PVMBG memakai presisi hari dan bulan; CEWS hanya presisi hari (PROTOKOL.md v1.1).
Dasarian CEWS tanpa produk di sumber BMKG (dikeluarkan): 2022-09 das 2, 2022-09 das 3, 2022-10 das 1, 2022-10 das 2, 2024-02 das 2, 2024-06 das 3, 2025-05 das 3.

| Produk | Analisis | Kontrol | n kasus | AUC berpasangan [CI 95%] | AUC gabungan | POD≥2 | POFD≥2 | TSS≥2 [CI 95%] | POD=3 | POFD=3 |
|---|---|---|---|---|---|---|---|---|---|---|
| Potensi bulanan PVMBG | utama | spasial (provinsi) | 303 | 0.642 [0.614, 0.670] | 0.641 | 0.80 | 0.55 | 0.247 [0.200, 0.293] | 0.41 | 0.23 |
| Potensi bulanan PVMBG | utama | temporal | 303 | 0.565 [0.537, 0.592] | 0.546 | 0.80 | 0.74 | 0.058 [0.024, 0.093] | 0.41 | 0.33 |
| ZKGT (dalam layer bulanan) | utama | spasial (provinsi) | 303 | 0.664 [0.636, 0.692] | 0.667 | 0.67 | 0.41 | 0.259 [0.202, 0.316] | 0.14 | 0.06 |
| ZKGT (dalam layer bulanan) | utama | temporal | 303 | 0.500 [0.488, 0.512] | 0.502 | 0.67 | 0.66 | 0.003 [-0.013, 0.020] | 0.14 | 0.14 |
| Potensi − ZKGT (L1c) | utama | spasial (provinsi) | 303 | Δ -0.021 [-0.034, -0.009] | | | | | | |
| Potensi bulanan PVMBG | sens: tipe diketahui | spasial (provinsi) | 141 | 0.700 [0.663, 0.735] | 0.694 | 0.87 | 0.54 | 0.331 [0.276, 0.382] | 0.53 | 0.26 |
| Potensi bulanan PVMBG | sens: tipe diketahui | temporal | 141 | 0.621 [0.585, 0.658] | 0.590 | 0.87 | 0.79 | 0.080 [0.033, 0.130] | 0.53 | 0.37 |
| Potensi bulanan PVMBG | sens: kontrol kab/kota | spasial (kab/kota) | 303 | 0.574 [0.548, 0.601] | 0.572 | 0.80 | 0.67 | 0.123 [0.080, 0.164] | 0.41 | 0.31 |
| Potensi − ZKGT (L1c) | sens: kontrol kab/kota | spasial (kab/kota) | 303 | Δ -0.021 [-0.034, -0.007] | | | | | | |
| Potensi bulanan PVMBG | sens: sumber magma-tanggapan | spasial (provinsi) | 27 | 0.581 [0.483, 0.676] | 0.558 | 0.56 | 0.46 | 0.093 [-0.070, 0.252] | 0.33 | 0.20 |
| Potensi bulanan PVMBG | sens: sumber magma-tanggapan | temporal | 27 | 0.497 [0.383, 0.608] | 0.479 | 0.56 | 0.65 | -0.093 [-0.222, 0.019] | 0.33 | 0.23 |
| Potensi bulanan PVMBG | sens: sumber magma-tanggapan+pvmbg-lapangan | spasial (provinsi) | 3 | 0.317 [0.150, 0.450] | 0.339 | 0.00 | 0.33 | -0.333 [-0.700, -0.100] | 0.00 | 0.13 |
| Potensi bulanan PVMBG | sens: sumber magma-tanggapan+pvmbg-lapangan | temporal | 3 | 0.278 [0.000, 0.500] | 0.222 | 0.00 | 0.33 | -0.333 [-0.667, 0.000] | 0.00 | 0.00 |
| Potensi bulanan PVMBG | sens: sumber pvmbg-lapangan | spasial (provinsi) | 273 | 0.652 [0.623, 0.682] | 0.654 | 0.83 | 0.56 | 0.268 [0.220, 0.315] | 0.42 | 0.23 |
| Potensi bulanan PVMBG | sens: sumber pvmbg-lapangan | temporal | 273 | 0.575 [0.549, 0.603] | 0.553 | 0.83 | 0.75 | 0.077 [0.040, 0.114] | 0.42 | 0.35 |
| Potensi bulanan PVMBG | sens: tahun 2022 | spasial (provinsi) | 149 | 0.697 [0.661, 0.732] | 0.685 | 0.87 | 0.54 | 0.327 [0.271, 0.378] | 0.52 | 0.26 |
| Potensi bulanan PVMBG | sens: tahun 2022 | temporal | 149 | 0.611 [0.571, 0.651] | 0.583 | 0.87 | 0.80 | 0.068 [0.017, 0.117] | 0.52 | 0.36 |
| Potensi bulanan PVMBG | sens: tahun 2023 | spasial (provinsi) | 26 | 0.608 [0.506, 0.702] | 0.599 | 0.62 | 0.46 | 0.154 [-0.038, 0.323] | 0.31 | 0.17 |
| Potensi bulanan PVMBG | sens: tahun 2023 | temporal | 26 | 0.548 [0.468, 0.628] | 0.533 | 0.62 | 0.62 | 0.000 [-0.103, 0.103] | 0.31 | 0.22 |
| Potensi bulanan PVMBG | sens: tahun 2024 | spasial (provinsi) | 127 | 0.589 [0.543, 0.630] | 0.595 | 0.76 | 0.58 | 0.180 [0.101, 0.257] | 0.29 | 0.21 |
| Potensi bulanan PVMBG | sens: tahun 2024 | temporal | 127 | 0.518 [0.480, 0.554] | 0.516 | 0.76 | 0.69 | 0.064 [0.012, 0.118] | 0.29 | 0.32 |
| Potensi bulanan PVMBG | sens: tahun 2025 | spasial (provinsi) | 1 | 0.150 [–, –] | 0.150 | 0.00 | 0.70 | -0.700 [–, –] | 0.00 | 0.00 |
| Potensi bulanan PVMBG | sens: tahun 2025 | temporal | 1 | 0.083 [–, –] | 0.083 | 0.00 | 0.83 | -0.833 [–, –] | 0.00 | 0.50 |
| Potensi bulanan PVMBG | sens: tanpa bulan tak lengkap | spasial (provinsi) | 292 | 0.647 [0.619, 0.676] | 0.650 | 0.82 | 0.56 | 0.256 [0.212, 0.302] | 0.41 | 0.23 |
| Potensi bulanan PVMBG | sens: tanpa bulan tak lengkap | temporal | 292 | 0.571 [0.546, 0.597] | 0.549 | 0.82 | 0.75 | 0.063 [0.031, 0.097] | 0.41 | 0.34 |
| Potensi bulanan PVMBG | sens: semua presisi tanggal | spasial (provinsi) | 310 | 0.644 [0.616, 0.671] | 0.643 | 0.79 | 0.54 | 0.249 [0.201, 0.293] | 0.41 | 0.23 |
| Potensi bulanan PVMBG | sens: semua presisi tanggal | temporal | 310 | 0.561 [0.534, 0.588] | 0.544 | 0.79 | 0.74 | 0.055 [0.021, 0.091] | 0.41 | 0.34 |
| Potensi − ZKGT (L1c) | sens: semua presisi tanggal | spasial (provinsi) | 310 | Δ -0.021 [-0.034, -0.008] | | | | | | |
| Peringatan hujan BMKG (CEWS) | utama | spasial (provinsi) | 211 | 0.520 [0.496, 0.543] | 0.517 | 0.19 | 0.13 | 0.057 [0.022, 0.090] | 0.02 | 0.03 |
| Peringatan hujan BMKG (CEWS) | utama | temporal | 225 | 0.571 [0.538, 0.603] | 0.572 | 0.18 | 0.07 | 0.108 [0.057, 0.161] | 0.02 | 0.01 |
| Peringatan hujan BMKG (CEWS) | sens: semua presisi tanggal | spasial (provinsi) | 234 | 0.529 [0.507, 0.554] | 0.525 | 0.19 | 0.12 | 0.069 [0.036, 0.104] | 0.02 | 0.03 |
| Peringatan hujan BMKG (CEWS) | sens: semua presisi tanggal | temporal | 250 | 0.568 [0.537, 0.600] | 0.569 | 0.18 | 0.07 | 0.109 [0.062, 0.161] | 0.02 | 0.02 |

Kriteria (ditetapkan sebelum hasil dihitung): produk punya diskriminasi bila batas bawah CI AUC > 0,5; potensi bulanan memberi nilai tambah atas ZKGT bila batas bawah CI selisih > 0.

EDuMaP untuk CEWS (sensitivitas 5): [`rq_l1_edumap_cews.md`](rq_l1_edumap_cews.md).
