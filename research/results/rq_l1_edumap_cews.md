# RQ-L1 sensitivitas 5 — EDuMaP untuk peringatan hujan BMKG (CEWS)

Metode EDuMaP (Calvello & Piciullo 2016, NHESS 16:103–122). Implementasinya diuji dengan contoh Tabel 7–8 makalah (`research/tests/test_edumap.py`).

**Parameter** (ditetapkan sebelum EDuMaP dihitung; lihat catatan penerapan di PROTOKOL.md):

| Parameter | Nilai |
|---|---|
| Kelas peringatan | 1 Aman, 2 Waspada, 3 Siaga, 4 Awas (CEWS; kab/kota yang tidak tercantum = Aman) |
| Kelas kejadian longsor (kriteria absolut) | 1 = tidak ada, 2 = 1 kejadian, 3 = 2–3 kejadian, 4 = ≥ 4 kejadian |
| Zona peringatan | kab/kota Kepmendagri 2025 |
| Satuan waktu | dasarian; 137 dasarian 2022–2025 yang produknya ada |
| Lead time, over time | 0 (CEWS terbit sebelum dasarian dimulai; kejadian dikelompokkan per dasarian) |
| Kejadian | inventaris PVMBG + MAGMA dengan presisi tanggal harian |
| Kriteria A | alert = kelas peringatan ≥ 3 (Siaga), kejadian = kelas longsor ≥ 2 (≥ 1 longsor) |
| Kriteria B | warna menurut selisih kelas: 0 hijau, 1 kuning, 2 merah, 3 ungu |

**Matriks durasi** (hari; baris = peringatan, kolom = jumlah kejadian longsor per kab/kota per dasarian; semua kab/kota):

| Peringatan \ Longsor | 0 | 1 | 2–3 | ≥ 4 |
|---|---|---|---|---|
| Aman | 644,387 | 857 | 160 | 82 |
| Waspada | 47,720 | 143 | 50 | 10 |
| Siaga | 16,963 | 82 | 22 | 10 |
| Awas | 3,943 | 21 | 10 | 0 |

**Seberapa sering longsor tercatat per tingkat peringatan** (normalisasi baris matriks di atas):

| Peringatan | Hari | Hari dengan ≥ 1 longsor | Proporsi | Kali lipat terhadap Aman |
|---|---|---|---|---|
| Aman | 645,486 | 1,099 | 0.17% | 1.0× |
| Waspada | 47,923 | 203 | 0.42% | 2.5× |
| Siaga | 17,077 | 114 | 0.67% | 3.9× |
| Awas | 3,974 | 31 | 0.78% | 4.6× |

**Indikator** (d_11 = Aman tanpa longsor diabaikan, sesuai makalah):

| Indikator | utama: alert = Siaga ke atas | sens: alert = Waspada ke atas | sens: hanya kab/kota dengan ≥ 1 kejadian tercatat |
|---|---|---|---|
| Kab/kota | 514 | 514 | 78 |
| CA (hari) | 145 | 348 | 145 |
| MA (hari) | 1,302 | 1,099 | 1,302 |
| FA (hari) | 20,906 | 68,626 | 6,071 |
| TN (hari) | 47,720 | 0 | 9,690 |
| Indeks efisiensi (Ieff) | 0.683 | 0.005 | 0.572 |
| Hit rate (HR) | 0.100 | 0.240 | 0.100 |
| Predictive power (PP) | 0.007 | 0.005 | 0.023 |
| Threat score (TS) | 0.006 | 0.005 | 0.019 |
| Odds ratio (OR) | 2.155 | 0.005 | 1.334 |
| Missed alert rate (RMA) | 0.900 | 0.760 | 0.900 |
| False alert rate (RFA) | 0.993 | 0.995 | 0.977 |
| Error rate (ER) | 0.302 | 0.302 | 0.369 |
| Probability of serious mistakes (PSM) | 0.057 | 0.057 | 0.079 |
| Serious no-warning mistakes (PSM_NW) | 0.075 | 0.075 | 0.075 |
| Serious no-landslide mistakes (PSM_NL) | 0.057 | 0.057 | 0.081 |
| Keparahan missed alert (IMA) | 0.063 | 0.075 | 0.063 |
| Keparahan false alert (IFA) | 0.189 | 0.057 | 0.209 |

Catatan: inventaris kejadian tidak lengkap, jadi sebagian "false alert" bisa jadi longsor yang tidak tercatat. Nilai predictive power dan false alert rate karena itu batas bawah dan batas atas.
