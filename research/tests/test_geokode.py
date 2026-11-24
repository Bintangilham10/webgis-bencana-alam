"""Uji pemilihan tempat untuk nama lokasi laporan gempa dirasakan.

Gazetir kecil di bawah meniru kasus nyata di arsip Sep–Nov 2026; koordinatnya
dibulatkan dari tempat aslinya.

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover research/tests
"""

import sys
import tempfile
import unittest
from pathlib import Path

RESEARCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RESEARCH))

from sigap_riset import geokode  # noqa: E402
from sigap_riset.geokode import Gazetir, jangkauan_km, kunci  # noqa: E402


def wil(kode: str, nama: str, lat: float, lon: float) -> dict:
    return {'kode': kode, 'nama': nama, 'tingkat': 'kota' if nama.startswith('Kota') else 'kabupaten', 'provinsi': '', 'lat': lat, 'lon': lon}


def gn(id_: int, nama: str, lat: float, lon: float, kode: str, admin2: str = '', lain: str = '', penduduk: int = 0) -> list[str]:
    """Satu baris GeoNames (19 kolom) dengan kolom yang dipakai saja."""
    kelas = 'A' if kode.startswith('ADM') else 'T' if kode.startswith('ISL') else 'P'
    return [str(id_), nama, nama, lain, str(lat), str(lon), kelas, kode, 'ID', '', '00', admin2, '', '', str(penduduk), '', '', '', '']


WILAYAH = [
    wil('32.02', 'Kabupaten Sukabumi', -7.07, 106.71), wil('32.72', 'Kota Sukabumi', -6.94, 106.93),
    wil('32.03', 'Kabupaten Cianjur', -7.13, 107.14), wil('32.15', 'Kabupaten Karawang', -6.27, 107.37),
    wil('33.11', 'Kabupaten Sukoharjo', -7.68, 110.83), wil('18.06', 'Kabupaten Tanggamus', -5.39, 104.62),
    wil('73.01', 'Kabupaten Kepulauan Selayar', -6.83, 120.80), wil('53.04', 'Kabupaten Belu', -9.14, 124.90),
    wil('17.02', 'Kabupaten Rejang Lebong', -3.43, 102.72),
]
GEONAMES = [
    # Kab/kota (ADM2) dan ibu kotanya (PPLA2), dihubungkan lewat kode admin2.
    gn(1, 'Kabupaten Sukabumi', -7.07, 106.70, 'ADM2', '3202'), gn(2, 'Pelabuhanratu', -6.99, 106.55, 'PPLA2', '3202', 'Palabuhanratu,Pelabuhan Ratu'),
    gn(3, 'Kota Sukabumi', -6.92, 106.93, 'ADM2', '3272'), gn(4, 'Sukabumi', -6.92, 106.93, 'PPLA2', '3272'),
    gn(5, 'Kabupaten Cianjur', -7.13, 107.14, 'ADM2', '3203'), gn(6, 'Cianjur', -6.82, 107.14, 'PPLA2', '3203'),
    gn(7, 'Kabupaten Sukoharjo', -7.68, 110.83, 'ADM2', '3311'), gn(8, 'Sukoharjo', -7.68, 110.84, 'PPLA2', '3311'),
    gn(9, 'Kabupaten Tanggamus', -5.39, 104.62, 'ADM2', '1806'), gn(10, 'Kota Agung', -5.49, 104.63, 'PPLA2', '1806', 'Kotaagung'),
    gn(11, 'Kabupaten Kepulauan Selayar', -6.83, 120.80, 'ADM2', '7301'), gn(12, 'Benteng', -6.12, 120.46, 'PPLA2', '7301'),
    gn(13, 'Kabupaten Rejang Lebong', -3.43, 102.72, 'ADM2', '1702'), gn(14, 'Curup', -3.47, 102.52, 'PPLA2', '1702'),
    # Kecamatan, desa, kampung, dan pulau yang namanya dipakai beberapa tempat.
    gn(20, 'Kecamatan Sukoharjo', -5.30, 104.98, 'ADM3'), gn(21, 'Sukoharjo', -5.31, 104.99, 'PPLA3'),
    gn(22, 'Curup', -3.90, 102.30, 'PPL'),
    gn(23, 'Desa Romang', -5.20, 119.50, 'ADM4'), gn(24, 'Pulau Romang', -7.58, 127.40, 'ISL'),
    gn(25, 'Kecamatan Cisarua', -6.68, 106.94, 'ADM3'), gn(26, 'Kecamatan Cisarua', -6.81, 107.54, 'ADM3'),
    gn(27, 'Kecamatan Ngamprah', -6.84, 107.51, 'ADM3'),
    gn(28, 'Kecamatan Ulu Belu', -5.30, 104.55, 'ADM3'), gn(29, 'Kecamatan Ulu Belu', 1.50, 99.00, 'ADM3'),
    gn(30, 'Bentengjampea', -7.07, 120.65, 'PPL'), gn(31, 'Benteng', -5.00, 119.60, 'PPL'),
    gn(32, 'Kecamatan Ranomeeto', -4.05, 122.42, 'ADM3'),
    gn(33, 'Kecamatan Sumur', -6.66, 105.58, 'ADM3'), gn(34, 'Sumur', -6.65, 105.59, 'PPLA3'),
]


class Dasar(unittest.TestCase):
    def test_kunci_nama(self):
        self.assertEqual(kunci('Kep. Selayar'), 'kepulauanselayar')
        self.assertEqual(kunci('Toli-Toli'), kunci('Tolitoli'))
        self.assertEqual(kunci('Palabuhan Ratu'), 'palabuhanratu')

    def test_jangkauan_wajar(self):
        self.assertEqual(jangkauan_km(3.0), 100)
        self.assertEqual(jangkauan_km(4.5), 200)
        self.assertEqual(jangkauan_km(4.5, 80), 300)
        self.assertEqual(jangkauan_km(9.0), 1200)


class Pemilihan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.g = Gazetir(WILAYAH, GEONAMES)

    def test_kabupaten_memakai_ibu_kota_dan_menyimpan_titik_wakil(self):
        h = self.g.cari('Kab. Sukabumi', None, -7.3, 106.6, 4.6)
        self.assertEqual((h.tempat.nama, h.tempat.presisi, h.kepastian), ('Kabupaten Sukabumi', 'kabupaten', 'tunggal'))
        self.assertEqual((h.tempat.lat, h.tempat.lon), (-6.99, 106.55))
        self.assertEqual((h.tempat.lat_wakil, h.tempat.lon_wakil), (-7.07, 106.71))
        self.assertEqual(h.tempat.titik, 'ibu kota (Pelabuhanratu)')

    def test_nama_polos_kota_dan_kabupaten_berarti_kotanya(self):
        h = self.g.cari('Sukabumi', None, -7.3, 106.6, 4.6)
        self.assertEqual(h.tempat.nama, 'Kota Sukabumi')

    def test_kota_bukan_kota_otonom_berarti_ibu_kota_kabupaten(self):
        h = self.g.cari('Kota Cianjur', None, -6.86, 107.05, 2.4)
        self.assertEqual((h.tempat.nama, h.tempat.presisi), ('Cianjur', 'ibu kota'))
        self.assertEqual((h.tempat.lat, h.tempat.lon), (-6.82, 107.14))

    def test_nama_kabupaten_di_luar_jangkauan_berarti_tempat_lain_bernama_sama(self):
        # Gempa M 3,4 di Tanggamus menyebut "Sukoharjo": kecamatan di Lampung, bukan kabupaten di Jawa Tengah.
        dekat = self.g.cari('Sukoharjo', None, -5.35, 104.60, 3.4, 4)
        self.assertEqual((dekat.tempat.presisi, dekat.tempat.nama), ('kecamatan', 'Sukoharjo'))
        # Gempa M 5,4 di selatan Yogyakarta menyebutnya bersama Bantul dan Klaten: kabupatennya.
        jauh = self.g.cari('Sukoharjo', None, -9.2, 110.5, 5.4)
        self.assertEqual(jauh.tempat.nama, 'Kabupaten Sukoharjo')

    def test_tingkat_lebih_tinggi_menang_atas_kampung_bernama_sama(self):
        h = self.g.cari('Curup', None, -3.9, 102.6, 5.2, 120)
        self.assertEqual((h.tempat.presisi, h.tempat.id, h.kepastian), ('ibu kota', '14', 'peringkat'))

    def test_kandidat_yang_jauh_lebih_jauh_disisihkan(self):
        # Gempa M 7,2 dekat Pulau Romang; desa bernama sama 800 km jauhnya tidak dipilih.
        h = self.g.cari('Romang', None, -7.9, 127.5, 7.2, 125)
        self.assertEqual((h.tempat.nama, h.tempat.presisi), ('Pulau Romang', 'pulau'))

    def test_dua_kecamatan_bernama_sama_dipilih_dari_lokasi_tetangga(self):
        hasil = self.g.cari_semua([('Ngamprah', None), ('Cisarua', None)], -7.05, 106.93, 4.0, 102)
        self.assertEqual(hasil[0].kepastian, 'tunggal')
        self.assertEqual((hasil[1].kepastian, hasil[1].tempat.id, hasil[1].perlu_tinjau), ('tetangga', '26', False))

    def test_tanpa_tetangga_dipilih_yang_terdekat_dan_ditandai(self):
        h = self.g.cari('Cisarua', None, -7.05, 106.93, 4.0, 102)
        self.assertEqual((h.kepastian, h.tempat.id, h.perlu_tinjau), ('terdekat', '25', True))

    def test_titik_permukiman_mewakili_kecamatan(self):
        h = self.g.cari('Sumur', None, -6.9, 105.5, 4.7)
        self.assertEqual((h.tempat.id, h.tempat.presisi, h.kepastian), ('34', 'kecamatan', 'tunggal'))

    def test_keterangan_wilayah_membatasi_kandidat(self):
        h = self.g.cari('Ulu Belu', 'Tanggamus', 2.0, 99.5, 6.5)
        self.assertEqual((h.tempat.id, h.kepastian), ('28', 'keterangan'))

    def test_kata_belakang_menyebut_wilayah(self):
        ibu_kota = self.g.cari('Benteng Selayar', None, -7.1, 120.7, 5.1)
        self.assertEqual((ibu_kota.tempat.id, ibu_kota.kepastian), ('12', 'keterangan'))
        pulau = self.g.cari('Jampea Kep. Selayar', None, -7.1, 120.7, 5.1)
        self.assertEqual((pulau.tempat.nama, pulau.kepastian, pulau.perlu_tinjau), ('Bentengjampea', 'mirip', True))

    def test_salah_eja_satu_huruf(self):
        kab = self.g.cari('Kab. Melu', None, -7.9, 127.5, 7.2, 125)
        self.assertEqual((kab.tempat.nama, kab.kepastian), ('Kabupaten Belu', 'mirip'))
        kec = self.g.cari('Ranometo', None, -4.1, 122.5, 2.4)
        self.assertEqual((kec.tempat.nama, kec.kepastian), ('Kecamatan Ranomeeto', 'mirip'))

    def test_awalan_kabupaten_tidak_jatuh_ke_kampung(self):
        self.assertIsNone(self.g.cari('Kab. Curup', None, -3.9, 102.6, 5.2).tempat)

    def test_bagian_wilayah_menurut_arah(self):
        h = self.g.cari('Karawang Selatan', None, -7.05, 106.93, 4.0, 102)
        self.assertEqual(h.tempat.nama, 'Kabupaten Karawang')
        self.assertIn('bagian selatan', h.catatan)
        self.assertTrue(h.perlu_tinjau)

    def test_di_luar_jangkauan_tetap_dipilih_tetapi_ditandai(self):
        h = self.g.cari('Kab. Belu', None, -0.5, 100.0, 4.3)
        self.assertEqual(h.tempat.nama, 'Kabupaten Belu')
        self.assertIn('di luar jangkauan wajar', h.catatan)
        self.assertFalse(h.jangkar)

    def test_nama_tak_dikenal(self):
        h = self.g.cari('Antah Berantah', None, -7.0, 107.0, 5.0)
        self.assertEqual((h.tempat, h.kepastian, h.perlu_tinjau), (None, 'tidak ketemu', True))

    def test_koreksi_tangan_didahulukan(self):
        with tempfile.TemporaryDirectory() as tmp:
            berkas = Path(tmp) / 'lokasi_manual.csv'
            berkas.write_text('nama,keterangan,tempat,lat,lon,presisi,catatan\n'
                              'Cisarua,,Cisarua (Bandung Barat),-6.81,107.54,kecamatan,dicek di peta\n', encoding='utf-8')
            g = Gazetir(WILAYAH, GEONAMES, geokode.baca_manual(berkas))
        h = g.cari('Cisarua', None, -7.05, 106.93, 4.0, 102)
        self.assertEqual((h.kepastian, h.tempat.nama, h.tempat.lat, h.tempat.presisi, h.perlu_tinjau),
                         ('manual', 'Cisarua (Bandung Barat)', -6.81, 'kecamatan', False))


if __name__ == '__main__':
    unittest.main()
