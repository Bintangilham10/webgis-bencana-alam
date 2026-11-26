"""Zona notifikasi gempa: radius dari sebuah hubungan intensitas–jarak, cakupan lokasi
yang merasakan, biaya (kab/kota yang diberi tahu), dan selang kepercayaannya.

Semua aturan yang dibandingkan di PROTOKOL_GEMPA.md berbentuk lingkaran di sekitar
episenter: untuk gempa bermagnitudo M dan berkedalaman h km, aturan menentukan radius
r(M, h) di permukaan, dan lokasi di dalam radius itu diberi tahu. Modul ini tidak tahu
hubungan intensitas mana yang dipakai (lihat intensitas.py); ia hanya menerima fungsi
`intensitas(magnitudo, jarak_km)` yang turun terhadap jarak.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np
import pandas as pd

from .geo import haversine_km

# Batas atas pencarian radius. Laporan BMKG terjauh di data pengembangan 820 km.
R_MAKS_KM = 2000.0
TOLERANSI_RADIUS_KM = 0.05
BOOTSTRAP_N = 10_000
BOOTSTRAP_SEED = 20261201

Hubungan = Callable[[float, float], float]


def jarak_hiposenter(jarak_episenter_km, kedalaman_km):
    """Jarak lurus dari hiposenter ke titik di permukaan (bumi dianggap datar; cukup untuk ≤ 2.000 km)."""
    return np.hypot(jarak_episenter_km, kedalaman_km)


def radius_km(intensitas: Hubungan, magnitudo: float, kedalaman_km: float, ambang: float, *,
              jarak: str = 'hiposenter', r_maks: float = R_MAKS_KM) -> float:
    """Jarak episenter terjauh yang perkiraan intensitasnya masih ≥ ambang.

    `jarak` menyebut jarak mana yang diminta hubungan itu: 'hiposenter' atau 'episenter'.
    Hasil 0 berarti di episenter pun perkiraannya di bawah ambang (tidak ada yang diberi
    tahu); hasil r_maks berarti di batas pencarian pun masih ≥ ambang.
    """
    if jarak not in ('hiposenter', 'episenter'):
        raise ValueError(f'jarak tidak dikenal: {jarak}')

    def di(d: float) -> float:
        return intensitas(magnitudo, math.hypot(d, kedalaman_km) if jarak == 'hiposenter' else d)

    if di(0.0) < ambang:
        return 0.0
    if di(r_maks) >= ambang:
        return r_maks
    dekat, jauh = 0.0, r_maks
    while jauh - dekat > TOLERANSI_RADIUS_KM:
        tengah = (dekat + jauh) / 2
        if di(tengah) >= ambang:
            dekat = tengah
        else:
            jauh = tengah
    return dekat


def radius_gempa(gempa: pd.DataFrame, intensitas: Hubungan, ambang: float | pd.Series, *, jarak: str = 'hiposenter') -> pd.Series:
    """Radius tiap gempa (kolom magnitudo, kedalaman_km), berindeks seperti `gempa`.

    `ambang` satu angka untuk semua gempa, atau satu angka per gempa (Series berindeks
    id gempa) untuk aturan yang sasarannya berbeda tiap gempa.
    """
    if isinstance(ambang, pd.Series):
        per_gempa = ambang.reindex(gempa.index).to_numpy(dtype=float)
        if np.isnan(per_gempa).any():
            raise ValueError('ada gempa tanpa ambang')
    else:
        per_gempa = np.full(len(gempa), float(ambang))
    nilai = [radius_km(intensitas, m, h, k, jarak=jarak) for m, h, k in zip(gempa['magnitudo'], gempa['kedalaman_km'], per_gempa)]
    return pd.Series(nilai, index=gempa.index, dtype=float)


def kabkota_dalam_radius(gempa: pd.DataFrame, radius: pd.Series, titik: np.ndarray) -> pd.Series:
    """Jumlah kab/kota yang titik wakilnya berada dalam radius tiap gempa.

    `titik` berukuran (n, 2): lintang dan bujur titik wakil tiap kab/kota.
    """
    jumlah = []
    for lat, lon, r in zip(gempa['lat'], gempa['lon'], radius):
        jumlah.append(int((haversine_km(lat, lon, titik[:, 0], titik[:, 1]) <= r).sum()) if r > 0 else 0)
    return pd.Series(jumlah, index=gempa.index, dtype=int)


def tabel_per_gempa(gempa: pd.DataFrame, laporan: pd.DataFrame, radius: pd.Series, titik: np.ndarray,
                    toleransi_km: float = 0.0) -> pd.DataFrame:
    """Satu baris per gempa untuk satu aturan: radius, laporan yang terjangkau, dan biaya.

    `gempa` berindeks id gempa; `laporan` punya kolom gempa_id dan jarak_episenter_km.
    Laporan terjangkau bila jarak episenternya ≤ radius + toleransi. Laporan dari
    gempa yang tidak ada di `gempa` diabaikan.
    """
    laporan = laporan[laporan['gempa_id'].isin(gempa.index)]
    batas = laporan['gempa_id'].map(radius) + toleransi_km
    terjangkau = (laporan['jarak_episenter_km'] <= batas) & (laporan['gempa_id'].map(radius) > 0)
    per_gempa = laporan.assign(terjangkau=terjangkau).groupby('gempa_id')['terjangkau'].agg(['size', 'sum'])
    tabel = pd.DataFrame({
        'radius_km': radius,
        'n_laporan': per_gempa['size'].reindex(gempa.index).fillna(0).astype(int),
        'n_terjangkau': per_gempa['sum'].reindex(gempa.index).fillna(0).astype(int),
        'n_kabkota': kabkota_dalam_radius(gempa, radius, titik),
    })
    tabel['luas_km2'] = math.pi * tabel['radius_km'] ** 2
    return tabel


def cakupan(tabel: pd.DataFrame) -> float:
    """Bagian laporan lokasi yang berada di dalam zona, digabung dari semua gempa."""
    total = tabel['n_laporan'].sum()
    return float(tabel['n_terjangkau'].sum() / total) if total else float('nan')


def ambang_setara(gempa: pd.DataFrame, laporan: pd.DataFrame, intensitas: Hubungan, target: float, kisi: np.ndarray, *,
                  jarak: str = 'hiposenter', toleransi_km: float = 0.0) -> float | None:
    """Ambang intensitas tertinggi di `kisi` yang cakupannya masih ≥ target.

    Ambang yang lebih tinggi memberi radius lebih kecil, jadi yang dicari adalah zona
    tersempit yang menjangkau sedikitnya `target` bagian laporan. None bila tidak ada.
    """
    laporan = laporan[laporan['gempa_id'].isin(gempa.index)]
    for ambang in sorted(kisi, reverse=True):
        radius = radius_gempa(gempa, intensitas, float(ambang), jarak=jarak)
        batas = laporan['gempa_id'].map(radius)
        dalam = (laporan['jarak_episenter_km'] <= batas + toleransi_km) & (batas > 0)
        if dalam.mean() >= target:
            return float(ambang)
    return None


def _indeks_bootstrap(n_gempa: int, n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, n_gempa, size=(n, n_gempa))


def selang(nilai: np.ndarray, tingkat: float = 0.95) -> tuple[float, float]:
    """Selang persentil dua sisi dari nilai-nilai resampel."""
    sisa = (1 - tingkat) / 2
    bawah, atas = np.nanquantile(nilai, [sisa, 1 - sisa])
    return float(bawah), float(atas)


def bootstrap_gempa(kolom: dict[str, np.ndarray], statistik: Callable[[dict[str, np.ndarray]], np.ndarray], *,
                    n: int = BOOTSTRAP_N, seed: int = BOOTSTRAP_SEED) -> np.ndarray:
    """Bootstrap klaster per gempa: gempa diambil ulang beserta semua laporannya.

    `kolom` berisi larik per gempa (panjang sama). `statistik` menerima kamus larik
    berukuran (n, n_gempa), yaitu nilai per gempa pada tiap resampel, dan mengembalikan
    satu nilai per resampel (panjang n).
    """
    panjang = {len(v) for v in kolom.values()}
    if len(panjang) != 1:
        raise ValueError('semua kolom harus sepanjang jumlah gempa')
    indeks = _indeks_bootstrap(panjang.pop(), n, seed)
    return statistik({nama: np.asarray(v)[indeks] for nama, v in kolom.items()})


def banding_aturan(a: pd.DataFrame, b: pd.DataFrame, *, n: int = BOOTSTRAP_N, seed: int = BOOTSTRAP_SEED, tingkat: float = 0.95) -> dict:
    """Aturan A dibanding aturan B pada gempa yang sama (tabel_per_gempa, indeks sama).

    Mengembalikan selisih cakupan (A − B, bagian laporan), selisih rata-rata kab/kota
    yang diberi tahu per gempa (A − B), dan perbandingan jumlah kab/kota (A / B),
    masing-masing dengan selang kepercayaan dua sisi pada `tingkat` (bawaan 95%) dan,
    untuk selisih cakupan, batas bawah satu sisi 95% (uji tidak-lebih-buruk).
    """
    if not a.index.equals(b.index):
        raise ValueError('kedua tabel harus memuat gempa yang sama dengan urutan yang sama')
    kolom = {'lap': a['n_laporan'].to_numpy(), 'ya_a': a['n_terjangkau'].to_numpy(), 'ya_b': b['n_terjangkau'].to_numpy(),
             'kab_a': a['n_kabkota'].to_numpy(), 'kab_b': b['n_kabkota'].to_numpy()}

    def hitung(k: dict[str, np.ndarray]) -> np.ndarray:
        laporan = k['lap'].sum(axis=-1)
        with np.errstate(divide='ignore', invalid='ignore'):
            d_cakupan = (k['ya_a'].sum(axis=-1) - k['ya_b'].sum(axis=-1)) / laporan
            d_kab = k['kab_a'].mean(axis=-1) - k['kab_b'].mean(axis=-1)
            nisbah = k['kab_a'].sum(axis=-1) / k['kab_b'].sum(axis=-1)
        return np.stack([d_cakupan, d_kab, nisbah])

    titik = hitung(kolom)
    ulang = bootstrap_gempa(kolom, hitung, n=n, seed=seed)
    return {
        'tingkat': tingkat,
        'selisih_cakupan': float(titik[0]), 'selisih_cakupan_ci': selang(ulang[0], tingkat),
        'selisih_cakupan_batas_bawah_satu_sisi': float(np.nanquantile(ulang[0], 0.05)),
        'selisih_kabkota': float(titik[1]), 'selisih_kabkota_ci': selang(ulang[1], tingkat),
        'nisbah_kabkota': float(titik[2]), 'nisbah_kabkota_ci': selang(ulang[2], tingkat),
    }


def ringkas_aturan(tabel: pd.DataFrame, *, n: int = BOOTSTRAP_N, seed: int = BOOTSTRAP_SEED) -> dict:
    """Cakupan dan biaya satu aturan, dengan selang kepercayaan 95% bootstrap per gempa."""
    kolom = {'lap': tabel['n_laporan'].to_numpy(), 'ya': tabel['n_terjangkau'].to_numpy(), 'kab': tabel['n_kabkota'].to_numpy()}

    def hitung(k: dict[str, np.ndarray]) -> np.ndarray:
        with np.errstate(divide='ignore', invalid='ignore'):
            return np.stack([k['ya'].sum(axis=-1) / k['lap'].sum(axis=-1), k['kab'].mean(axis=-1)])

    ulang = bootstrap_gempa(kolom, hitung, n=n, seed=seed)
    return {
        'n_gempa': int(len(tabel)), 'n_laporan': int(tabel['n_laporan'].sum()),
        'cakupan': cakupan(tabel), 'cakupan_ci': selang(ulang[0]),
        'kabkota_per_gempa': float(tabel['n_kabkota'].mean()), 'kabkota_per_gempa_ci': selang(ulang[1]),
        'radius_median_km': float(tabel['radius_km'].median()),
        'gempa_radius_nol': int((tabel['radius_km'] == 0).sum()),
        'luas_rata_km2': float(tabel['luas_km2'].mean()),
    }
