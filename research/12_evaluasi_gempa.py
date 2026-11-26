"""Zona notifikasi gempa dan perkiraan intensitas di lokasi pengguna (RQ-G, PROTOKOL_GEMPA.md).

Tiga langkah, dijalankan berurutan:

  kalibrasi   Dari gempa dirasakan BMKG sebelum periode uji: mengalibrasi IPE-ID,
              menetapkan ambang, dan membekukannya di results/gempa_model.json
              (protokol bagian 5). Sebelum periode uji dimulai hanya bisa dijalankan
              dengan --sementara, yang menulis ke data/gempa/sementara/ (tidak dikomit)
              dan tidak membekukan apa pun.
  dyfi        Hubungan yang sudah dibekukan dinilai pada laporan USGS (bagian 7).
  uji         Uji konfirmatori pada gempa periode uji (bagian 6–8). Menolak berjalan
              sebelum arsip dibekukan, 48 jam setelah periode uji berakhir.

Masukan: data/gempa/bmkg_kejadian.csv, bmkg_laporan.csv, bmkg_meta.json (10_gempa_dirasakan.py),
data/gempa/usgs_kejadian.csv, usgs_dyfi.csv (11_usgs_dyfi.py), recorder/data/wilayah.json.
Keluaran: results/gempa_model.json, gempa_kalibrasi.md, gempa_dyfi.md, gempa_uji.md,
gempa_uji_per_gempa.csv.

Jalankan dari root repo:
  research/.venv/Scripts/python research/10_gempa_dirasakan.py --sampai 2026-12-01
  research/.venv/Scripts/python research/12_evaluasi_gempa.py kalibrasi
  research/.venv/Scripts/python research/12_evaluasi_gempa.py dyfi
  research/.venv/Scripts/python research/10_gempa_dirasakan.py --sampai 2027-01-01 --commit <hash arsip beku>
  research/.venv/Scripts/python research/12_evaluasi_gempa.py uji
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from sigap_riset import intensitas, zona
from sigap_riset.geo import haversine_km
from sigap_riset.intensitas import IpeLinear
from sigap_riset.paths import DATA, RESULTS, ROOT

GEMPA = DATA / 'gempa'
SEMENTARA = GEMPA / 'sementara'
WILAYAH_JSON = ROOT.parent / 'recorder' / 'data' / 'wilayah.json'
PROTOKOL = 'PROTOKOL_GEMPA.md v1.1'

# PROTOKOL_GEMPA.md bagian 2: data pengembangan sebelum AWAL_UJI, data uji sampai AKHIR_UJI.
AWAL_UJI = datetime(2026, 12, 1, tzinfo=timezone.utc)
AKHIR_UJI = datetime(2027, 1, 1, tzinfo=timezone.utc)
JEDA_BEKU = timedelta(hours=48)
MIN_GEMPA_UJI = 60
MIN_GEMPA_KUAT_UJI = 8
PERPANJANGAN = timedelta(days=7)
# Bagian 4 dan 5.
RADIUS_TETAP_KM = 150.0
KISI_AMBANG = np.round(np.arange(1.0, 6.0 + 1e-9, 0.1), 1)
# Bagian 6: dua pertanyaan utama, dipisah di M 5, masing-masing dengan selang 97,5%.
MAGNITUDO_KUAT = 5.0
TINGKAT_UTAMA = 0.975
# Bagian 7 (G1 gabungan, rumusan versi 1.0) dan 8.
BATAS_TIDAK_LEBIH_BURUK = 0.05
TOLERANSI_KM = 25.0
# Bagian 7.
DYFI_JARAK_MAKS_KM = 1000.0
DYFI_MIN_RESPONS = 3
DYFI_MERASAKAN_CDI = 2.0
GESER_MAGNITUDO_USGS = (0.3, 0.5)

NAMA = {'tetap150': 'Tetap-150', 'rujukan': 'Rujukan (Firdaus dkk., 2026)', 'allen2012': 'IPE pustaka (Allen dkk., 2012)', 'ipe_id': 'IPE-ID',
        'konstan': 'Tebakan konstan (rata-rata data pengembangan)'}
KELAS_MAGNITUDO = [(-np.inf, 4, '< 4'), (4, 5, '4–4,9'), (5, np.inf, '≥ 5')]
KELAS_KEDALAMAN = [(-np.inf, 60, '≤ 60 km'), (60, np.inf, '> 60 km')]


# ---------- Data ----------


def sidik(berkas: Path) -> str:
    return hashlib.sha256(berkas.read_bytes()).hexdigest()


def muat_bmkg(folder: Path = GEMPA) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Gempa (berindeks id) yang punya laporan berkoordinat, laporan itu, dan asal datanya."""
    gempa = pd.read_csv(folder / 'bmkg_kejadian.csv').set_index('id')
    gempa['waktu'] = pd.to_datetime(gempa['waktu_utc'], utc=True)
    laporan = pd.read_csv(folder / 'bmkg_laporan.csv')
    laporan = laporan[laporan['lat'].notna()].copy()
    laporan['mmi'] = intensitas.mmi_tengah(laporan['mmi_min'], laporan['mmi_maks'])
    gempa = gempa[gempa.index.isin(laporan['gempa_id'])]
    berkas_meta = folder / 'bmkg_meta.json'
    meta = json.loads(berkas_meta.read_text(encoding='utf-8')) if berkas_meta.exists() else {}
    meta['sha256_kejadian'] = sidik(folder / 'bmkg_kejadian.csv')
    meta['sha256_laporan'] = sidik(folder / 'bmkg_laporan.csv')
    return gempa, laporan, meta


def potong(gempa: pd.DataFrame, laporan: pd.DataFrame, dari: datetime | None = None, sampai: datetime | None = None):
    """Gempa dengan waktu kejadian dari `dari` sampai sebelum `sampai`, dan laporannya."""
    pilih = pd.Series(True, index=gempa.index)
    if dari is not None:
        pilih &= gempa['waktu'] >= dari
    if sampai is not None:
        pilih &= gempa['waktu'] < sampai
    terpilih = gempa[pilih]
    return terpilih, laporan[laporan['gempa_id'].isin(terpilih.index)]


def titik_kabkota(berkas: Path = WILAYAH_JSON) -> np.ndarray:
    wilayah = json.loads(berkas.read_text(encoding='utf-8'))
    return np.array([[w['lat'], w['lon']] for w in wilayah], dtype=float)


def waktu_iso(teks: str | None) -> datetime | None:
    return datetime.fromisoformat(teks.replace('Z', '+00:00')) if teks else None


# ---------- Kalibrasi (protokol bagian 5) ----------


def kalibrasi(gempa: pd.DataFrame, laporan: pd.DataFrame, titik: np.ndarray) -> dict:
    """IPE-ID dan ambang tiap aturan dari data pengembangan."""
    data = laporan[['gempa_id', 'jarak_hiposenter_km', 'mmi']].assign(magnitudo=laporan['gempa_id'].map(gempa['magnitudo']).to_numpy())
    ipe, catatan = intensitas.pilih_bentuk(data)
    tetap = zona.tabel_per_gempa(gempa, laporan, pd.Series(RADIUS_TETAP_KM, index=gempa.index), titik)
    target = zona.cakupan(tetap)
    model = {
        'ipe_id': {'bentuk': catatan['terpilih'], 'koefisien': ipe.sebagai_kamus(), 'fisis': bool(ipe.fisis),
                   'validasi_silang': {nama: catatan[nama] for nama in ('dasar', 'anelastik')}},
        # Tebakan konstan untuk G3: rata-rata intensitas teramati di data pengembangan.
        'mmi_rata_pengembangan': float(laporan['mmi'].mean()),
        'target_cakupan': target, 'ambang': {}, 'ambang_tercapai': {},
    }
    calon = {'allen2012': (intensitas.mmi_allen2012, intensitas.JARAK_ALLEN2012)}
    if ipe.fisis:
        calon['ipe_id'] = (ipe, 'hiposenter')
    for nama, (hubungan, jarak) in calon.items():
        ambang = zona.ambang_setara(gempa, laporan, hubungan, target, KISI_AMBANG, jarak=jarak)
        model['ambang'][nama] = float(KISI_AMBANG.min()) if ambang is None else ambang
        model['ambang_tercapai'][nama] = ambang is not None
    return model


# ---------- Aturan dan perbandingannya (bagian 4, 6, 7) ----------


def hubungan_intensitas(model: dict, dengan_konstan: bool = False) -> dict:
    """Hubungan yang memberi perkiraan intensitas. Tebakan konstan (G3) bukan hubungan
    intensitas–jarak, jadi hanya ikut bila diminta."""
    hubungan = {'rujukan': intensitas.mmi_rujukan, 'allen2012': intensitas.mmi_allen2012}
    if model['ipe_id']['fisis']:
        hubungan['ipe_id'] = IpeLinear(**model['ipe_id']['koefisien'])
    if dengan_konstan:
        rata = model['mmi_rata_pengembangan']
        hubungan['konstan'] = lambda magnitudo, jarak_km: np.full(np.shape(magnitudo), rata)
    return hubungan


def radius_aturan(gempa: pd.DataFrame, model: dict, dengan_rujukan: bool = True) -> dict[str, pd.Series]:
    """Radius tiap gempa menurut tiap aturan. Aturan rujukan memerlukan kolom mmi_maks
    (intensitas tertinggi yang dilaporkan BMKG), jadi dilewati bila kolom itu tidak ada."""
    hubungan = hubungan_intensitas(model)
    radius = {'tetap150': pd.Series(RADIUS_TETAP_KM, index=gempa.index)}
    if dengan_rujukan:
        radius['rujukan'] = zona.radius_gempa(gempa, hubungan['rujukan'], gempa['mmi_maks'].astype(float), jarak=intensitas.JARAK_RUJUKAN)
    radius['allen2012'] = zona.radius_gempa(gempa, hubungan['allen2012'], model['ambang']['allen2012'], jarak=intensitas.JARAK_ALLEN2012)
    if 'ipe_id' in hubungan:
        radius['ipe_id'] = zona.radius_gempa(gempa, hubungan['ipe_id'], model['ambang']['ipe_id'])
    return radius


def pelengkap(a: pd.DataFrame, b: pd.DataFrame, n: int, tingkat: float = 0.95) -> dict:
    """Sensitivitas 7 dan 8: cakupan dirata-rata per gempa, dan biaya sebagai luas."""
    ada = a['n_laporan'] > 0

    def makro(tabel: pd.DataFrame) -> float:
        return float((tabel.loc[ada, 'n_terjangkau'] / tabel.loc[ada, 'n_laporan']).mean())

    kolom = {'a': a['luas_km2'].to_numpy(), 'b': b['luas_km2'].to_numpy()}
    with np.errstate(divide='ignore', invalid='ignore'):
        ulang = zona.bootstrap_gempa(kolom, lambda k: k['a'].sum(axis=-1) / k['b'].sum(axis=-1), n=n)
    return {'cakupan_makro_a': makro(a), 'cakupan_makro_b': makro(b),
            'nisbah_luas': float(a['luas_km2'].sum() / b['luas_km2'].sum()), 'nisbah_luas_ci': zona.selang(ulang, tingkat)}


def bandingkan(gempa: pd.DataFrame, laporan: pd.DataFrame, titik: np.ndarray, model: dict, *,
               toleransi_km: float = 0.0, n: int = zona.BOOTSTRAP_N) -> tuple[dict, dict[str, pd.DataFrame]]:
    """Ringkasan tiap aturan, G1a dan G1b (IPE-ID vs Tetap-150 per kelas magnitudo),
    G1 gabungan (rumusan versi 1.0), dan G2 (aturan rujukan)."""
    tabel = {nama: zona.tabel_per_gempa(gempa, laporan, radius, titik, toleransi_km) for nama, radius in radius_aturan(gempa, model).items()}
    hasil = {'n_gempa': int(len(gempa)), 'n_laporan': int(laporan['gempa_id'].isin(gempa.index).sum()),
             'aturan': {nama: zona.ringkas_aturan(t, n=n) for nama, t in tabel.items()}}
    hasil['g2_rujukan_vs_tetap150'] = zona.banding_aturan(tabel['rujukan'], tabel['tetap150'], n=n)
    if 'ipe_id' in tabel:
        kuat = gempa['magnitudo'] >= MAGNITUDO_KUAT
        hasil['g1a'] = banding_kelas(tabel, gempa.index[kuat], n)
        hasil['g1b'] = banding_kelas(tabel, gempa.index[~kuat], n)
        if hasil['g1a']:
            hasil['g1a']['terdukung'] = bool(hasil['g1a']['selisih_cakupan_ci'][0] > 0)
        if hasil['g1b']:
            hasil['g1b']['terdukung'] = bool(hasil['g1b']['nisbah_kabkota_ci'][1] < 1)
        gabungan = zona.banding_aturan(tabel['ipe_id'], tabel['tetap150'], n=n)
        gabungan['tidak_lebih_buruk'] = bool(gabungan['selisih_cakupan_batas_bawah_satu_sisi'] > -BATAS_TIDAK_LEBIH_BURUK)
        gabungan['lebih_hemat'] = bool(gabungan['nisbah_kabkota_ci'][1] < 1)
        gabungan['keduanya'] = gabungan['tidak_lebih_buruk'] and gabungan['lebih_hemat']
        gabungan.update(pelengkap(tabel['ipe_id'], tabel['tetap150'], n))
        hasil['g1_gabungan'] = gabungan
        hasil['g2_rujukan_vs_ipe_id'] = zona.banding_aturan(tabel['rujukan'], tabel['ipe_id'], n=n)
    return hasil, tabel


def banding_kelas(tabel: dict[str, pd.DataFrame], ids: pd.Index, n: int) -> dict | None:
    """IPE-ID dibanding Tetap-150 pada satu kelas magnitudo, dengan selang 97,5%.
    None bila kelas itu tidak punya gempa atau tidak punya laporan."""
    a, b = tabel['ipe_id'].loc[ids], tabel['tetap150'].loc[ids]
    if len(ids) == 0 or b['n_laporan'].sum() == 0:
        return None
    hasil = zona.banding_aturan(a, b, n=n, tingkat=TINGKAT_UTAMA)
    hasil.update({'n_gempa': int(len(ids)), 'n_laporan': int(b['n_laporan'].sum()), 'cakupan_a': zona.cakupan(a), 'cakupan_b': zona.cakupan(b),
                  'kabkota_a': float(a['n_kabkota'].mean()), 'kabkota_b': float(b['n_kabkota'].mean()), **pelengkap(a, b, n, TINGKAT_UTAMA)})
    return hasil


def galat_intensitas(gempa: pd.DataFrame, laporan: pd.DataFrame, model: dict, *, teramati: str = 'mmi', n: int = zona.BOOTSTRAP_N) -> dict:
    """G3 pada laporan BMKG: galat tiap hubungan, dan tebakan konstan, di lokasi yang melapor."""
    magnitudo = laporan['gempa_id'].map(gempa['magnitudo']).to_numpy(dtype=float)
    jarak = laporan['jarak_hiposenter_km'].to_numpy(dtype=float)
    return {nama: intensitas.galat(f(magnitudo, jarak), laporan[teramati], laporan['gempa_id'], n=n) for nama, f in hubungan_intensitas(model, dengan_konstan=True).items()}


def varian_sensitivitas(gempa: pd.DataFrame, laporan: pd.DataFrame) -> dict[str, tuple[pd.DataFrame, pd.DataFrame, float]]:
    """Sensitivitas 1–5 (bagian 8): himpunan gempa, laporan, dan toleransi tiap varian."""
    wakil = laporan.copy()
    ada = wakil['lat_wakil'].notna()
    pusat = gempa.loc[wakil.loc[ada, 'gempa_id'], ['lat', 'lon']].to_numpy()
    wakil.loc[ada, 'jarak_episenter_km'] = haversine_km(pusat[:, 0], pusat[:, 1], wakil.loc[ada, 'lat_wakil'].to_numpy(), wakil.loc[ada, 'lon_wakil'].to_numpy())
    tanpa_revisi = gempa[gempa['versi'] == 1]
    return {
        '1. Toleransi lokasi 25 km': (gempa, laporan, TOLERANSI_KM),
        '2. Tanpa laporan bertanda perlu_tinjau': (gempa, laporan[~laporan['perlu_tinjau']], 0.0),
        '3. Hanya laporan yang lebih rinci daripada kabupaten': (gempa, laporan[laporan['presisi'] != 'kabupaten'], 0.0),
        '4. Laporan kabupaten memakai titik wakil poligon': (gempa, wakil, 0.0),
        '5. Hanya gempa yang parameternya tidak direvisi': (tanpa_revisi, laporan[laporan['gempa_id'].isin(tanpa_revisi.index)], 0.0),
    }


def per_kelas(gempa: pd.DataFrame, tabel: dict[str, pd.DataFrame], kolom: str, kelas: list) -> list[dict]:
    """Sensitivitas 6: cakupan dan biaya tiap aturan per kelas, tanpa uji."""
    baris = []
    for bawah, atas, label in kelas:
        ids = gempa.index[(gempa[kolom] >= bawah) & (gempa[kolom] < atas)] if kolom == 'magnitudo' else gempa.index[(gempa[kolom] > bawah) & (gempa[kolom] <= atas)]
        for nama, t in tabel.items():
            bagian = t.loc[ids]
            baris.append({'kelas': label, 'aturan': nama, 'n_gempa': int(len(bagian)), 'n_laporan': int(bagian['n_laporan'].sum()),
                          'cakupan': zona.cakupan(bagian), 'kabkota_per_gempa': float(bagian['n_kabkota'].mean()) if len(bagian) else float('nan')})
    return baris


# ---------- Laporan USGS (DYFI), bagian 7 ----------


def nilai_dyfi(kejadian: pd.DataFrame, dyfi: pd.DataFrame, model: dict, titik: np.ndarray, *, n: int = zona.BOOTSTRAP_N) -> dict:
    baris = dyfi[dyfi['jarak_episenter_km'] <= DYFI_JARAK_MAKS_KM].copy()
    baris['magnitudo'] = baris['gempa_id'].map(kejadian['magnitudo']).to_numpy(dtype=float)
    mantap = baris[(baris['n_respons'] >= DYFI_MIN_RESPONS) & ~baris['meragukan']]
    hubungan = hubungan_intensitas(model)
    calon = {NAMA[nama]: (f, 0.0) for nama, f in hubungan_intensitas(model, dengan_konstan=True).items()}
    if 'ipe_id' in hubungan:
        calon.update({f'IPE-ID, magnitudo USGS + {str(g).replace(".", ",")}': (hubungan['ipe_id'], g) for g in GESER_MAGNITUDO_USGS})

    def galat(bagian: pd.DataFrame, f, geser: float) -> dict | None:
        if bagian.empty:
            return None
        return intensitas.galat(f(bagian['magnitudo'].to_numpy() + geser, bagian['jarak_hiposenter_km'].to_numpy()), bagian['cdi'], bagian['gempa_id'], n=n)

    pita = [(0, 50), (50, 100), (100, 200), (200, 500), (500, DYFI_JARAK_MAKS_KM)]
    kelas_m = [(5, 6, '5–5,9'), (6, 7, '6–6,9'), (7, np.inf, '≥ 7')]
    hasil = {'n_gempa': int(mantap['gempa_id'].nunique()), 'n_kotak': int(len(mantap)), 'galat': {}, 'per_magnitudo': {}, 'per_jarak': {}, 'zona': {}}
    for nama, (f, geser) in calon.items():
        hasil['galat'][nama] = galat(mantap, f, geser)
        hasil['per_magnitudo'][nama] = {label: galat(mantap[(mantap['magnitudo'] >= a) & (mantap['magnitudo'] < b)], f, geser) for a, b, label in kelas_m}
        hasil['per_jarak'][nama] = {f'{a:g}–{b:g} km': galat(mantap[(mantap['jarak_episenter_km'] > a) & (mantap['jarak_episenter_km'] <= b)], f, geser) for a, b in pita}

    # Zona: kotak "merasakan" dan "tidak merasakan" yang berada di dalam radius tiap aturan.
    gempa = kejadian.loc[kejadian.index.isin(baris['gempa_id']), ['lat', 'lon', 'kedalaman_km', 'magnitudo']]
    merasakan = baris['cdi'] >= DYFI_MERASAKAN_CDI
    aturan = {NAMA[nama]: radius for nama, radius in radius_aturan(gempa, model, dengan_rujukan=False).items()}
    if 'ipe_id' in hubungan:
        for geser in GESER_MAGNITUDO_USGS:
            digeser = gempa.assign(magnitudo=gempa['magnitudo'] + geser)
            aturan[f'IPE-ID, magnitudo USGS + {str(geser).replace(".", ",")}'] = zona.radius_gempa(digeser, hubungan['ipe_id'], model['ambang']['ipe_id'])
    for nama, radius in aturan.items():
        batas = baris['gempa_id'].map(radius)
        dalam = (baris['jarak_episenter_km'] <= batas) & (batas > 0)
        per_gempa = pd.DataFrame({'g': baris['gempa_id'], 'ya': merasakan, 'ya_dalam': merasakan & dalam, 'tidak': ~merasakan, 'tidak_dalam': ~merasakan & dalam}).groupby('g').sum()
        kolom = {k: per_gempa[k].to_numpy(dtype=float) for k in per_gempa.columns}

        def bagian(k: dict[str, np.ndarray]) -> np.ndarray:
            with np.errstate(divide='ignore', invalid='ignore'):
                return np.stack([k['ya_dalam'].sum(axis=-1) / k['ya'].sum(axis=-1), k['tidak_dalam'].sum(axis=-1) / k['tidak'].sum(axis=-1)])

        titik_duga, ulang = bagian(kolom), zona.bootstrap_gempa(kolom, bagian, n=n)
        hasil['zona'][nama] = {
            'kotak_merasakan': int(kolom['ya'].sum()), 'kotak_tidak_merasakan': int(kolom['tidak'].sum()),
            'merasakan_dalam_zona': float(titik_duga[0]), 'merasakan_dalam_zona_ci': zona.selang(ulang[0]),
            'tidak_merasakan_dalam_zona': float(titik_duga[1]), 'tidak_merasakan_dalam_zona_ci': zona.selang(ulang[1]),
            'kabkota_per_gempa': float(zona.kabkota_dalam_radius(gempa, radius, titik).mean()),
        }
    return hasil


# ---------- Syarat waktu (bagian 2 dan 5) ----------


def akhir_periode_uji(gempa: pd.DataFrame, data_sampai: datetime | None) -> datetime:
    """Akhir periode uji; diperpanjang tujuh hari demi tujuh hari selama gempa uji kurang
    dari 60 atau gempa uji M ≥ 5 kurang dari 8. `gempa` punya kolom waktu dan magnitudo.
    Bila himpunan data belum mencakup perpanjangan yang diperlukan, berhenti dengan petunjuk."""
    akhir = AKHIR_UJI
    while True:
        if data_sampai is None or data_sampai < akhir:
            raise SystemExit(f'Himpunan data belum mencakup periode uji sampai {akhir:%Y-%m-%d}. Buat ulang dengan '
                             f'10_gempa_dirasakan.py --sampai {akhir:%Y-%m-%d} --commit <hash arsip sesudah {akhir + JEDA_BEKU:%Y-%m-%d %H:%M} UTC>.')
        uji = gempa[(gempa['waktu'] >= AWAL_UJI) & (gempa['waktu'] < akhir)]
        if len(uji) >= MIN_GEMPA_UJI and int((uji['magnitudo'] >= MAGNITUDO_KUAT).sum()) >= MIN_GEMPA_KUAT_UJI:
            return akhir
        akhir += PERPANJANGAN


def syarat_uji(akhir: datetime, arsip_waktu: datetime | None, sekarang: datetime) -> None:
    beku = akhir + JEDA_BEKU
    if sekarang < beku:
        raise SystemExit(f'Uji konfirmatori baru boleh dihitung sesudah {beku:%Y-%m-%d %H:%M} UTC (PROTOKOL_GEMPA.md bagian 2).')
    if arsip_waktu is None or arsip_waktu < beku:
        raise SystemExit(f'Arsip harus dibekukan pada commit sesudah {beku:%Y-%m-%d %H:%M} UTC; yang dipakai sekarang {arsip_waktu}.')


def syarat_kalibrasi(arsip_waktu: datetime | None, sekarang: datetime) -> None:
    if sekarang < AWAL_UJI or arsip_waktu is None or arsip_waktu < AWAL_UJI:
        raise SystemExit(f'Data pengembangan baru lengkap sesudah {AWAL_UJI:%Y-%m-%d %H:%M} UTC, dan arsipnya harus diambil sesudah itu. '
                         'Untuk mencoba sebelum itu pakai --sementara (tidak membekukan apa pun).')


# ---------- Tulisan hasil ----------


def angka(nilai: float | None, desimal: int = 1) -> str:
    if nilai is None or not np.isfinite(nilai):
        return '—'
    teks = f'{nilai:.{desimal}f}'
    # Nilai negatif yang dibulatkan menjadi nol ditulis tanpa tanda.
    return (teks.lstrip('-') if float(teks) == 0 else teks).replace('.', ',')


def persen(nilai: float | None) -> str:
    return '—' if nilai is None or not np.isfinite(nilai) else f'{angka(100 * nilai)}%'


def rentang(ci, fungsi=angka) -> str:
    return f'{fungsi(ci[0])} s.d. {fungsi(ci[1])}'


def poin(nilai: float) -> str:
    return f'{angka(100 * nilai)} poin'


def tabel_aturan(aturan: dict) -> list[str]:
    baris = ['| Aturan | Cakupan (CI 95%) | Kab/kota per gempa (CI 95%) | Radius median | Gempa beradius nol |', '|---|---|---|---|---|']
    for nama, r in aturan.items():
        baris.append(f"| {NAMA[nama]} | {persen(r['cakupan'])} ({rentang(r['cakupan_ci'], persen)}) | {angka(r['kabkota_per_gempa'])} ({rentang(r['kabkota_per_gempa_ci'])}) | "
                     f"{angka(r['radius_median_km'], 0)} km | {r['gempa_radius_nol']} |")
    return baris


def tabel_galat(galat: dict, nama_kolom: str = 'Hubungan') -> list[str]:
    baris = [f'| {nama_kolom} | Laporan | Gempa | Bias (CI 95%) | Galat mutlak rata-rata (CI 95%) | RMSE |', '|---|---|---|---|---|---|']
    for nama, g in galat.items():
        if g is None:
            baris.append(f'| {NAMA.get(nama, nama)} | 0 | 0 | — | — | — |')
            continue
        baris.append(f"| {NAMA.get(nama, nama)} | {g['n_laporan']} | {g['n_gempa']} | {angka(g['bias'], 2)} ({rentang(g['bias_ci'], lambda v: angka(v, 2))}) | "
                     f"{angka(g['mae'], 2)} ({rentang(g['mae_ci'], lambda v: angka(v, 2))}) | {angka(g['rmse'], 2)} |")
    return baris


def label_ci(b: dict) -> str:
    return f"CI {angka(100 * b.get('tingkat', 0.95), 1).removesuffix(',0')}%"


def baris_banding(judul: str | None, b: dict, satu_sisi: bool = True) -> list[str]:
    ci = label_ci(b)
    bawah = f"; batas bawah satu sisi 95% {poin(b['selisih_cakupan_batas_bawah_satu_sisi'])}" if satu_sisi else ''
    kepala = [f'**{judul}**', ''] if judul else []
    return [*kepala,
            f"- Selisih cakupan: {poin(b['selisih_cakupan'])} ({ci} {rentang(b['selisih_cakupan_ci'], poin)}{bawah}).",
            f"- Nisbah jumlah kab/kota yang diberi tahu: {angka(b['nisbah_kabkota'], 2)} ({ci} {rentang(b['nisbah_kabkota_ci'], lambda v: angka(v, 2))}); "
            f"selisih rata-rata per gempa {angka(b['selisih_kabkota'])} ({ci} {rentang(b['selisih_kabkota_ci'])}).", '']


def baris_kelas(judul: str, b: dict | None) -> list[str]:
    """IPE-ID dibanding Tetap-150 pada satu kelas magnitudo."""
    if b is None:
        return [f'**{judul}**', '', 'Tidak ada gempa atau laporan di kelas ini.', '']
    return [f'**{judul}**', '',
            f"{b['n_gempa']} gempa, {b['n_laporan']} laporan. Cakupan IPE-ID {persen(b['cakupan_a'])}, Tetap-150 {persen(b['cakupan_b'])}; "
            f"kab/kota per gempa {angka(b['kabkota_a'])} dan {angka(b['kabkota_b'])}.", '',
            *baris_banding(None, b, satu_sisi=False)]



def kepala_data(meta: dict, gempa: pd.DataFrame, n_laporan: int) -> list[str]:
    return ['| Hal | Nilai |', '|---|---|',
            f"| Protokol | {PROTOKOL} |",
            f"| Arsip perekam | commit `{str(meta.get('arsip_commit', '?'))[:12]}` ({meta.get('arsip_waktu', '?')}) |",
            f"| Batas himpunan (`--sampai`) | {meta.get('sampai') or 'tanpa batas'} |",
            f"| Gempa | {len(gempa)}, dari {gempa['waktu'].min():%Y-%m-%d %H:%M} sampai {gempa['waktu'].max():%Y-%m-%d %H:%M} UTC |",
            f"| Laporan berkoordinat | {n_laporan} |",
            f"| Sidik berkas | kejadian `{meta['sha256_kejadian'][:12]}`, laporan `{meta['sha256_laporan'][:12]}` |", '']


def tulis_kalibrasi(model: dict, hasil: dict, galat: dict, meta: dict, gempa: pd.DataFrame, sementara: bool) -> str:
    ipe = model['ipe_id']
    k = ipe['koefisien']
    judul = '# Kalibrasi IPE-ID dan ambang aturan (data pengembangan)'
    peringatan = ['**SEMENTARA.** Dihitung sebelum data pengembangan lengkap (sebelum 1 Des 2026). Angka di bawah akan berubah dan tidak dibekukan.', ''] if sementara else []
    teks = [judul, '', 'Dibuat oleh `12_evaluasi_gempa.py kalibrasi`. Semua angka di sini berasal dari data pengembangan dan **bukan** uji konfirmatori (PROTOKOL_GEMPA.md bagian 5).', '',
            *peringatan, *kepala_data(meta, gempa, hasil['n_laporan']),
            '## IPE-ID', '',
            f"Bentuk terpilih: **{ipe['bentuk']}**. I = {angka(k['c0'], 3)} + {angka(k['c1'], 3)}·M + ({angka(k['c2'], 3)})·log10(R)"
            + (f" + ({angka(k['c3'], 5)})·R" if ipe['bentuk'] == 'anelastik' else '') + ', R jarak hiposenter dalam km.', '',
            '| Bentuk | c0 | c1 | c2 | c3 | Fisis | Galat mutlak rata-rata, validasi silang per gempa |', '|---|---|---|---|---|---|---|']
    for nama in ('dasar', 'anelastik'):
        v = ipe['validasi_silang'][nama]
        c = v['koefisien']
        teks.append(f"| {nama} | {angka(c['c0'], 3)} | {angka(c['c1'], 3)} | {angka(c['c2'], 3)} | {angka(c['c3'], 5)} | {'ya' if v['fisis'] else 'tidak'} | {angka(v['mae_validasi_silang'], 3)} |")
    teks += ['']
    if not ipe['fisis']:
        teks += ['**IPE-ID gagal dikalibrasi:** tanda koefisiennya tidak fisis. Menurut protokol, G1a, G1b, dan G1 gabungan tidak diuji.', '']
    teks += [f"Tebakan konstan untuk G3 (rata-rata intensitas teramati di data ini): {angka(model['mmi_rata_pengembangan'], 2)}.", '',
             '## Ambang', '', f"Cakupan Tetap-150 pada data pengembangan, yang menjadi sasaran: **{persen(model['target_cakupan'])}**.", '',
             '| Aturan | Ambang intensitas | Sasaran tercapai |', '|---|---|---|']
    for nama, ambang in model['ambang'].items():
        teks.append(f"| {NAMA[nama]} | {angka(ambang)} | {'ya' if model['ambang_tercapai'][nama] else 'tidak, dipakai ambang terendah'} |")
    teks += ['', '## Aturan pada data pengembangan', '', *tabel_aturan(hasil['aturan']), '']
    if 'g1_gabungan' in hasil:
        teks += ['## IPE-ID dibanding Tetap-150 pada data pengembangan', '',
                 'Ambang ditetapkan pada data yang sama, jadi angka ini bukan jawaban G1a, G1b, atau G1 gabungan; ketiganya dijawab dari data uji saja.', '',
                 *baris_kelas('Gempa M ≥ 5', hasil['g1a']), *baris_kelas('Gempa M < 5', hasil['g1b']), *baris_banding('Semua gempa', hasil['g1_gabungan'])]
    teks += ['## Galat intensitas pada data pengembangan', '',
             'IPE-ID dinilai pada data yang juga dipakai mengalibrasinya, jadi galatnya di sini lebih kecil daripada pada data baru.', '', *tabel_galat(galat), '']
    return '\n'.join(teks)


def tulis_uji(hasil: dict, galat: dict, galat_maks: dict, sensitivitas: dict, kelas: dict, model: dict, meta: dict, gempa: pd.DataFrame, akhir: datetime) -> str:
    teks = ['# Uji konfirmatori zona notifikasi gempa (RQ-G)', '', 'Dibuat oleh `12_evaluasi_gempa.py uji` dari gempa periode uji, dengan hubungan dan ambang yang dibekukan di `gempa_model.json`.', '',
            *kepala_data(meta, gempa, hasil['n_laporan']),
            f'Periode uji: {AWAL_UJI:%Y-%m-%d} sampai sebelum {akhir:%Y-%m-%d} UTC' + (' (diperpanjang karena gempa uji terlalu sedikit).' if akhir > AKHIR_UJI else '.'), '',
            '## Aturan pada data uji', '', *tabel_aturan(hasil['aturan']), '']
    if 'g1_gabungan' in hasil:
        g1a, g1b, gabungan = hasil['g1a'], hasil['g1b'], hasil['g1_gabungan']
        teks += ['## G1a (utama): gempa M ≥ 5, cakupan', '', *baris_kelas('IPE-ID − Tetap-150, gempa M ≥ 5', g1a)]
        if g1a:
            teks += [f"**G1a {'terdukung' if g1a['terdukung'] else 'tidak terdukung'}** (syarat: batas bawah selang 97,5% selisih cakupan lebih besar dari 0).", '']
        teks += ['## G1b (utama): gempa M < 5, biaya', '', *baris_kelas('IPE-ID − Tetap-150, gempa M < 5', g1b)]
        if g1b:
            teks += [f"**G1b {'terdukung' if g1b['terdukung'] else 'tidak terdukung'}** (syarat: batas atas selang 97,5% nisbah biaya lebih kecil dari 1). "
                     'Selisih cakupan di atas adalah harga penghematan itu.', '']
        teks += ['Pelengkap (sensitivitas 7 dan 8):', '']
        for label, b in (('M ≥ 5', g1a), ('M < 5', g1b), ('semua gempa', gabungan)):
            if b:
                teks.append(f"- {label}: cakupan dirata-rata per gempa {persen(b['cakupan_makro_a'])} (IPE-ID) dan {persen(b['cakupan_makro_b'])} (Tetap-150); "
                            f"nisbah luas lingkaran {angka(b['nisbah_luas'], 2)} ({label_ci(b)} {rentang(b['nisbah_luas_ci'], lambda v: angka(v, 2))}).")
        teks += ['', '## G1 gabungan (rumusan versi 1.0, sekunder)', '', *baris_banding('IPE-ID − Tetap-150, semua gempa', gabungan),
                 f"- Tidak lebih buruk (batas bawah satu sisi > −5 poin): **{'ya' if gabungan['tidak_lebih_buruk'] else 'tidak'}**.",
                 f"- Lebih hemat (batas atas CI 95% nisbah biaya < 1): **{'ya' if gabungan['lebih_hemat'] else 'tidak'}**.", '',
                 'Dari data pengembangan, peluang kedua syarat ini terpenuhi dengan sekitar 100 gempa diperkirakan hanya 2%, jadi "tidak" di sini bukan bukti bahwa IPE-ID tidak lebih baik (PROTOKOL_GEMPA.md bagian 7).', '']
    else:
        teks += ['## G1a, G1b, dan G1 gabungan', '', 'IPE-ID gagal dikalibrasi (koefisien tidak fisis), jadi ketiganya tidak diuji.', '']
    teks += ['## G2: aturan rujukan', '', *baris_banding('Rujukan − Tetap-150', hasil['g2_rujukan_vs_tetap150'])]
    if 'g2_rujukan_vs_ipe_id' in hasil:
        teks += baris_banding('Rujukan − IPE-ID', hasil['g2_rujukan_vs_ipe_id'])
    teks += ['## G3: galat intensitas pada laporan BMKG periode uji', '', 'Intensitas teramati: titik tengah rentang BMKG.', '', *tabel_galat(galat), '',
             'Sensitivitas 9, intensitas teramati memakai batas atas rentang:', '', *tabel_galat(galat_maks), '',
             '## Sensitivitas', '',
             '| Varian | Gempa | Laporan | G1a: selisih cakupan, M ≥ 5 (CI 97,5%) | G1b: nisbah biaya, M < 5 (CI 97,5%) | G1b: selisih cakupan, M < 5 | Cakupan Rujukan | Cakupan Tetap-150 |',
             '|---|---|---|---|---|---|---|---|']
    for nama, s in sensitivitas.items():
        a, g1a, g1b = s['aturan'], s.get('g1a'), s.get('g1b')
        selisih_a = f"{poin(g1a['selisih_cakupan'])} ({rentang(g1a['selisih_cakupan_ci'], poin)})" if g1a else '—'
        nisbah_b = f"{angka(g1b['nisbah_kabkota'], 2)} ({rentang(g1b['nisbah_kabkota_ci'], lambda v: angka(v, 2))})" if g1b else '—'
        selisih_b = poin(g1b['selisih_cakupan']) if g1b else '—'
        teks.append(f"| {nama} | {s['n_gempa']} | {s['n_laporan']} | {selisih_a} | {nisbah_b} | {selisih_b} | {persen(a['rujukan']['cakupan'])} | {persen(a['tetap150']['cakupan'])} |")
    for judul, daftar in kelas.items():
        teks += ['', f'Sensitivitas 6, per {judul} (tanpa uji):', '', '| Kelas | Aturan | Gempa | Laporan | Cakupan | Kab/kota per gempa |', '|---|---|---|---|---|---|']
        teks += [f"| {b['kelas']} | {NAMA[b['aturan']]} | {b['n_gempa']} | {b['n_laporan']} | {persen(b['cakupan'])} | {angka(b['kabkota_per_gempa'])} |" for b in daftar]
    teks += ['', f"Ambang yang dipakai: {', '.join(f'{NAMA[n]} {angka(a)}' for n, a in model['ambang'].items())}. Ketidakpastian: bootstrap klaster per gempa, {zona.BOOTSTRAP_N} resampel, seed {zona.BOOTSTRAP_SEED}.", '']
    return '\n'.join(teks)



def tulis_dyfi(hasil: dict, model: dict) -> str:
    teks = ['# Hubungan intensitas pada laporan USGS (DYFI)', '', 'Dibuat oleh `12_evaluasi_gempa.py dyfi` sesudah `gempa_model.json` dibekukan (PROTOKOL_GEMPA.md bagian 7). Data DYFI tidak dipakai untuk kalibrasi.', '',
            f"Galat dihitung pada {hasil['n_kotak']} kotak dari {hasil['n_gempa']} gempa: sedikitnya {DYFI_MIN_RESPONS} respons, tidak ditandai meragukan, jarak episenter paling jauh {DYFI_JARAK_MAKS_KM:g} km.", '',
            '## Galat intensitas', '', *tabel_galat(hasil['galat']), '']
    for judul, kunci in (('Per kelas magnitudo', 'per_magnitudo'), ('Per pita jarak episenter', 'per_jarak')):
        teks += [f'## {judul}', '']
        for nama, kelompok in hasil[kunci].items():
            teks += [f'**{NAMA.get(nama, nama)}**', '', *tabel_galat(kelompok, 'Kelas'), '']
    teks += ['## Kotak yang merasakan dan tidak merasakan di dalam zona', '',
             f'Semua kotak dalam {DYFI_JARAK_MAKS_KM:g} km, berapa pun jumlah responsnya; "merasakan" berarti CDI ≥ {DYFI_MERASAKAN_CDI:g}. Aturan rujukan tidak dihitung di sini karena memerlukan intensitas tertinggi laporan BMKG.', '',
             '| Aturan | Kotak merasakan | di dalam zona (CI 95%) | Kotak tidak merasakan | ikut di dalam zona (CI 95%) | Kab/kota per gempa |', '|---|---|---|---|---|---|']
    for nama, z in hasil['zona'].items():
        teks.append(f"| {nama} | {z['kotak_merasakan']} | {persen(z['merasakan_dalam_zona'])} ({rentang(z['merasakan_dalam_zona_ci'], persen)}) | {z['kotak_tidak_merasakan']} | "
                    f"{persen(z['tidak_merasakan_dalam_zona'])} ({rentang(z['tidak_merasakan_dalam_zona_ci'], persen)}) | {angka(z['kabkota_per_gempa'])} |")
    teks += ['', f"Ambang: {', '.join(f'{NAMA[n]} {angka(a)}' for n, a in model['ambang'].items())}.", '']
    return '\n'.join(teks)


def tulis(berkas: Path, teks: str) -> None:
    berkas.parent.mkdir(parents=True, exist_ok=True)
    berkas.write_text(teks, encoding='utf-8', newline='\n')
    print(f'Tulis: {berkas}')


def json_rapi(isi: dict) -> str:
    return json.dumps(isi, indent=2, ensure_ascii=False, default=lambda v: v.item() if hasattr(v, 'item') else str(v)) + '\n'


# ---------- Langkah ----------


def langkah_kalibrasi(sementara: bool, sekarang: datetime) -> None:
    gempa, laporan, meta = muat_bmkg()
    if not sementara:
        syarat_kalibrasi(waktu_iso(meta.get('arsip_waktu')), sekarang)
    gempa, laporan = potong(gempa, laporan, sampai=AWAL_UJI)
    titik = titik_kabkota()
    model = kalibrasi(gempa, laporan, titik)
    model = {'protokol': PROTOKOL, 'dibuat_utc': f'{sekarang:%Y-%m-%dT%H:%M:%SZ}', 'sementara': sementara,
             'data': {**meta, 'n_gempa': int(len(gempa)), 'n_laporan': int(len(laporan)),
                      'gempa_pertama': f"{gempa['waktu'].min():%Y-%m-%dT%H:%M:%SZ}", 'gempa_terakhir': f"{gempa['waktu'].max():%Y-%m-%dT%H:%M:%SZ}"}, **model}
    hasil, _ = bandingkan(gempa, laporan, titik, model)
    galat = galat_intensitas(gempa, laporan, model)
    keluar = SEMENTARA if sementara else RESULTS
    tulis(keluar / 'gempa_model.json', json_rapi(model))
    tulis(keluar / 'gempa_kalibrasi.md', tulis_kalibrasi(model, hasil, galat, meta, gempa, sementara))


def muat_model_beku() -> dict:
    berkas = RESULTS / 'gempa_model.json'
    if not berkas.exists():
        raise SystemExit('results/gempa_model.json belum ada: jalankan langkah kalibrasi dulu (sesudah 1 Des 2026).')
    model = json.loads(berkas.read_text(encoding='utf-8'))
    if model.get('sementara'):
        raise SystemExit('gempa_model.json bertanda sementara; yang dibutuhkan model yang dibekukan.')
    return model


def langkah_dyfi() -> None:
    model = muat_model_beku()
    kejadian = pd.read_csv(GEMPA / 'usgs_kejadian.csv').set_index('id')
    dyfi = pd.read_csv(GEMPA / 'usgs_dyfi.csv')
    hasil = nilai_dyfi(kejadian, dyfi, model, titik_kabkota())
    tulis(RESULTS / 'gempa_dyfi.md', tulis_dyfi(hasil, model))


def langkah_uji(sekarang: datetime) -> None:
    model = muat_model_beku()
    gempa, laporan, meta = muat_bmkg()
    data_sampai = waktu_iso(f"{meta['sampai']}T00:00:00+00:00") if meta.get('sampai') else None
    akhir = akhir_periode_uji(gempa, data_sampai)
    syarat_uji(akhir, waktu_iso(meta.get('arsip_waktu')), sekarang)
    gempa, laporan = potong(gempa, laporan, dari=AWAL_UJI, sampai=akhir)
    titik = titik_kabkota()
    hasil, tabel = bandingkan(gempa, laporan, titik, model)
    sensitivitas = {nama: bandingkan(g, lap, titik, model, toleransi_km=toleransi)[0] for nama, (g, lap, toleransi) in varian_sensitivitas(gempa, laporan).items()}
    kelas = {'kelas magnitudo': per_kelas(gempa, tabel, 'magnitudo', KELAS_MAGNITUDO), 'kelas kedalaman': per_kelas(gempa, tabel, 'kedalaman_km', KELAS_KEDALAMAN)}
    galat = galat_intensitas(gempa, laporan, model)
    galat_maks = galat_intensitas(gempa, laporan, model, teramati='mmi_maks')
    tulis(RESULTS / 'gempa_uji.md', tulis_uji(hasil, galat, galat_maks, sensitivitas, kelas, model, meta, gempa, akhir))
    per_gempa = gempa[['waktu_utc', 'magnitudo', 'kedalaman_km', 'mmi_maks']].join(
        pd.concat({nama: t[['radius_km', 'n_laporan', 'n_terjangkau', 'n_kabkota']] for nama, t in tabel.items()}, axis=1).pipe(
            lambda d: d.set_axis([f'{b}_{a}' for a, b in d.columns], axis=1)))
    (RESULTS / 'gempa_uji_per_gempa.csv').write_text(per_gempa.to_csv(lineterminator='\n'), encoding='utf-8', newline='\n')
    print(f'Tulis: {RESULTS / "gempa_uji_per_gempa.csv"}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    langkah = parser.add_subparsers(dest='langkah', required=True)
    p = langkah.add_parser('kalibrasi', help='kalibrasi IPE-ID dan ambang dari data pengembangan')
    p.add_argument('--sementara', action='store_true', help='coba sebelum data pengembangan lengkap; tulis ke data/gempa/sementara/')
    langkah.add_parser('dyfi', help='nilai hubungan yang dibekukan pada laporan USGS')
    langkah.add_parser('uji', help='uji konfirmatori pada gempa periode uji')
    args = parser.parse_args()
    sekarang = datetime.now(timezone.utc)
    if args.langkah == 'kalibrasi':
        langkah_kalibrasi(args.sementara, sekarang)
    elif args.langkah == 'dyfi':
        langkah_dyfi()
    else:
        langkah_uji(sekarang)


if __name__ == '__main__':
    main()
