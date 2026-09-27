"""Uji metrik dengan data buatan yang jawabannya diketahui.

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover research/tests
"""

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sigap_riset.metrik import bootstrap_ci, concordance, per_case, pooled_auc, rank_average, summarize  # noqa: E402


def sample(case_scores: list[int], controls: list[list[int]]) -> pd.DataFrame:
    rows = []
    for i, (s, cs) in enumerate(zip(case_scores, controls)):
        rows.append({'kasus_id': f'k{i}', 'jenis': 'kasus', 'skor': s})
        rows += [{'kasus_id': f'k{i}', 'jenis': 'kontrol_prov', 'skor': c} for c in cs]
    return pd.DataFrame(rows)


class TestMetrik(unittest.TestCase):
    def test_konkordansi_menghitung_seri_setengah(self):
        self.assertEqual(concordance(2, np.array([1, 2, 3])), (1 + 0.5 + 0) / 3)

    def test_peringkat_rata_rata_untuk_seri(self):
        np.testing.assert_array_equal(rank_average(np.array([3, 1, 3, 2])), [3.5, 1, 3.5, 2])

    def test_auc_gabungan(self):
        self.assertEqual(pooled_auc([3, 3], [1, 2]), 1.0)
        self.assertEqual(pooled_auc([2, 2], [2, 2]), 0.5)
        self.assertEqual(pooled_auc([1], [2]), 0.0)

    def test_ringkasan_berpasangan(self):
        s = sample([3, 2, 0], [[1, 1, 3], [2, 0, 0], [0, 1, 2]])
        summary = summarize(per_case(s, 'skor', 'kontrol_prov'))
        # konkordansi: k0 = (1+1+0.5)/3, k1 = (0.5+1+1)/3, k2 = (0.5+0+0)/3
        self.assertAlmostEqual(summary['auc'], (2.5 / 3 + 2.5 / 3 + 0.5 / 3) / 3)
        self.assertAlmostEqual(summary['pod_2'], 2 / 3)
        self.assertAlmostEqual(summary['pofd_2'], 3 / 9)
        self.assertAlmostEqual(summary['tss_2'], 2 / 3 - 3 / 9)
        self.assertAlmostEqual(summary['pod_3'], 1 / 3)
        self.assertAlmostEqual(summary['pofd_3'], 1 / 9)

    def test_bootstrap_ci_mengapit_nilai_dan_stabil(self):
        rng = np.random.default_rng(1)
        cases = [int(v) for v in rng.integers(1, 4, 200)]
        controls = [[int(v) for v in rng.integers(0, 3, 10)] for _ in cases]
        table = per_case(sample(cases, controls), 'skor', 'kontrol_prov')
        stat = lambda t: t['konkordansi'].mean()  # noqa: E731
        lo, hi = bootstrap_ci(table, stat, n=300)
        self.assertLess(lo, stat(table))
        self.assertGreater(hi, stat(table))
        self.assertEqual((lo, hi), bootstrap_ci(table, stat, n=300))


if __name__ == '__main__':
    unittest.main()
