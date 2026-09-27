"""Uji EDuMaP dengan contoh di makalah Calvello & Piciullo (2016).

Tabel 7 memberi matriks durasi contoh, Tabel 8 indikator yang dihitung darinya.
Kriteria di Gambar 7 hanya berupa gambar; bentuknya direkonstruksi dari angka
Tabel 8 (yang cocok hanya satu susunan):
- Kriteria A: alert = kelas peringatan ≥ 3, kejadian = kelas longsor ≥ 3.
- Kriteria B: ungu di d_14, d_24, d_41 (dan sel bernilai 0 d_13, d_42);
  merah di d_23, d_31, d_32; sisanya hijau/kuning.
"""

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sigap_riset.edumap import alert_classification, duration_matrix, grade_by_distance, indicators  # noqa: E402

PAPER_D = np.array([
    [8719, 0, 0, 3],
    [13, 0, 1, 3],
    [5, 5, 0, 1],
    [18, 0, 5, 8],
], dtype=float)

PAPER_B = np.array([
    [None, 'Yel', 'Pur', 'Pur'],
    ['Gre', 'Gre', 'Red', 'Pur'],
    ['Red', 'Red', 'Gre', 'Yel'],
    ['Pur', 'Pur', 'Yel', 'Gre'],
], dtype=object)


class TestEdumap(unittest.TestCase):
    def test_indikator_tabel_8_makalah(self):
        result = indicators(PAPER_D, alert_classification(4, 4, alert_from=3, event_from=3), PAPER_B)
        expected = {
            'Ieff': 0.44, 'HR': 0.67, 'PP': 0.33, 'TS': 0.29, 'OR': 0.77, 'MR': 0.56, 'RMA': 0.33, 'RFA': 0.67,
            'ER': 0.56, 'PSM': 0.39, 'PSM_NW': 1.0, 'PSM_NL': 0.5, 'IMA': 0.86, 'IFA': 0.64,
        }
        for key, value in expected.items():
            self.assertAlmostEqual(result[key], value, places=2, msg=key)

    def test_matriks_durasi_menjumlah_lama_analisis(self):
        d = duration_matrix([1, 1, 3, 4, 2], [1, 2, 1, 4, 1], [10, 10, 11, 8, 10])
        self.assertEqual(d.sum(), 49)
        self.assertEqual(d[0, 0], 10)
        self.assertEqual(d[3, 3], 8)

    def test_warna_menurut_selisih_kelas(self):
        grade = grade_by_distance(4, 4)
        self.assertIsNone(grade[0, 0])
        self.assertEqual(grade[1, 1], 'Gre')
        self.assertEqual(grade[2, 1], 'Yel')
        self.assertEqual(grade[0, 2], 'Red')
        self.assertEqual(grade[3, 0], 'Pur')


if __name__ == '__main__':
    unittest.main()
