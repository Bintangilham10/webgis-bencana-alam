"""Uji pengurai laporan gempa dirasakan BMKG dan pemilihan revisi.

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover research/tests
"""

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

RESEARCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RESEARCH))

from sigap_riset import dirasakan  # noqa: E402
from sigap_riset.dirasakan import Laporan, parse_dirasakan  # noqa: E402


def catatan(waktu: str, dirasakan_teks: str, feed: str = 'gempadirasakan', terlihat: str = '2026-10-04T10:30:00Z',
            magnitudo: str = '4.7', koordinat: str = '-8.25,120.42', kedalaman: str = '10 km') -> dict:
    return {'feed': feed, 'first_seen_at': terlihat,
            'data': {'DateTime': waktu, 'Coordinates': koordinat, 'Magnitude': magnitudo, 'Kedalaman': kedalaman,
                     'Wilayah': 'Pusat gempa berada di darat 40 km utara Ruteng', 'Dirasakan': dirasakan_teks}}


class ParseDirasakan(unittest.TestCase):
    def test_rentang_dan_satu_nilai(self):
        self.assertEqual(parse_dirasakan('II - III Kab. Manggarai'), [Laporan('Kab. Manggarai', 2, 3)])
        self.assertEqual(parse_dirasakan('III-IV Aceh Besar, III Banda Aceh, II Sigli'),
                         [Laporan('Aceh Besar', 3, 4), Laporan('Banda Aceh', 3, 3), Laporan('Sigli', 2, 2)])

    def test_spasi_berlebih_dan_tanda_pisah_panjang(self):
        self.assertEqual(parse_dirasakan('IV Kab. Sumba Timur , III–IV  Kab. Manggarai'),
                         [Laporan('Kab. Sumba Timur', 4, 4), Laporan('Kab. Manggarai', 3, 4)])

    def test_bagian_tanpa_angka_adalah_keterangan_lokasi_sebelumnya(self):
        self.assertEqual(parse_dirasakan('III Ulu Belu, Tanggamus, III Pulau Panggung, Tanggamus'),
                         [Laporan('Ulu Belu', 3, 3, 'Tanggamus'), Laporan('Pulau Panggung', 3, 3, 'Tanggamus')])

    def test_tanpa_daftar(self):
        self.assertEqual(parse_dirasakan('-'), [])
        self.assertEqual(parse_dirasakan(''), [])
        self.assertEqual(parse_dirasakan(None), [])

    def test_nama_yang_diawali_angka_romawi(self):
        # Kecamatan "IV Koto" dilaporkan dengan intensitas III.
        self.assertEqual(parse_dirasakan('III IV Koto'), [Laporan('IV Koto', 3, 3)])

    def test_rentang_terbalik_diurutkan(self):
        self.assertEqual(parse_dirasakan('III-II Kendari'), [Laporan('Kendari', 2, 3)])


class Revisi(unittest.TestCase):
    def gempa(self, *args, **kwargs):
        return dirasakan._dari_catatan(catatan(*args, **kwargs))

    def test_revisi_bergeser_sedetik_digabung(self):
        # 13 Okt 2026: magnitudo direvisi 4,6 → 4,1 dan waktunya bergeser satu detik.
        a = self.gempa('2026-10-13T06:42:28+00:00', 'III Kab. Sumba Barat Daya', magnitudo='4.6', terlihat='2026-10-13T07:00:00Z')
        b = self.gempa('2026-10-13T06:42:29+00:00', 'III Kab. Sumba Barat Daya', magnitudo='4.1', terlihat='2026-10-13T07:30:00Z')
        hasil = dirasakan.gabung_revisi([a, b])
        self.assertEqual(len(hasil), 1)
        self.assertEqual(hasil[0].magnitudo, 4.1)
        self.assertEqual(hasil[0].versi, 2)
        self.assertEqual(hasil[0].pertama_terlihat, datetime(2026, 10, 13, 7, 0, tzinfo=timezone.utc))

    def test_gempa_beruntun_tidak_digabung(self):
        # Rentetan Manggarai 18 Nov 2026: dua gempa berselang 37 detik, 6 km.
        a = self.gempa('2026-11-18T04:55:54+00:00', 'III Kab. Manggarai', magnitudo='4.4', koordinat='-8.30,120.40')
        b = self.gempa('2026-11-18T04:56:31+00:00', 'II Kab. Manggarai', magnitudo='4.0', koordinat='-8.25,120.43')
        self.assertEqual(len(dirasakan.gabung_revisi([a, b])), 2)

    def test_versi_berdaftar_lokasi_didahulukan(self):
        a = self.gempa('2026-10-04T10:13:09+00:00', 'II - III Kab. Manggarai', terlihat='2026-10-04T10:30:00Z')
        b = self.gempa('2026-10-04T10:13:09+00:00', '-', terlihat='2026-10-04T11:00:00Z')
        hasil = dirasakan.gabung_revisi([a, b])
        self.assertEqual(len(hasil), 1)
        self.assertEqual(hasil[0].laporan, [Laporan('Kab. Manggarai', 2, 3)])

    def test_catatan_rusak_dilewati(self):
        self.assertIsNone(dirasakan._dari_catatan({'feed': 'gempadirasakan', 'first_seen_at': '2026-10-04T10:30:00Z', 'data': {}}))


class Load(unittest.TestCase):
    def test_autogempa_tanpa_daftar_tidak_diambil_dan_batas_waktu(self):
        with tempfile.TemporaryDirectory() as tmp:
            arsip = Path(tmp)
            isi = {
                'gempadirasakan/2026/10/a.json': catatan('2026-10-04T10:13:09+00:00', 'II - III Kab. Manggarai'),
                'gempadirasakan/2026/11/b.json': catatan('2026-11-02T01:00:00+00:00', 'III Kendari'),
                'autogempa/2026/10/c.json': catatan('2026-10-11T03:30:20+00:00', '-', feed='autogempa', magnitudo='5.7'),
                'autogempa/2026/10/d.json': catatan('2026-10-12T05:00:00+00:00', 'III Luwuk', feed='autogempa', magnitudo='5.3'),
            }
            for nama, data in isi.items():
                berkas = arsip / 'bmkg-gempa' / nama
                berkas.parent.mkdir(parents=True, exist_ok=True)
                berkas.write_text(json.dumps(data), encoding='utf-8')
            semua = dirasakan.load(arsip)
            self.assertEqual([g.id for g in semua], ['bmkg:20261004T101309Z', 'bmkg:20261012T050000Z', 'bmkg:20261102T010000Z'])
            sebelum_november = dirasakan.load(arsip, datetime(2026, 11, 1, tzinfo=timezone.utc))
            self.assertEqual(len(sebelum_november), 2)


if __name__ == '__main__':
    unittest.main()
