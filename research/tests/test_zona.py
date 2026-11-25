"""Uji zona notifikasi gempa dengan data buatan yang jawabannya bisa dihitung tangan.

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover -s research/tests
"""

import math
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sigap_riset import zona  # noqa: E402


def lurus(magnitudo, jarak_km):
    """Hubungan buatan: intensitas turun 1 tiap 100 km."""
    return magnitudo - jarak_km / 100


def gempa(*baris) -> pd.DataFrame:
    """Baris: (id, magnitudo, kedalaman_km); semua di (0, 0)."""
    return pd.DataFrame([{'id': i, 'magnitudo': m, 'kedalaman_km': h, 'lat': 0.0, 'lon': 0.0} for i, m, h in baris]).set_index('id')


def laporan(*baris) -> pd.DataFrame:
    return pd.DataFrame([{'gempa_id': g, 'jarak_episenter_km': d} for g, d in baris])


# Titik di khatulistiwa: 0,5° ≈ 55,6 km, 1° ≈ 111,2 km, 2° ≈ 222,4 km dari (0, 0).
TITIK = np.array([[0.0, 0.5], [0.0, 1.0], [0.0, 2.0]])


class TestRadius(unittest.TestCase):
    def test_jarak_hiposenter_diubah_ke_jarak_di_permukaan(self):
        # Ambang 3 pada M 5: jarak hiposenter 200 km; dengan kedalaman 120 km, 160 km di permukaan.
        self.assertAlmostEqual(zona.radius_km(lurus, 5, 120, 3), 160, delta=0.1)

    def test_hubungan_berjarak_episenter_tidak_memakai_kedalaman(self):
        self.assertAlmostEqual(zona.radius_km(lurus, 5, 120, 3, jarak='episenter'), 200, delta=0.1)

    def test_nol_bila_di_episenter_pun_di_bawah_ambang(self):
        # M 3,5 pada kedalaman 60 km: tepat di atasnya 2,9, di bawah ambang 3.
        self.assertEqual(zona.radius_km(lurus, 3.5, 60, 3), 0.0)

    def test_dibatasi_batas_pencarian(self):
        self.assertEqual(zona.radius_km(lambda m, r: 9.0, 5, 10, 3), zona.R_MAKS_KM)

    def test_jenis_jarak_tak_dikenal_ditolak(self):
        with self.assertRaises(ValueError):
            zona.radius_km(lurus, 5, 10, 3, jarak='rupture')

    def test_radius_tiap_gempa(self):
        g = gempa(('a', 5, 0), ('b', 4, 0))
        radius = zona.radius_gempa(g, lurus, 3, jarak='episenter')
        self.assertAlmostEqual(radius['a'], 200, delta=0.1)
        self.assertAlmostEqual(radius['b'], 100, delta=0.1)

    def test_ambang_boleh_berbeda_tiap_gempa(self):
        g = gempa(('a', 5, 0), ('b', 4, 0))
        radius = zona.radius_gempa(g, lurus, pd.Series({'b': 3.5, 'a': 2.0}), jarak='episenter')
        self.assertAlmostEqual(radius['a'], 300, delta=0.1)
        self.assertAlmostEqual(radius['b'], 50, delta=0.1)
        with self.assertRaises(ValueError):
            zona.radius_gempa(g, lurus, pd.Series({'a': 2.0}), jarak='episenter')


class TestCakupanDanBiaya(unittest.TestCase):
    def setUp(self):
        self.gempa = gempa(('a', 5, 0), ('b', 4, 0), ('c', 2, 0))
        self.laporan = laporan(('a', 50), ('a', 190), ('a', 260), ('b', 90), ('b', 104), ('c', 5))
        # Ambang 3, jarak episenter: radius a = 200 km, b = 100 km, c = 0 (M 2 di bawah ambang).
        self.radius = zona.radius_gempa(self.gempa, lurus, 3, jarak='episenter')

    def test_kabkota_dalam_radius(self):
        jumlah = zona.kabkota_dalam_radius(self.gempa, self.radius, TITIK)
        self.assertEqual(jumlah.tolist(), [2, 1, 0])

    def test_tabel_per_gempa_dan_cakupan(self):
        tabel = zona.tabel_per_gempa(self.gempa, self.laporan, self.radius, TITIK)
        self.assertEqual(tabel['n_laporan'].tolist(), [3, 2, 1])
        self.assertEqual(tabel['n_terjangkau'].tolist(), [2, 1, 0])
        self.assertEqual(tabel['n_kabkota'].tolist(), [2, 1, 0])
        self.assertAlmostEqual(tabel.loc['b', 'luas_km2'], math.pi * 100 ** 2, delta=40)
        self.assertAlmostEqual(zona.cakupan(tabel), 3 / 6)

    def test_toleransi_memperluas_jangkauan_tetapi_tidak_untuk_radius_nol(self):
        tabel = zona.tabel_per_gempa(self.gempa, self.laporan, self.radius, TITIK, toleransi_km=25)
        # 104 km masuk (≤ 125), 260 km tetap di luar (> 225); gempa c tetap tidak memberi tahu siapa pun.
        self.assertEqual(tabel['n_terjangkau'].tolist(), [2, 2, 0])

    def test_laporan_dari_gempa_lain_diabaikan(self):
        lebih = pd.concat([self.laporan, laporan(('z', 1), ('z', 2))], ignore_index=True)
        tabel = zona.tabel_per_gempa(self.gempa, lebih, self.radius, TITIK)
        self.assertEqual(tabel['n_laporan'].tolist(), [3, 2, 1])
        self.assertAlmostEqual(zona.cakupan(tabel), 3 / 6)
        kisi = np.array([2.0, 2.5, 3.0, 3.5])
        self.assertEqual(zona.ambang_setara(self.gempa, lebih, lurus, 0.5, kisi, jarak='episenter'), 3.0)

    def test_gempa_tanpa_laporan_tetap_dihitung_biayanya(self):
        tabel = zona.tabel_per_gempa(self.gempa, self.laporan[self.laporan['gempa_id'] != 'b'], self.radius, TITIK)
        self.assertEqual(tabel.loc['b', ['n_laporan', 'n_terjangkau', 'n_kabkota']].tolist(), [0, 0, 1])

    def test_ambang_setara_memilih_zona_tersempit_yang_memenuhi_target(self):
        kisi = np.array([2.0, 2.5, 3.0, 3.5])
        # Ambang 3,5: radius a 150, b 50 → hanya laporan 50 km (1/6).
        # Ambang 3:   radius a 200, b 100 → 3/6.
        # Ambang 2,5: radius a 250, b 150, c 0 → 4/6 (laporan 260 km masih di luar).
        # Ambang 2:   radius a 300, b 200, c 0 (M 2 tepat di ambang hanya di episenter) → 5/6.
        self.assertEqual(zona.ambang_setara(self.gempa, self.laporan, lurus, 0.5, kisi, jarak='episenter'), 3.0)
        self.assertEqual(zona.ambang_setara(self.gempa, self.laporan, lurus, 0.6, kisi, jarak='episenter'), 2.5)
        self.assertEqual(zona.ambang_setara(self.gempa, self.laporan, lurus, 0.8, kisi, jarak='episenter'), 2.0)
        self.assertIsNone(zona.ambang_setara(self.gempa, self.laporan, lurus, 0.99, kisi, jarak='episenter'))


class TestBootstrap(unittest.TestCase):
    def tabel(self, terjangkau, kabkota):
        return pd.DataFrame({'radius_km': 100.0, 'n_laporan': [4, 2, 4], 'n_terjangkau': terjangkau, 'n_kabkota': kabkota,
                             'luas_km2': 1.0}, index=['a', 'b', 'c'])

    def test_aturan_yang_sama_tidak_berbeda(self):
        a = self.tabel([3, 1, 2], [10, 20, 30])
        hasil = zona.banding_aturan(a, a, n=200, seed=1)
        self.assertEqual(hasil['selisih_cakupan'], 0)
        self.assertEqual(hasil['selisih_cakupan_ci'], (0.0, 0.0))
        self.assertEqual(hasil['nisbah_kabkota'], 1)

    def test_selisih_dan_nisbah_antara_dua_aturan(self):
        a = self.tabel([3, 1, 2], [10, 20, 30])
        b = self.tabel([4, 2, 4], [40, 40, 40])
        hasil = zona.banding_aturan(a, b, n=500, seed=1)
        self.assertAlmostEqual(hasil['selisih_cakupan'], (6 - 10) / 10)
        self.assertAlmostEqual(hasil['selisih_kabkota'], 20 - 40)
        self.assertAlmostEqual(hasil['nisbah_kabkota'], 60 / 120)
        bawah, atas = hasil['selisih_cakupan_ci']
        self.assertLessEqual(bawah, hasil['selisih_cakupan'])
        self.assertGreaterEqual(atas, hasil['selisih_cakupan'])
        self.assertLessEqual(bawah, hasil['selisih_cakupan_batas_bawah_satu_sisi'])
        # Seed yang sama memberi selang yang sama.
        self.assertEqual(hasil, zona.banding_aturan(a, b, n=500, seed=1))

    def test_tabel_dengan_gempa_berbeda_ditolak(self):
        a = self.tabel([3, 1, 2], [10, 20, 30])
        with self.assertRaises(ValueError):
            zona.banding_aturan(a, a.iloc[::-1])

    def test_ringkas_aturan(self):
        hasil = zona.ringkas_aturan(self.tabel([3, 1, 2], [10, 20, 30]), n=200, seed=1)
        self.assertEqual((hasil['n_gempa'], hasil['n_laporan']), (3, 10))
        self.assertAlmostEqual(hasil['cakupan'], 0.6)
        self.assertAlmostEqual(hasil['kabkota_per_gempa'], 20)
        self.assertEqual(hasil['gempa_radius_nol'], 0)
        self.assertLessEqual(hasil['cakupan_ci'][0], 0.6)
        self.assertGreaterEqual(hasil['cakupan_ci'][1], 0.6)


if __name__ == '__main__':
    unittest.main()
