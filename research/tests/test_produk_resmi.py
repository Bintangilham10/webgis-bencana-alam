"""Uji pembacaan balasan GetFeatureInfo PVMBG dan pemberian skor.

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover research/tests
"""

import importlib.util
import json
import sys
import unittest
from pathlib import Path

RESEARCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RESEARCH))

# Nama skrip diawali angka, jadi dimuat lewat importlib.
_spec = importlib.util.spec_from_file_location('produk_resmi', RESEARCH / '02_produk_resmi.py')
produk = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(produk)

# Potongan asli balasan layer 2025-12 (27 Sep 2026).
BROKEN_LAYER_REPLY = (
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE ServiceExceptionReport SYSTEM '
    '"http://172.16.1.228:8088/geoserver/schemas/wms/1.1.1/WMS_exception_1_1_1.dtd"> <ServiceExceptionReport version="1.1.1" >'
    '<ServiceException> The requested Style can not be used with this layer.  The style specifies an attribute named '
    '&apos;zona_perki&apos;, not found in the &apos;pmbgi:prakiraan_2025_12&apos; layer </ServiceException></ServiceExceptionReport>'
)
OTHER_ERROR = '<?xml version="1.0"?><ServiceExceptionReport><ServiceException>java.io.IOException</ServiceException></ServiceExceptionReport>'


def feature_collection(*props: dict, geometries: list | None = None) -> str:
    geometries = geometries or [None] * len(props)
    return json.dumps({'type': 'FeatureCollection',
                       'features': [{'type': 'Feature', 'properties': p, 'geometry': g} for p, g in zip(props, geometries)]})


def square(west: float, south: float, east: float, north: float) -> dict:
    return {'type': 'MultiPolygon', 'coordinates': [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]]}


class TestFeatureInfo(unittest.TestCase):
    def test_tanpa_geometri_poligon_pertama_dipakai(self):
        text = feature_collection({'zona_perki': 'Tinggi', 'unsur': 'Menengah'}, {'zona_perki': 'Menengah', 'unsur': 'Rendah'})
        self.assertEqual(produk.parse_feature_info(text, -7.3, 109.6),
                         {'ada_poligon': True, 'potensi': 'Tinggi', 'zkgt': 'Menengah', 'n_poligon': 2})

    def test_poligon_yang_memuat_titik_dipakai(self):
        # Dua zona bersebelahan; titik ada di zona kedua (kasus batas yang dulu salah dibaca).
        text = feature_collection({'zona_perki': 'Tinggi', 'unsur': 'Tinggi'}, {'zona_perki': 'Menengah', 'unsur': 'Menengah'},
                                  geometries=[square(109.6555, -7.356, 109.66, -7.35), square(109.65, -7.356, 109.6555, -7.35)])
        self.assertEqual(produk.parse_feature_info(text, -7.353, 109.655)['potensi'], 'Menengah')
        self.assertEqual(produk.parse_feature_info(text, -7.353, 109.657)['potensi'], 'Tinggi')
        # Tanpa titik: poligon pertama, seperti pembaca versi lama.
        self.assertEqual(produk.parse_feature_info(text)['potensi'], 'Tinggi')

    def test_di_luar_poligon(self):
        self.assertEqual(produk.parse_feature_info(feature_collection(), -7.3, 109.6),
                         {'ada_poligon': False, 'potensi': None, 'zkgt': None, 'n_poligon': 0})

    def test_layer_tidak_ada_atau_rusak(self):
        self.assertIsNone(produk.parse_feature_info(None))
        self.assertIsNone(produk.parse_feature_info(BROKEN_LAYER_REPLY))

    def test_hanya_galat_layer_rusak_yang_boleh_di_cache(self):
        self.assertTrue(produk.is_feature_info(feature_collection()))
        self.assertTrue(produk.is_feature_info(BROKEN_LAYER_REPLY))
        self.assertFalse(produk.is_feature_info(OTHER_ERROR))
        self.assertFalse(produk.is_feature_info('<html><title>Request Rejected</title></html>'))

    def test_skor(self):
        self.assertEqual([produk.score(v) for v in ('Tinggi', ' menengah ', 'Rendah', 'Sangat Rendah')], [3, 2, 1, 0])
        self.assertEqual([produk.score(v) for v in (None, float('nan'))], [0, 0])


if __name__ == '__main__':
    unittest.main()
