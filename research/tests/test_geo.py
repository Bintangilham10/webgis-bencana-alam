"""Uji titik di dalam poligon (dipakai untuk memilih poligon GetFeatureInfo PVMBG).

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover research/tests
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sigap_riset.geo import contains_point  # noqa: E402


def ring(west, south, east, north):
    return [[west, south], [east, south], [east, north], [west, north], [west, south]]


class TestContainsPoint(unittest.TestCase):
    def test_lubang_dianggap_di_luar(self):
        donut = {'type': 'Polygon', 'coordinates': [ring(0, 0, 10, 10), ring(4, 4, 6, 6)]}
        self.assertTrue(contains_point(donut, 2, 2))
        self.assertFalse(contains_point(donut, 5, 5))
        self.assertFalse(contains_point(donut, 5, 11))

    def test_multipoligon(self):
        islands = {'type': 'MultiPolygon', 'coordinates': [[ring(0, 0, 1, 1)], [ring(5, 5, 6, 6)]]}
        self.assertTrue(contains_point(islands, 5.5, 5.5))
        self.assertFalse(contains_point(islands, 3, 3))

    def test_tanpa_geometri(self):
        self.assertFalse(contains_point(None, 0, 0))
        self.assertFalse(contains_point({'type': 'Point', 'coordinates': [0, 0]}, 0, 0))


if __name__ == '__main__':
    unittest.main()
