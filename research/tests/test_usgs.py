"""Uji pembacaan katalog dan produk DYFI USGS.

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover research/tests
"""

import sys
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

RESEARCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RESEARCH))

from sigap_riset import usgs  # noqa: E402

# Potongan asli cdi_geo.txt gempa Cianjur 21 Nov 2022 (us7000ir9t), diambil 24 Nov 2026.
CDI_GEO = '''# Columns: Geocoded box,CDI,No. of responses,Hypocentral distance,Latitude,Longitude,Suspect?,Standard deviation,City,State
"UTM:(48M 072 923 10000)",6.5,1,14,-6.9165,107.0363,0,0.330,"Sukabumi",""
"UTM:(48M 070 926 10000)",5.2,3,28,-6.6460,106.8543,0,0.311,"Bogor",""
"UTM:(48M 070 930 10000)",5.1,5,63,-6.2843,106.8530,1,0.293,"Depok",""
'''
# Potongan asli cdi_geo.txt bersusunan lama (gempa 2010 di lepas pantai Sumatra), diambil 24 Nov 2026.
CDI_GEO_LAMA = '''# Columns: ZIP/Location,CDI,No. of responses,Epicentral distance,Latitude,Longitude,Suspect?,City,State
"UTM:(47N 009 061 10000)",3.8,5,414,5.5526,95.3458,0,"UTM:(47N 009 061 10000)",""
"UTM:(47N 046 039 10000)",4.1,74,142,3.5736,98.6849,0,"UTM:(47N 046 039 10000)",""
'''
FITUR = {
    'id': 'us7000ir9t',
    'properties': {'mag': 5.6, 'magType': 'mww', 'time': 1669011667066, 'place': '11 km NE of Sukabumi, Indonesia', 'felt': 169,
                   'cdi': 5.1, 'mmi': 8.471, 'types': ',dyfi,origin,shakemap,', 'url': 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000ir9t',
                   'detail': 'https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us7000ir9t&format=geojson'},
    'geometry': {'type': 'Point', 'coordinates': [106.9968, -6.836, 10]},
}


class Katalog(unittest.TestCase):
    def test_kueri_memakai_wilayah_aplikasi_dan_syarat_respons(self):
        q = parse_qs(urlparse(usgs.url_daftar('2010-01-01', '2026-11-24', 5.0, 10)).query)
        self.assertEqual((q['minlatitude'], q['maxlatitude'], q['minlongitude'], q['maxlongitude']), (['-12'], ['7'], ['94'], ['142']))
        self.assertEqual((q['minmagnitude'], q['minfelt'], q['starttime'], q['endtime']), (['5.0'], ['10'], ['2010-01-01'], ['2026-11-24']))

    def test_baris_kejadian(self):
        k = usgs.baris_kejadian(FITUR)
        self.assertEqual((k['id'], k['waktu_utc'], k['lat'], k['lon'], k['kedalaman_km']), ('us7000ir9t', '2022-11-21T06:21:07Z', -6.836, 106.9968, 10))
        self.assertEqual((k['magnitudo'], k['negara'], k['n_respons'], k['ada_shakemap']), (5.6, 'Indonesia', 169, True))

    def test_gempa_di_laut_tanpa_nama_negara(self):
        fitur = {**FITUR, 'properties': {**FITUR['properties'], 'place': 'Banda Sea', 'types': ',dyfi,origin,'}}
        k = usgs.baris_kejadian(fitur)
        self.assertEqual((k['negara'], k['ada_shakemap']), ('', False))


class Dyfi(unittest.TestCase):
    def test_berkas_produk_utama(self):
        detail = {'properties': {'products': {'dyfi': [
            {'contents': {'cdi_geo.txt': {'url': 'https://x/cdi_geo.txt'}, 'dyfi_geo_10km.geojson': {'url': 'https://x/geo.json'}}},
            {'contents': {'cdi_geo.txt': {'url': 'https://x/lama.txt'}}}]}}}
        self.assertEqual(usgs.berkas_dyfi(detail), ('https://x/cdi_geo.txt', 'https://x/geo.json', None))
        self.assertEqual(usgs.berkas_dyfi({'properties': {'products': {}}}), (None, None, None))

    def test_gempa_lama_hanya_punya_rangkuman_per_kota(self):
        detail = {'properties': {'products': {'dyfi': [{'contents': {'cdi_zip.txt': {'url': 'https://x/cdi_zip.txt'}}}]}}}
        self.assertEqual(usgs.berkas_dyfi(detail), (None, None, 'https://x/cdi_zip.txt'))
        # Potongan asli cdi_zip.txt gempa usp000j5dj (2011), diambil 24 Nov 2026.
        baris = usgs.baca_cdi_geo('# Columns: ZIP/Location,CDI,No. of responses,Epicentral distance,Latitude,Longitude,Suspect?,City,State\n'
                                  '"Bogor::Jawa Barat::Indonesia",2.6,7,132,-6.5800,106.7900,0,"Bogor",""\n')
        self.assertEqual((baris[0]['kotak'], baris[0]['tempat'], baris[0]['cdi'], baris[0]['n_respons'], baris[0]['jenis_jarak_usgs']),
                         ('Bogor::Jawa Barat::Indonesia', 'Bogor', 2.6, 7, 'episenter'))

    def test_cdi_geo(self):
        baris = usgs.baca_cdi_geo(CDI_GEO)
        self.assertEqual(len(baris), 3)
        self.assertEqual(baris[0], {'kotak': 'UTM:(48M 072 923 10000)', 'cdi': 6.5, 'n_respons': 1, 'lat': -6.9165, 'lon': 107.0363,
                                    'meragukan': False, 'simpangan_baku': 0.33, 'tempat': 'Sukabumi',
                                    'jarak_usgs_km': 14.0, 'jenis_jarak_usgs': 'hiposenter'})
        self.assertTrue(baris[2]['meragukan'])

    def test_cdi_geo_susunan_lama(self):
        # Berkas gempa lama: tanpa simpangan baku, jarak episenter, dan kolom City mengulang nama kotak.
        baris = usgs.baca_cdi_geo(CDI_GEO_LAMA)
        self.assertEqual(baris[0], {'kotak': 'UTM:(47N 009 061 10000)', 'cdi': 3.8, 'n_respons': 5, 'lat': 5.5526, 'lon': 95.3458,
                                    'meragukan': False, 'simpangan_baku': None, 'tempat': '',
                                    'jarak_usgs_km': 414.0, 'jenis_jarak_usgs': 'episenter'})
        self.assertEqual(baris[1]['n_respons'], 74)

    def test_geojson_sebagai_cadangan(self):
        geo = {'features': [{'geometry': {'type': 'Polygon', 'coordinates': [[[107.0, -7.0], [107.1, -7.0], [107.1, -6.9], [107.0, -6.9]]]},
                             'properties': {'stddev': 0.33, 'nresp': 4, 'name': 'UTM:(48M 072 923 10000)<br>Sukabumi', 'cdi': 6.5, 'dist': 14}}]}
        b = usgs.baca_geojson(geo)[0]
        self.assertEqual((b['kotak'], b['tempat'], b['cdi'], b['n_respons']), ('UTM:(48M 072 923 10000)', 'Sukabumi', 6.5, 4))
        self.assertAlmostEqual(b['lat'], -6.95)
        self.assertAlmostEqual(b['lon'], 107.05)


if __name__ == '__main__':
    unittest.main()
