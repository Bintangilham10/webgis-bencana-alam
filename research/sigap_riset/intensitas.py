"""Hubungan intensitas–jarak untuk gempa (PROTOKOL_GEMPA.md bagian 4 dan 5).

Tiap hubungan adalah fungsi `f(magnitudo, jarak_km)` yang mengembalikan perkiraan
intensitas (skala MMI, berdesimal) dan turun terhadap jarak. Jarak mana yang dimaksud
(hiposenter atau episenter) disebut di tiap hubungan dan di daftar ATURAN skrip 12.

Dua kelompok:
- hubungan dari pustaka, dipakai apa adanya (tidak ada angka yang disetel di sini);
- IPE-ID, bentuk linear sederhana yang koefisiennya dikalibrasi dari laporan
  dirasakan BMKG pada data pengembangan.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from . import zona

# Jarak terkecil yang dimasukkan ke logaritma (km).
R_MIN_KM = 1.0
# Bentuk dengan suku anelastik hanya dipilih bila galat mutlak rata-ratanya lebih kecil
# sedikitnya sebesar ini (satuan MMI) pada validasi silang per gempa.
UNTUNG_MIN_ANELASTIK = 0.02


@dataclass(frozen=True)
class IpeLinear:
    """I = c0 + c1·M + c2·log10(R) + c3·R, dengan R jarak hiposenter dalam km."""

    c0: float
    c1: float
    c2: float
    c3: float = 0.0

    def __call__(self, magnitudo, jarak_km):
        r = np.maximum(jarak_km, R_MIN_KM)
        return self.c0 + self.c1 * magnitudo + self.c2 * np.log10(r) + self.c3 * r

    @property
    def fisis(self) -> bool:
        """Intensitas naik dengan magnitudo dan turun dengan jarak."""
        return self.c1 > 0 and self.c2 < 0 and self.c3 <= 0

    def sebagai_kamus(self) -> dict:
        return asdict(self)


def kalibrasi(magnitudo, jarak_km, mmi, anelastik: bool = False) -> IpeLinear:
    """Kuadrat terkecil biasa, bobot sama untuk tiap laporan."""
    m = np.asarray(magnitudo, dtype=float)
    r = np.maximum(np.asarray(jarak_km, dtype=float), R_MIN_KM)
    kolom = [np.ones_like(m), m, np.log10(r)] + ([r] if anelastik else [])
    koef, *_ = np.linalg.lstsq(np.column_stack(kolom), np.asarray(mmi, dtype=float), rcond=None)
    return IpeLinear(*map(float, koef))


def prediksi_tanpa_gempanya(data: pd.DataFrame, anelastik: bool = False) -> np.ndarray:
    """Validasi silang per gempa: tiap laporan diperkirakan oleh hubungan yang
    dikalibrasi tanpa semua laporan dari gempa yang sama.

    `data` punya kolom gempa_id, magnitudo, jarak_hiposenter_km, mmi.
    """
    hasil = np.empty(len(data))
    kelompok = data.groupby('gempa_id').indices
    semua = np.arange(len(data))
    for baris in kelompok.values():
        latih = np.setdiff1d(semua, baris)
        ipe = kalibrasi(data['magnitudo'].to_numpy()[latih], data['jarak_hiposenter_km'].to_numpy()[latih],
                        data['mmi'].to_numpy()[latih], anelastik)
        hasil[baris] = ipe(data['magnitudo'].to_numpy()[baris], data['jarak_hiposenter_km'].to_numpy()[baris])
    return hasil


def pilih_bentuk(data: pd.DataFrame) -> tuple[IpeLinear, dict]:
    """Bentuk IPE-ID menurut aturan protokol.

    Bentuk dasar (tanpa c3) dipakai, kecuali bentuk dengan suku anelastik fisis
    (c3 ≤ 0) dan galat mutlak rata-ratanya pada validasi silang per gempa lebih kecil
    sedikitnya UNTUNG_MIN_ANELASTIK. Hubungan terpilih dikalibrasi ulang pada semua data.
    """
    mmi = data['mmi'].to_numpy()
    catatan = {}
    calon = {}
    for nama, anelastik in (('dasar', False), ('anelastik', True)):
        ipe = kalibrasi(data['magnitudo'], data['jarak_hiposenter_km'], mmi, anelastik)
        mae = float(np.mean(np.abs(prediksi_tanpa_gempanya(data, anelastik) - mmi)))
        calon[nama] = ipe
        catatan[nama] = {'koefisien': ipe.sebagai_kamus(), 'fisis': ipe.fisis, 'mae_validasi_silang': mae}
    pakai_anelastik = (calon['anelastik'].fisis
                       and catatan['dasar']['mae_validasi_silang'] - catatan['anelastik']['mae_validasi_silang'] >= UNTUNG_MIN_ANELASTIK)
    terpilih = 'anelastik' if pakai_anelastik else 'dasar'
    catatan['terpilih'] = terpilih
    return calon[terpilih], catatan


def galat(prediksi, teramati, gempa_id, *, n: int = zona.BOOTSTRAP_N, seed: int = zona.BOOTSTRAP_SEED) -> dict:
    """Bias (prediksi − teramati), galat mutlak rata-rata, dan RMSE, dengan selang
    kepercayaan 95% bootstrap per gempa."""
    selisih = np.asarray(prediksi, dtype=float) - np.asarray(teramati, dtype=float)
    per_gempa = pd.DataFrame({'g': np.asarray(gempa_id), 'e': selisih, 'a': np.abs(selisih), 'k': selisih ** 2}).groupby('g').agg(
        n=('e', 'size'), e=('e', 'sum'), a=('a', 'sum'), k=('k', 'sum'))
    kolom = {nama: per_gempa[nama].to_numpy() for nama in ('n', 'e', 'a', 'k')}

    def hitung(k: dict[str, np.ndarray]) -> np.ndarray:
        jumlah = k['n'].sum(axis=-1)
        return np.stack([k['e'].sum(axis=-1) / jumlah, k['a'].sum(axis=-1) / jumlah, np.sqrt(k['k'].sum(axis=-1) / jumlah)])

    titik = hitung(kolom)
    ulang = zona.bootstrap_gempa(kolom, hitung, n=n, seed=seed)
    return {
        'n_laporan': int(len(selisih)), 'n_gempa': int(len(per_gempa)),
        'bias': float(titik[0]), 'bias_ci': zona.selang(ulang[0]),
        'mae': float(titik[1]), 'mae_ci': zona.selang(ulang[1]),
        'rmse': float(titik[2]), 'rmse_ci': zona.selang(ulang[2]),
    }


def mmi_tengah(mmi_min, mmi_maks):
    """Intensitas teramati dari rentang BMKG (mis. "II-III"): titik tengahnya."""
    return (np.asarray(mmi_min, dtype=float) + np.asarray(mmi_maks, dtype=float)) / 2


# ---------- Hubungan dari pustaka ----------


def pga_fukushima_tanaka(magnitudo, jarak_km):
    """Percepatan tanah puncak horizontal dalam Gal (cm/s²), Fukushima & Tanaka (1990):

        log10 A = 0,41 M − log10(R + 0,032 × 10^(0,41 M)) − 0,0034 R + 1,30

    Aslinya R adalah jarak terdekat ke bidang patahan. Makalah rujukan memasukkan jarak
    hiposenter, dan begitu pula di sini.
    """
    m = np.asarray(magnitudo, dtype=float)
    r = np.asarray(jarak_km, dtype=float)
    return 10 ** (1.30 + 0.41 * m - np.log10(r + 0.032 * 10 ** (0.41 * m)) - 0.0034 * r)


def mmi_rujukan(magnitudo, jarak_km):
    """Perkiraan intensitas seperti di Firdaus dkk. (2026), persamaan 3–5.

    PGA Fukushima–Tanaka pada jarak hiposenter, lalu MMI = 3,66 log10(PGA) − 1,66
    (Wald dkk., 1999) untuk semua intensitas, seperti di makalah itu. Persamaan 4 di
    makalah tercetak "1010^(0,41M)"; dengan 10^(0,41M) delapan dari sepuluh baris
    Tabel 2-nya terulang sampai dua desimal (tests/test_intensitas.py).
    """
    return 3.66 * np.log10(pga_fukushima_tanaka(magnitudo, jarak_km)) - 1.66


# Aturan rujukan memakai jarak hiposenter; sasarannya intensitas tertinggi yang
# dilaporkan BMKG untuk gempa itu, jadi berbeda tiap gempa.
JARAK_RUJUKAN = 'hiposenter'


def mmi_allen2012(magnitudo, jarak_km):
    """Allen, Wald & Worden (2012), "Intensity attenuation for active crustal regions",
    J. Seismol. 16, 409–433, versi jarak hiposenter:

        MMI = c0 + c1·M + c2·ln √(R² + RM²),  ditambah c4·ln(R / 50) bila R > 50 km
        RM  = m1 + m2·exp(M − 5)

    Koefisien dari implementasi rujukan GEM OpenQuake (hazardlib, allen_2012_ipe.py,
    kelas AllenEtAl2012Rhypo): c0 2,085; c1 1,428; c2 −1,402; c4 0,078; m1 −0,209;
    m2 2,042. Suku tapak (site) tidak dipakai, seperti di implementasi itu.
    """
    m = np.asarray(magnitudo, dtype=float)
    r = np.maximum(np.asarray(jarak_km, dtype=float), R_MIN_KM)
    rm = -0.209 + 2.042 * np.exp(m - 5)
    mmi = 2.085 + 1.428 * m - 1.402 * np.log(np.sqrt(r ** 2 + rm ** 2))
    return mmi + np.where(r > 50, 0.078 * np.log(r / 50), 0.0)


JARAK_ALLEN2012 = 'hiposenter'
