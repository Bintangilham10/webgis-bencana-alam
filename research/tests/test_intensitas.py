"""Uji hubungan intensitas–jarak: kalibrasi IPE-ID dengan data buatan, dan hubungan dari
pustaka dengan angka yang dihitung tangan dari rumusnya.

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover -s research/tests
"""

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sigap_riset import intensitas, zona  # noqa: E402
from sigap_riset.intensitas import IpeLinear  # noqa: E402

# Firdaus dkk. (2026), Tabel 2 "Shaking radius estimation", baris 1–8:
# (magnitudo, kedalaman km, MMI sasaran dari BMKG, PGA tercetak dalam Gal, radius tercetak dalam km).
# PGA tercetak ternyata nilai pada jarak episenter 1 km. Baris 9 dan 10 tabel itu tidak
# cocok dengan masukan yang tercetak di barisnya sendiri, jadi tidak dipakai sebagai acuan.
TABEL_2_RUJUKAN = [
    (3.4, 21, 3, 19.22, 4.51),
    (2.8, 5, 3, 48.58, 12.06),
    (5.4, 10, 4, 197.46, 54.15),
    (4.1, 12, 3, 64.16, 34.72),
    (7.7, 47, 6, 213.27, 63.28),
    (4.4, 2, 3, 292.13, 45.38),
    (4.5, 17, 3, 63.42, 45.56),
    (3.2, 26, 2, 12.51, 17.53),
]


def buatan(ipe: IpeLinear, n_gempa: int = 12, per_gempa: int = 5, jarak_maks: float = 300.0, seed: int = 7) -> pd.DataFrame:
    """Laporan buatan tanpa derau dari sebuah hubungan yang diketahui."""
    acak = np.random.default_rng(seed)
    baris = []
    for g in range(n_gempa):
        magnitudo = 3 + 3 * acak.random()
        for jarak in 10 + (jarak_maks - 10) * acak.random(per_gempa):
            baris.append({'gempa_id': f'g{g}', 'magnitudo': magnitudo, 'jarak_hiposenter_km': jarak, 'mmi': float(ipe(magnitudo, jarak))})
    return pd.DataFrame(baris)


class TestRujukan(unittest.TestCase):
    def test_pga_di_tabel_makalah(self):
        for magnitudo, kedalaman, _, pga, _ in TABEL_2_RUJUKAN:
            with self.subTest(magnitudo=magnitudo, kedalaman=kedalaman):
                hitung = float(intensitas.pga_fukushima_tanaka(magnitudo, np.hypot(1, kedalaman)))
                self.assertAlmostEqual(hitung, pga, delta=0.006)

    def test_radius_di_tabel_makalah(self):
        for magnitudo, kedalaman, sasaran, _, radius in TABEL_2_RUJUKAN:
            with self.subTest(magnitudo=magnitudo, kedalaman=kedalaman):
                hitung = zona.radius_km(intensitas.mmi_rujukan, magnitudo, kedalaman, sasaran, jarak=intensitas.JARAK_RUJUKAN)
                # Bagi dua berhenti dalam 0,05 km di bawah akarnya; angka tercetak berdua desimal.
                self.assertAlmostEqual(hitung, radius, delta=0.06)

    def test_tanpa_radius_bila_di_episenter_pun_di_bawah_sasaran(self):
        # Baris 10 tabel itu (M 4,4; 29 km; sasaran 4): tepat di atas hiposenter 3,88.
        self.assertAlmostEqual(float(intensitas.mmi_rujukan(4.4, 29)), 3.879, places=3)
        self.assertEqual(zona.radius_km(intensitas.mmi_rujukan, 4.4, 29, 4, jarak=intensitas.JARAK_RUJUKAN), 0.0)

    def test_intensitas_turun_terhadap_jarak(self):
        jarak = np.array([1, 10, 50, 100, 300, 800])
        self.assertTrue(np.all(np.diff(intensitas.mmi_rujukan(6.0, jarak)) < 0))


class TestAllen2012(unittest.TestCase):
    def test_nilai_hitung_tangan(self):
        # M 6, R 30 km: RM = −0,209 + 2,042·e = 5,3417; √(900 + 28,534) = 30,4719; ln = 3,41680
        #   → 2,085 + 8,568 − 1,402 × 3,41680 = 5,8626 (R ≤ 50 km, tanpa suku tambahan).
        self.assertAlmostEqual(float(intensitas.mmi_allen2012(6.0, 30)), 5.8626, places=4)
        # M 7, R 120 km: RM = 14,8795; √(14400 + 221,40) = 120,9190; ln = 4,79512
        #   → 2,085 + 9,996 − 1,402 × 4,79512 = 5,3582, ditambah 0,078 × ln(120/50) = 0,0683.
        self.assertAlmostEqual(float(intensitas.mmi_allen2012(7.0, 120)), 5.4265, places=4)

    def test_bersambung_di_50_km_dan_turun_terhadap_jarak(self):
        self.assertAlmostEqual(float(intensitas.mmi_allen2012(5.0, 50)), float(intensitas.mmi_allen2012(5.0, 50.0001)), places=4)
        jarak = np.array([1, 5, 20, 49.9, 50, 50.1, 100, 300, 1000, 2000.0])
        for magnitudo in (2.5, 4.0, 6.0, 8.0):
            with self.subTest(magnitudo=magnitudo):
                self.assertTrue(np.all(np.diff(intensitas.mmi_allen2012(magnitudo, jarak)) < 0))

    def test_radius_dari_hubungan_ini(self):
        # M 6 pada kedalaman 10 km, ambang 4: jarak hiposenter tempat nilainya 4, lalu ke permukaan.
        radius = zona.radius_km(intensitas.mmi_allen2012, 6.0, 10, 4.0, jarak=intensitas.JARAK_ALLEN2012)
        self.assertAlmostEqual(float(intensitas.mmi_allen2012(6.0, np.hypot(radius, 10))), 4.0, delta=0.002)
        self.assertGreater(radius, 50)


class TestIpeLinear(unittest.TestCase):
    def test_nilai_dan_jarak_terkecil(self):
        ipe = IpeLinear(1.0, 1.0, -2.0)
        self.assertAlmostEqual(ipe(5, 100), 1 + 5 - 4)
        # Jarak di bawah 1 km diperlakukan sebagai 1 km (log10 = 0).
        self.assertAlmostEqual(ipe(5, 0), 6)

    def test_tanda_koefisien_yang_fisis(self):
        self.assertTrue(IpeLinear(1, 1, -2).fisis)
        self.assertTrue(IpeLinear(1, 1, -2, -0.001).fisis)
        self.assertFalse(IpeLinear(1, -0.1, -2).fisis)
        self.assertFalse(IpeLinear(1, 1, 0.5).fisis)
        self.assertFalse(IpeLinear(1, 1, -2, 0.001).fisis)

    def test_kalibrasi_menemukan_koefisien_data_tanpa_derau(self):
        asli = IpeLinear(1.5, 1.2, -2.5)
        data = buatan(asli)
        hasil = intensitas.kalibrasi(data['magnitudo'], data['jarak_hiposenter_km'], data['mmi'])
        for nama in ('c0', 'c1', 'c2'):
            self.assertAlmostEqual(getattr(hasil, nama), getattr(asli, nama), places=8)
        self.assertEqual(hasil.c3, 0.0)

    def test_kalibrasi_dengan_suku_anelastik(self):
        asli = IpeLinear(2.0, 1.1, -1.8, -0.003)
        data = buatan(asli, jarak_maks=800)
        hasil = intensitas.kalibrasi(data['magnitudo'], data['jarak_hiposenter_km'], data['mmi'], anelastik=True)
        self.assertAlmostEqual(hasil.c3, -0.003, places=8)
        self.assertAlmostEqual(hasil.c2, -1.8, places=6)


class TestValidasiSilang(unittest.TestCase):
    def test_laporan_gempa_itu_sendiri_tidak_ikut_mengalibrasi(self):
        asli = IpeLinear(1.5, 1.2, -2.5)
        data = buatan(asli)
        # Semua laporan satu gempa digeser +2: perkiraan untuk gempa itu harus tetap dari
        # hubungan aslinya, karena dikalibrasi dari gempa-gempa lain yang tidak digeser.
        geser = data['gempa_id'] == 'g3'
        data.loc[geser, 'mmi'] += 2
        prediksi = intensitas.prediksi_tanpa_gempanya(data)
        harapan = asli(data.loc[geser, 'magnitudo'].to_numpy(), data.loc[geser, 'jarak_hiposenter_km'].to_numpy())
        np.testing.assert_allclose(prediksi[geser.to_numpy()], harapan, atol=1e-8)
        # Kalibrasi biasa, yang memakai gempa itu juga, ikut tertarik.
        biasa = intensitas.kalibrasi(data['magnitudo'], data['jarak_hiposenter_km'], data['mmi'])
        self.assertGreater(abs(biasa.c0 - asli.c0) + abs(biasa.c1 - asli.c1) + abs(biasa.c2 - asli.c2), 1e-3)

    def test_bentuk_dasar_dipilih_bila_suku_anelastik_tidak_menolong(self):
        ipe, catatan = intensitas.pilih_bentuk(buatan(IpeLinear(1.5, 1.2, -2.5)))
        self.assertEqual(catatan['terpilih'], 'dasar')
        self.assertEqual(ipe.c3, 0.0)
        self.assertAlmostEqual(catatan['dasar']['mae_validasi_silang'], 0, places=8)

    def test_bentuk_anelastik_dipilih_bila_fisis_dan_jelas_lebih_baik(self):
        asli = IpeLinear(2.0, 1.1, -1.8, -0.004)
        ipe, catatan = intensitas.pilih_bentuk(buatan(asli, n_gempa=20, jarak_maks=900))
        self.assertEqual(catatan['terpilih'], 'anelastik')
        self.assertAlmostEqual(ipe.c3, -0.004, places=6)
        self.assertGreater(catatan['dasar']['mae_validasi_silang'] - catatan['anelastik']['mae_validasi_silang'], intensitas.UNTUNG_MIN_ANELASTIK)

    def test_suku_anelastik_yang_tidak_fisis_ditolak_walau_galatnya_lebih_kecil(self):
        # Intensitas buatan yang naik lagi di jarak jauh: c3 hasil kalibrasi positif.
        ipe, catatan = intensitas.pilih_bentuk(buatan(IpeLinear(2.0, 1.1, -1.8, 0.004), n_gempa=20, jarak_maks=900))
        self.assertFalse(catatan['anelastik']['fisis'])
        self.assertEqual(catatan['terpilih'], 'dasar')
        self.assertEqual(ipe.c3, 0.0)


class TestGalat(unittest.TestCase):
    def test_bias_mae_rmse(self):
        hasil = intensitas.galat([4, 2, 5], [3, 3, 3], ['a', 'a', 'b'], n=300, seed=1)
        self.assertEqual((hasil['n_laporan'], hasil['n_gempa']), (3, 2))
        self.assertAlmostEqual(hasil['bias'], 2 / 3)
        self.assertAlmostEqual(hasil['mae'], 4 / 3)
        self.assertAlmostEqual(hasil['rmse'], (6 / 3) ** 0.5)
        self.assertLessEqual(hasil['mae_ci'][0], hasil['mae'])
        self.assertGreaterEqual(hasil['mae_ci'][1], hasil['mae'])
        self.assertEqual(hasil, intensitas.galat([4, 2, 5], [3, 3, 3], ['a', 'a', 'b'], n=300, seed=1))

    def test_titik_tengah_rentang_bmkg(self):
        np.testing.assert_allclose(intensitas.mmi_tengah([2, 3, 4], [3, 3, 5]), [2.5, 3.0, 4.5])


if __name__ == '__main__':
    unittest.main()
