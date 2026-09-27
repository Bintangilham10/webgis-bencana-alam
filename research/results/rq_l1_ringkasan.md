# Hasil RQ-L1 — skill produk peringatan longsor resmi

Dihitung 2026-09-27 17:47 UTC dari cache data (diambil 2026-09-27 s.d. 2026-09-27). Protokol: `research/PROTOKOL.md`.
Bootstrap klaster 2000 kali. Layer PVMBG yang tidak ada/rusak: 2023-04, 2023-09, 2023-10, 2023-11, 2024-08, 2025-11, 2025-12.
Bulan bercakupan tidak lengkap (sensitivitas): 2022-12 (median cakupan 1.00).
Presisi tanggal kasus PVMBG: {'hari': 280, 'bulan': 23, 'tahun': 7}. Analisis utama PVMBG memakai presisi hari dan bulan; CEWS hanya presisi hari (PROTOKOL.md v1.1).
Dasarian CEWS tanpa produk di sumber BMKG (dikeluarkan): 2022-09 das 2, 2022-09 das 3, 2022-10 das 1, 2022-10 das 2, 2024-02 das 2, 2024-06 das 3, 2025-05 das 3.

| Produk | Analisis | Kontrol | n kasus | AUC berpasangan [CI 95%] | AUC gabungan | POD≥2 | POFD≥2 | TSS≥2 [CI 95%] | POD=3 | POFD=3 |
|---|---|---|---|---|---|---|---|---|---|---|
| Potensi bulanan PVMBG | utama | spasial (provinsi) | 303 | 0.631 [0.603, 0.659] | 0.631 | 0.78 | 0.55 | 0.236 [0.188, 0.283] | 0.38 | 0.22 |
| Potensi bulanan PVMBG | utama | temporal | 303 | 0.560 [0.534, 0.587] | 0.545 | 0.78 | 0.70 | 0.078 [0.043, 0.117] | 0.38 | 0.33 |
| ZKGT (dalam layer bulanan) | utama | spasial (provinsi) | 303 | 0.653 [0.627, 0.682] | 0.656 | 0.62 | 0.40 | 0.226 [0.169, 0.283] | 0.17 | 0.07 |
| ZKGT (dalam layer bulanan) | utama | temporal | 303 | 0.501 [0.486, 0.515] | 0.505 | 0.62 | 0.62 | 0.004 [-0.017, 0.024] | 0.17 | 0.16 |
| Potensi − ZKGT (L1c) | utama | spasial (provinsi) | 303 | Δ -0.023 [-0.036, -0.009] | | | | | | |
| Potensi bulanan PVMBG | sens: tipe diketahui | spasial (provinsi) | 141 | 0.678 [0.638, 0.716] | 0.677 | 0.84 | 0.54 | 0.307 [0.247, 0.362] | 0.50 | 0.25 |
| Potensi bulanan PVMBG | sens: tipe diketahui | temporal | 141 | 0.606 [0.570, 0.642] | 0.579 | 0.84 | 0.74 | 0.103 [0.052, 0.157] | 0.50 | 0.37 |
| Potensi bulanan PVMBG | sens: kontrol kab/kota | spasial (kab/kota) | 303 | 0.566 [0.539, 0.594] | 0.564 | 0.78 | 0.66 | 0.118 [0.074, 0.160] | 0.38 | 0.31 |
| Potensi − ZKGT (L1c) | sens: kontrol kab/kota | spasial (kab/kota) | 303 | Δ -0.021 [-0.034, -0.009] | | | | | | |
| Potensi bulanan PVMBG | sens: sumber magma-tanggapan | spasial (provinsi) | 27 | 0.583 [0.496, 0.670] | 0.557 | 0.59 | 0.46 | 0.133 [-0.026, 0.289] | 0.26 | 0.19 |
| Potensi bulanan PVMBG | sens: sumber magma-tanggapan | temporal | 27 | 0.491 [0.377, 0.605] | 0.478 | 0.59 | 0.63 | -0.037 [-0.185, 0.105] | 0.26 | 0.22 |
| Potensi bulanan PVMBG | sens: sumber magma-tanggapan+pvmbg-lapangan | spasial (provinsi) | 3 | 0.317 [0.150, 0.450] | 0.339 | 0.00 | 0.33 | -0.333 [-0.700, -0.100] | 0.00 | 0.20 |
| Potensi bulanan PVMBG | sens: sumber magma-tanggapan+pvmbg-lapangan | temporal | 3 | 0.278 [0.000, 0.500] | 0.222 | 0.00 | 0.33 | -0.333 [-0.667, 0.000] | 0.00 | 0.06 |
| Potensi bulanan PVMBG | sens: sumber pvmbg-lapangan | spasial (provinsi) | 273 | 0.639 [0.610, 0.669] | 0.644 | 0.81 | 0.56 | 0.252 [0.202, 0.301] | 0.40 | 0.23 |
| Potensi bulanan PVMBG | sens: sumber pvmbg-lapangan | temporal | 273 | 0.570 [0.544, 0.598] | 0.552 | 0.81 | 0.72 | 0.093 [0.057, 0.131] | 0.40 | 0.34 |
| Potensi bulanan PVMBG | sens: tahun 2022 | spasial (provinsi) | 149 | 0.676 [0.638, 0.712] | 0.669 | 0.85 | 0.53 | 0.312 [0.256, 0.365] | 0.48 | 0.25 |
| Potensi bulanan PVMBG | sens: tahun 2022 | temporal | 149 | 0.597 [0.558, 0.636] | 0.572 | 0.85 | 0.75 | 0.098 [0.041, 0.151] | 0.48 | 0.36 |
| Potensi bulanan PVMBG | sens: tahun 2023 | spasial (provinsi) | 26 | 0.615 [0.513, 0.715] | 0.605 | 0.62 | 0.45 | 0.162 [-0.015, 0.338] | 0.31 | 0.16 |
| Potensi bulanan PVMBG | sens: tahun 2023 | temporal | 26 | 0.548 [0.468, 0.635] | 0.537 | 0.62 | 0.60 | 0.013 [-0.096, 0.128] | 0.31 | 0.22 |
| Potensi bulanan PVMBG | sens: tahun 2024 | spasial (provinsi) | 127 | 0.585 [0.540, 0.628] | 0.590 | 0.75 | 0.58 | 0.169 [0.087, 0.248] | 0.28 | 0.21 |
| Potensi bulanan PVMBG | sens: tahun 2024 | temporal | 127 | 0.520 [0.482, 0.556] | 0.518 | 0.75 | 0.68 | 0.070 [0.016, 0.126] | 0.28 | 0.32 |
| Potensi bulanan PVMBG | sens: tahun 2025 | spasial (provinsi) | 1 | 0.150 [–, –] | 0.150 | 0.00 | 0.70 | -0.700 [–, –] | 0.00 | 0.00 |
| Potensi bulanan PVMBG | sens: tahun 2025 | temporal | 1 | 0.333 [–, –] | 0.333 | 0.00 | 0.33 | -0.333 [–, –] | 0.00 | 0.00 |
| Potensi bulanan PVMBG | sens: tanpa bulan tak lengkap | spasial (provinsi) | 292 | 0.637 [0.609, 0.665] | 0.641 | 0.80 | 0.56 | 0.245 [0.198, 0.291] | 0.39 | 0.23 |
| Potensi bulanan PVMBG | sens: tanpa bulan tak lengkap | temporal | 292 | 0.567 [0.541, 0.593] | 0.548 | 0.80 | 0.72 | 0.081 [0.046, 0.117] | 0.39 | 0.34 |
| Potensi bulanan PVMBG | sens: semua presisi tanggal | spasial (provinsi) | 310 | 0.633 [0.604, 0.661] | 0.633 | 0.78 | 0.54 | 0.238 [0.190, 0.284] | 0.38 | 0.22 |
| Potensi bulanan PVMBG | sens: semua presisi tanggal | temporal | 310 | 0.556 [0.530, 0.583] | 0.542 | 0.78 | 0.71 | 0.075 [0.040, 0.111] | 0.38 | 0.33 |
| Potensi − ZKGT (L1c) | sens: semua presisi tanggal | spasial (provinsi) | 310 | Δ -0.022 [-0.036, -0.009] | | | | | | |
| Peringatan hujan BMKG (CEWS) | utama | spasial (provinsi) | 211 | 0.520 [0.496, 0.543] | 0.517 | 0.19 | 0.13 | 0.057 [0.022, 0.090] | 0.02 | 0.03 |
| Peringatan hujan BMKG (CEWS) | utama | temporal | 225 | 0.571 [0.538, 0.603] | 0.572 | 0.18 | 0.07 | 0.108 [0.057, 0.161] | 0.02 | 0.01 |
| Peringatan hujan BMKG (CEWS) | sens: semua presisi tanggal | spasial (provinsi) | 234 | 0.529 [0.507, 0.554] | 0.525 | 0.19 | 0.12 | 0.069 [0.036, 0.104] | 0.02 | 0.03 |
| Peringatan hujan BMKG (CEWS) | sens: semua presisi tanggal | temporal | 250 | 0.568 [0.537, 0.600] | 0.569 | 0.18 | 0.07 | 0.109 [0.062, 0.161] | 0.02 | 0.02 |

Kriteria (ditetapkan sebelum hasil dihitung): produk punya diskriminasi bila batas bawah CI AUC > 0,5; potensi bulanan memberi nilai tambah atas ZKGT bila batas bawah CI selisih > 0.

EDuMaP untuk CEWS (sensitivitas 5): [`rq_l1_edumap_cews.md`](rq_l1_edumap_cews.md).
