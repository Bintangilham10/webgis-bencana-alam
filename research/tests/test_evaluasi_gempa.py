"""Uji skrip 12 (RQ-G) dari ujung ke ujung dengan data buatan: kalibrasi, perbandingan
aturan, sensitivitas, laporan USGS, syarat waktu, dan tulisan hasilnya.

Jalankan dari root repo: research/.venv/Scripts/python -m unittest discover -s research/tests
"""

import importlib.util
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

RESEARCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RESEARCH))

from sigap_riset import zona  # noqa: E402
from sigap_riset.geo import haversine_km  # noqa: E402
from sigap_riset.intensitas import IpeLinear  # noqa: E402

# Nama skrip diawali angka, jadi dimuat lewat importlib.
_spec = importlib.util.spec_from_file_location('evaluasi_gempa', RESEARCH / '12_evaluasi_gempa.py')
evaluasi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(evaluasi)

ASLI = IpeLinear(1.2, 1.1, -2.4)
N_BOOTSTRAP = 200
# Kisi titik "kab/kota" buatan, tiap 0,5° di sekitar khatulistiwa.
TITIK = np.array([[lat, lon] for lat in np.arange(-3, 3.01, 0.5) for lon in np.arange(100, 110.01, 0.5)])


def buatan(n_gempa: int = 40, mulai: datetime = datetime(2026, 11, 1, tzinfo=timezone.utc), seed: int = 3) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Gempa dan laporan buatan: lokasi di sekitar tiap episenter melapor bila intensitas
    dari hubungan ASLI (ditambah derau kecil) sedikitnya II."""
    acak = np.random.default_rng(seed)
    gempa, laporan = [], []
    for i in range(n_gempa):
        lat, lon = acak.uniform(-2, 2), acak.uniform(102, 108)
        magnitudo, kedalaman = round(acak.uniform(3, 6.5), 1), float(acak.choice([10, 20, 40, 90]))
        gid = f'g{i:02d}'
        baris = []
        for _ in range(8):
            arah, jarak = acak.uniform(0, 2 * np.pi), acak.uniform(5, 400)
            plat, plon = lat + jarak / 111.2 * np.cos(arah), lon + jarak / 111.2 * np.sin(arah)
            d = float(haversine_km(lat, lon, plat, plon))
            mmi = float(ASLI(magnitudo, np.hypot(d, kedalaman))) + acak.normal(0, 0.3)
            if mmi < 2:
                continue
            bawah = int(np.floor(mmi))
            kabupaten = acak.random() < 0.5
            baris.append({'gempa_id': gid, 'mmi_min': bawah, 'mmi_maks': bawah + int(acak.random() < 0.5), 'lat': plat, 'lon': plon,
                          'lat_wakil': plat + 0.05 if kabupaten else np.nan, 'lon_wakil': plon if kabupaten else np.nan,
                          'presisi': 'kabupaten' if kabupaten else 'kecamatan', 'perlu_tinjau': bool(acak.random() < 0.05),
                          'jarak_episenter_km': round(d, 1), 'jarak_hiposenter_km': round(float(np.hypot(d, kedalaman)), 1)})
        if not baris:
            continue
        waktu = mulai + timedelta(hours=7 * i)
        gempa.append({'id': gid, 'waktu_utc': f'{waktu:%Y-%m-%dT%H:%M:%SZ}', 'waktu': pd.Timestamp(waktu), 'lat': lat, 'lon': lon, 'kedalaman_km': kedalaman,
                      'magnitudo': magnitudo, 'mmi_maks': max(b['mmi_maks'] for b in baris), 'versi': 1 + int(acak.random() < 0.2)})
        laporan += baris
    tabel_laporan = pd.DataFrame(laporan)
    tabel_laporan['mmi'] = (tabel_laporan['mmi_min'] + tabel_laporan['mmi_maks']) / 2
    return pd.DataFrame(gempa).set_index('id'), tabel_laporan


class TestEvaluasiGempa(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gempa, cls.laporan = buatan()
        cls.model = evaluasi.kalibrasi(cls.gempa, cls.laporan, TITIK)
        cls.hasil, cls.tabel = evaluasi.bandingkan(cls.gempa, cls.laporan, TITIK, cls.model, n=N_BOOTSTRAP)

    def test_kalibrasi_menghasilkan_hubungan_fisis_dan_ambang_di_kisi(self):
        ipe = self.model['ipe_id']
        self.assertTrue(ipe['fisis'])
        self.assertIn(ipe['bentuk'], ('dasar', 'anelastik'))
        # Laporan buatan hanya dari tempat yang merasakan, jadi koefisiennya tidak persis
        # sama dengan ASLI; arahnya harus benar.
        self.assertGreater(ipe['koefisien']['c1'], 0)
        self.assertLess(ipe['koefisien']['c2'], 0)
        for nama in ('allen2012', 'ipe_id'):
            self.assertIn(round(self.model['ambang'][nama], 1), evaluasi.KISI_AMBANG.tolist())
        tetap = zona.tabel_per_gempa(self.gempa, self.laporan, pd.Series(150.0, index=self.gempa.index), TITIK)
        self.assertAlmostEqual(self.model['target_cakupan'], zona.cakupan(tetap))
        self.assertAlmostEqual(self.model['mmi_rata_pengembangan'], self.laporan['mmi'].mean())

    def test_ambang_setara_memberi_cakupan_sedikitnya_setara_pada_data_yang_sama(self):
        aturan = self.hasil['aturan']
        for nama in ('allen2012', 'ipe_id'):
            if self.model['ambang_tercapai'][nama]:
                self.assertGreaterEqual(aturan[nama]['cakupan'], aturan['tetap150']['cakupan'] - 1e-12)

    def test_perbandingan_gabungan_dan_g2(self):
        self.assertEqual(set(self.tabel), {'tetap150', 'rujukan', 'allen2012', 'ipe_id'})
        gabungan = self.hasil['g1_gabungan']
        self.assertEqual(gabungan['tingkat'], 0.95)
        self.assertEqual(gabungan['keduanya'], gabungan['tidak_lebih_buruk'] and gabungan['lebih_hemat'])
        self.assertAlmostEqual(gabungan['selisih_cakupan'], self.hasil['aturan']['ipe_id']['cakupan'] - self.hasil['aturan']['tetap150']['cakupan'])
        self.assertAlmostEqual(gabungan['nisbah_kabkota'], self.tabel['ipe_id']['n_kabkota'].sum() / self.tabel['tetap150']['n_kabkota'].sum())
        self.assertAlmostEqual(gabungan['nisbah_luas'], self.tabel['ipe_id']['luas_km2'].sum() / self.tabel['tetap150']['luas_km2'].sum())
        self.assertIn('g2_rujukan_vs_tetap150', self.hasil)
        self.assertIn('g2_rujukan_vs_ipe_id', self.hasil)
        # Sasaran aturan rujukan adalah intensitas tertinggi tiap gempa, jadi zonanya lebih sempit.
        self.assertLess(self.hasil['aturan']['rujukan']['cakupan'], self.hasil['aturan']['tetap150']['cakupan'])

    def test_pertanyaan_utama_dipisah_di_m5_dengan_selang_97_5(self):
        kuat = self.gempa.index[self.gempa['magnitudo'] >= 5]
        kecil = self.gempa.index[self.gempa['magnitudo'] < 5]
        self.assertTrue(len(kuat) and len(kecil))
        g1a, g1b = self.hasil['g1a'], self.hasil['g1b']
        self.assertEqual((g1a['tingkat'], g1b['tingkat']), (0.975, 0.975))
        self.assertEqual((g1a['n_gempa'], g1b['n_gempa']), (len(kuat), len(kecil)))
        self.assertEqual(g1a['n_laporan'] + g1b['n_laporan'], len(self.laporan))
        ipe, tetap = self.tabel['ipe_id'], self.tabel['tetap150']
        self.assertAlmostEqual(g1a['selisih_cakupan'], zona.cakupan(ipe.loc[kuat]) - zona.cakupan(tetap.loc[kuat]))
        self.assertAlmostEqual(g1b['nisbah_kabkota'], ipe.loc[kecil, 'n_kabkota'].sum() / tetap.loc[kecil, 'n_kabkota'].sum())
        # G1a: batas bawah selang selisih cakupan > 0. G1b: batas atas selang nisbah biaya < 1.
        self.assertEqual(g1a['terdukung'], g1a['selisih_cakupan_ci'][0] > 0)
        self.assertEqual(g1b['terdukung'], g1b['nisbah_kabkota_ci'][1] < 1)
        # Hubungan buatan: zona IPE-ID tumbuh dengan magnitudo, jadi lebih sempit dari 150 km untuk gempa kecil.
        self.assertLess(g1b['nisbah_kabkota'], 1)
        self.assertGreater(g1a['kabkota_a'], g1b['kabkota_a'])

    def test_kelas_tanpa_gempa_tidak_dibandingkan(self):
        kecil = self.gempa[self.gempa['magnitudo'] < 5]
        hasil, _ = evaluasi.bandingkan(kecil, self.laporan[self.laporan['gempa_id'].isin(kecil.index)], TITIK, self.model, n=N_BOOTSTRAP)
        self.assertIsNone(hasil['g1a'])
        self.assertIsNotNone(hasil['g1b'])
        teks = evaluasi.tulis_uji(hasil, {}, {}, {}, {}, self.model, {'sha256_kejadian': 'a' * 64, 'sha256_laporan': 'b' * 64}, kecil, evaluasi.AKHIR_UJI)
        self.assertIn('Tidak ada gempa atau laporan di kelas ini.', teks)
        self.assertNotIn('**G1a ', teks)

    def test_ipe_id_yang_tidak_fisis_tidak_ikut_dan_g1_tidak_diuji(self):
        model = {**self.model, 'ipe_id': {**self.model['ipe_id'], 'fisis': False}}
        hasil, tabel = evaluasi.bandingkan(self.gempa, self.laporan, TITIK, model, n=N_BOOTSTRAP)
        self.assertNotIn('ipe_id', tabel)
        for kunci in ('g1a', 'g1b', 'g1_gabungan'):
            self.assertNotIn(kunci, hasil)
        teks = evaluasi.tulis_uji(hasil, {}, {}, {}, {}, model, {'sha256_kejadian': 'a' * 64, 'sha256_laporan': 'b' * 64}, self.gempa, evaluasi.AKHIR_UJI)
        self.assertIn('jadi ketiganya tidak diuji', teks)

    def test_varian_sensitivitas(self):
        varian = evaluasi.varian_sensitivitas(self.gempa, self.laporan)
        self.assertEqual(len(varian), 5)
        _, tanpa_tinjau, _ = varian['2. Tanpa laporan bertanda perlu_tinjau']
        self.assertFalse(tanpa_tinjau['perlu_tinjau'].any())
        _, rinci, _ = varian['3. Hanya laporan yang lebih rinci daripada kabupaten']
        self.assertNotIn('kabupaten', set(rinci['presisi']))
        _, wakil, _ = varian['4. Laporan kabupaten memakai titik wakil poligon']
        berubah = wakil['jarak_episenter_km'].to_numpy() != self.laporan['jarak_episenter_km'].to_numpy()
        self.assertTrue(berubah[self.laporan['lat_wakil'].notna().to_numpy()].any())
        self.assertFalse(berubah[self.laporan['lat_wakil'].isna().to_numpy()].any())
        satu, laporan_satu, _ = varian['5. Hanya gempa yang parameternya tidak direvisi']
        self.assertTrue((satu['versi'] == 1).all())
        self.assertTrue(laporan_satu['gempa_id'].isin(satu.index).all())
        self.assertEqual(varian['1. Toleransi lokasi 25 km'][2], 25.0)

    def test_per_kelas_mencakup_semua_gempa(self):
        for kolom, kelas in (('magnitudo', evaluasi.KELAS_MAGNITUDO), ('kedalaman_km', evaluasi.KELAS_KEDALAMAN)):
            baris = [b for b in evaluasi.per_kelas(self.gempa, self.tabel, kolom, kelas) if b['aturan'] == 'tetap150']
            self.assertEqual(sum(b['n_gempa'] for b in baris), len(self.gempa))
            self.assertEqual(sum(b['n_laporan'] for b in baris), len(self.laporan))

    def test_galat_intensitas_tiap_hubungan(self):
        galat = evaluasi.galat_intensitas(self.gempa, self.laporan, self.model, n=N_BOOTSTRAP)
        self.assertEqual(set(galat), {'rujukan', 'allen2012', 'ipe_id', 'konstan'})
        # IPE-ID dikalibrasi pada data ini, jadi tidak boleh lebih buruk dari hubungan lain.
        self.assertLessEqual(galat['ipe_id']['mae'], min(galat['rujukan']['mae'], galat['allen2012']['mae']))
        # Tebakan konstan adalah rata-rata data ini, jadi biasnya nol.
        self.assertAlmostEqual(galat['konstan']['bias'], 0, places=9)
        self.assertLessEqual(galat['ipe_id']['mae'], galat['konstan']['mae'])
        atas = evaluasi.galat_intensitas(self.gempa, self.laporan, self.model, teramati='mmi_maks', n=N_BOOTSTRAP)
        self.assertLess(atas['ipe_id']['bias'], galat['ipe_id']['bias'])

    def test_potong_menurut_waktu_gempa(self):
        batas = datetime(2026, 11, 5, tzinfo=timezone.utc)
        awal, laporan_awal = evaluasi.potong(self.gempa, self.laporan, sampai=batas)
        akhir, laporan_akhir = evaluasi.potong(self.gempa, self.laporan, dari=batas)
        self.assertEqual(len(awal) + len(akhir), len(self.gempa))
        self.assertTrue((awal['waktu'] < batas).all() and (akhir['waktu'] >= batas).all())
        self.assertEqual(len(laporan_awal) + len(laporan_akhir), len(self.laporan))

    def test_tulisan_kalibrasi_dan_uji(self):
        meta = {'arsip_commit': 'abcdef1234567890', 'arsip_waktu': '2026-12-01T00:15:00Z', 'sampai': '2026-12-01', 'sha256_kejadian': 'a' * 64, 'sha256_laporan': 'b' * 64}
        galat = evaluasi.galat_intensitas(self.gempa, self.laporan, self.model, n=N_BOOTSTRAP)
        teks = evaluasi.tulis_kalibrasi(self.model, self.hasil, galat, meta, self.gempa, sementara=True)
        self.assertIn('**SEMENTARA.**', teks)
        self.assertIn('bukan** uji konfirmatori', teks)
        self.assertIn('bukan jawaban G1', teks)
        self.assertNotIn('G1 terdukung', teks)
        self.assertNotIn('**SEMENTARA.**', evaluasi.tulis_kalibrasi(self.model, self.hasil, galat, meta, self.gempa, sementara=False))
        sensitivitas = {nama: evaluasi.bandingkan(g, lap, TITIK, self.model, toleransi_km=t, n=N_BOOTSTRAP)[0]
                        for nama, (g, lap, t) in evaluasi.varian_sensitivitas(self.gempa, self.laporan).items()}
        kelas = {'kelas magnitudo': evaluasi.per_kelas(self.gempa, self.tabel, 'magnitudo', evaluasi.KELAS_MAGNITUDO)}
        teks = evaluasi.tulis_uji(self.hasil, galat, galat, sensitivitas, kelas, self.model, meta, self.gempa, evaluasi.AKHIR_UJI + evaluasi.PERPANJANGAN)
        for potongan in ('## G1a (utama): gempa M ≥ 5, cakupan', '**G1a ', '## G1b (utama): gempa M < 5, biaya', '**G1b ', 'CI 97,5%',
                         '## G1 gabungan (rumusan versi 1.0, sekunder)', '## G2: aturan rujukan', '## G3', 'Tebakan konstan',
                         '1. Toleransi lokasi 25 km', 'diperpanjang karena gempa uji terlalu sedikit', 'abcdef123456', 'PROTOKOL_GEMPA.md v1.1'):
            self.assertIn(potongan, teks)
        # Tidak ada angka kosong yang bocor ke tulisan ("himpunan" memuat "nan", jadi dicari sebagai kata).
        self.assertNotRegex(teks, r'\bnan\b')
        self.assertNotIn('-0,00', teks)
        # Model bisa disimpan sebagai JSON dan dibaca lagi.
        self.assertEqual(evaluasi.json.loads(evaluasi.json_rapi(self.model))['ambang'], self.model['ambang'])


class TestDyfi(unittest.TestCase):
    def test_galat_dan_zona_pada_laporan_usgs_buatan(self):
        gempa, laporan = buatan(n_gempa=25, seed=11)
        model = evaluasi.kalibrasi(gempa, laporan, TITIK)
        acak = np.random.default_rng(5)
        kejadian = pd.DataFrame({'id': [f'u{i}' for i in range(12)], 'lat': acak.uniform(-2, 2, 12), 'lon': acak.uniform(102, 108, 12),
                                 'kedalaman_km': acak.choice([10.0, 30.0, 80.0], 12), 'magnitudo': np.round(acak.uniform(5, 7.5, 12), 1)}).set_index('id')
        baris = []
        for gid, g in kejadian.iterrows():
            for jarak in acak.uniform(5, 1500, 30):
                hipo = float(np.hypot(jarak, g['kedalaman_km']))
                cdi = max(1.0, round(float(ASLI(g['magnitudo'], hipo)) + acak.normal(0, 0.4), 1))
                baris.append({'gempa_id': gid, 'cdi': cdi, 'n_respons': int(acak.integers(1, 8)), 'meragukan': False,
                              'jarak_episenter_km': round(float(jarak), 1), 'jarak_hiposenter_km': round(hipo, 1)})
        hasil = evaluasi.nilai_dyfi(kejadian, pd.DataFrame(baris), model, TITIK, n=N_BOOTSTRAP)
        self.assertLess(hasil['n_kotak'], len(baris))  # kotak > 1.000 km dan < 3 respons tidak dipakai untuk galat
        self.assertIn('IPE-ID', hasil['galat'])
        self.assertIn('Tebakan konstan (rata-rata data pengembangan)', hasil['galat'])
        self.assertIn('IPE-ID, magnitudo USGS + 0,3', hasil['galat'])
        self.assertGreater(hasil['galat']['IPE-ID, magnitudo USGS + 0,5']['bias'], hasil['galat']['IPE-ID']['bias'])
        # Aturan rujukan memerlukan intensitas laporan BMKG, jadi tidak ada di analisis zona.
        self.assertEqual(set(hasil['zona']), {'Tetap-150', 'IPE pustaka (Allen dkk., 2012)', 'IPE-ID', 'IPE-ID, magnitudo USGS + 0,3', 'IPE-ID, magnitudo USGS + 0,5'})
        for z in hasil['zona'].values():
            self.assertTrue(0 <= z['merasakan_dalam_zona'] <= 1)
            self.assertGreaterEqual(z['merasakan_dalam_zona'], z['tidak_merasakan_dalam_zona'])
        teks = evaluasi.tulis_dyfi(hasil, model)
        self.assertIn('Aturan rujukan tidak dihitung di sini', teks)
        self.assertIn('## Per pita jarak episenter', teks)


class TestSyaratWaktu(unittest.TestCase):
    def gempa(self, jumlah: int, akhir: datetime, tiap_kuat: int = 5) -> pd.DataFrame:
        """`jumlah` gempa tersebar merata dari awal periode uji sampai sebelum `akhir`;
        satu dari tiap `tiap_kuat` gempa bermagnitudo 5,5, sisanya 4."""
        lama = (akhir - evaluasi.AWAL_UJI) / jumlah
        return pd.DataFrame({'waktu': [pd.Timestamp(evaluasi.AWAL_UJI + i * lama) for i in range(jumlah)],
                             'magnitudo': [5.5 if i % tiap_kuat == 0 else 4.0 for i in range(jumlah)]})

    def test_periode_uji_bawaan_bila_gempa_cukup(self):
        self.assertEqual(evaluasi.akhir_periode_uji(self.gempa(80, evaluasi.AKHIR_UJI), evaluasi.AKHIR_UJI), evaluasi.AKHIR_UJI)

    def test_himpunan_yang_belum_mencakup_periode_uji_ditolak(self):
        with self.assertRaises(SystemExit) as galat:
            evaluasi.akhir_periode_uji(self.gempa(80, evaluasi.AKHIR_UJI), datetime(2026, 12, 20, tzinfo=timezone.utc))
        self.assertIn('--sampai 2027-01-01', str(galat.exception))

    def test_diperpanjang_tujuh_hari_bila_gempa_kurang_dari_60(self):
        # 62 gempa merata dalam 38 hari: sampai 1 Jan baru 51, sampai 8 Jan sudah 62.
        gempa = self.gempa(62, evaluasi.AKHIR_UJI + timedelta(days=7))
        with self.assertRaises(SystemExit) as galat:
            evaluasi.akhir_periode_uji(gempa, evaluasi.AKHIR_UJI)
        self.assertIn('--sampai 2027-01-08', str(galat.exception))
        self.assertEqual(evaluasi.akhir_periode_uji(gempa, evaluasi.AKHIR_UJI + timedelta(days=7)), evaluasi.AKHIR_UJI + timedelta(days=7))

    def test_diperpanjang_bila_gempa_m5_ke_atas_kurang_dari_8(self):
        # 70 gempa dalam sebulan tetapi hanya 4 yang M ≥ 5 (satu dari tiap 20).
        sedikit_kuat = self.gempa(70, evaluasi.AKHIR_UJI, tiap_kuat=20)
        self.assertEqual(int((sedikit_kuat['magnitudo'] >= 5).sum()), 4)
        with self.assertRaises(SystemExit) as galat:
            evaluasi.akhir_periode_uji(sedikit_kuat, evaluasi.AKHIR_UJI)
        self.assertIn('--sampai 2027-01-08', str(galat.exception))
        # Tepat 8 gempa M ≥ 5 sudah cukup.
        cukup = self.gempa(64, evaluasi.AKHIR_UJI, tiap_kuat=8)
        self.assertEqual(int((cukup['magnitudo'] >= 5).sum()), 8)
        self.assertEqual(evaluasi.akhir_periode_uji(cukup, evaluasi.AKHIR_UJI), evaluasi.AKHIR_UJI)

    def test_uji_ditolak_sebelum_arsip_dibekukan(self):
        beku = evaluasi.AKHIR_UJI + evaluasi.JEDA_BEKU
        with self.assertRaises(SystemExit):
            evaluasi.syarat_uji(evaluasi.AKHIR_UJI, beku, beku - timedelta(minutes=1))
        with self.assertRaises(SystemExit):
            evaluasi.syarat_uji(evaluasi.AKHIR_UJI, beku - timedelta(minutes=1), beku + timedelta(days=1))
        with self.assertRaises(SystemExit):
            evaluasi.syarat_uji(evaluasi.AKHIR_UJI, None, beku + timedelta(days=1))
        evaluasi.syarat_uji(evaluasi.AKHIR_UJI, beku, beku)

    def test_kalibrasi_beku_ditolak_sebelum_periode_uji_dimulai(self):
        with self.assertRaises(SystemExit):
            evaluasi.syarat_kalibrasi(evaluasi.AWAL_UJI, evaluasi.AWAL_UJI - timedelta(seconds=1))
        with self.assertRaises(SystemExit):
            evaluasi.syarat_kalibrasi(evaluasi.AWAL_UJI - timedelta(seconds=1), evaluasi.AWAL_UJI + timedelta(days=1))
        evaluasi.syarat_kalibrasi(evaluasi.AWAL_UJI, evaluasi.AWAL_UJI)


if __name__ == '__main__':
    unittest.main()
