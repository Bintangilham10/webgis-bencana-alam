"""Metode EDuMaP (event, duration matrix, performance) untuk menilai model
peringatan dini longsor regional (Calvello & Piciullo, 2016, NHESS 16:103–122).

Langkah:
1. Kejadian: tiap sel (zona peringatan × satuan waktu) punya kelas peringatan
   i = 1..n_w dan kelas kejadian longsor j = 1..n_l (1 = tidak ada).
2. Matriks durasi D: d_ij = total waktu ketika kelas peringatan i bersamaan
   dengan kelas kejadian j (persamaan 1). Jumlah semua elemen = lama analisis.
3. Kinerja: dua kriteria yang mengabaikan d_11 (tanpa peringatan, tanpa
   longsor), karena nilainya jauh lebih besar dari elemen lain.
   - Kriteria A (klasifikasi peringatan): tabel kontingensi 2×2 → CA, MA, FA, TN.
   - Kriteria B (tingkat kebenaran): kode warna hijau, kuning, merah, ungu.
   Rumus indikator mengikuti Tabel 8 makalah.
"""

from __future__ import annotations

import numpy as np

GRADES = ('Gre', 'Yel', 'Red', 'Pur')


def duration_matrix(warning_class, landslide_class, duration, n_w: int = 4, n_l: int = 4) -> np.ndarray:
    """Kelas mulai dari 1; duration = lama tiap sel (mis. hari)."""
    d = np.zeros((n_w, n_l))
    np.add.at(d, (np.asarray(warning_class) - 1, np.asarray(landslide_class) - 1), np.asarray(duration, float))
    return d


def alert_classification(n_w: int, n_l: int, alert_from: int, event_from: int) -> np.ndarray:
    """Kriteria A: peringatan dianggap 'alert' bila kelas ≥ alert_from, kejadian
    dianggap ada bila kelas ≥ event_from. d_11 tidak diberi kelas (None)."""
    table = np.empty((n_w, n_l), dtype=object)
    for i in range(1, n_w + 1):
        for j in range(1, n_l + 1):
            alert, event = i >= alert_from, j >= event_from
            table[i - 1, j - 1] = 'CA' if alert and event else 'MA' if event else 'FA' if alert else 'TN'
    table[0, 0] = None
    return table


def grade_by_distance(n_w: int, n_l: int) -> np.ndarray:
    """Kriteria B sederhana: warna menurut selisih kelas |i − j| (0 hijau … 3 ungu)."""
    table = np.empty((n_w, n_l), dtype=object)
    for i in range(n_w):
        for j in range(n_l):
            table[i, j] = GRADES[min(abs(i - j), len(GRADES) - 1)]
    table[0, 0] = None
    return table


def indicators(d: np.ndarray, alert: np.ndarray, grade: np.ndarray) -> dict:
    """Indikator kinerja Tabel 8 Calvello & Piciullo (2016); d_11 diabaikan."""
    mask = np.ones_like(d, dtype=bool)
    mask[0, 0] = False
    total = d[mask].sum()
    sum_a = {k: d[(alert == k) & mask].sum() for k in ('CA', 'MA', 'FA', 'TN')}
    sum_b = {k: d[(grade == k) & mask].sum() for k in GRADES}
    ca, ma, fa, tn = sum_a['CA'], sum_a['MA'], sum_a['FA'], sum_a['TN']
    ratio = lambda a, b: a / b if b else np.nan  # noqa: E731
    hr = ratio(ca, ca + ma)
    pp = ratio(ca, ca + fa)
    no_warning = d[0, 1:]
    no_landslide = d[1:, 0]
    pur = grade == 'Pur'
    return {
        'CA': ca, 'MA': ma, 'FA': fa, 'TN': tn,
        'Ieff': ratio(ca + tn, total),  # indeks efisiensi
        'HR': hr,  # hit rate
        'PP': pp,  # predictive power
        'TS': ratio(ca, ca + ma + fa),  # threat score
        'OR': ratio(ca + tn, ma + fa),  # odds ratio (definisi makalah)
        'MR': 1 - ratio(ca + tn, total),  # misclassification rate
        'RMA': 1 - hr,  # missed alert rate
        'RFA': 1 - pp,  # false alert rate
        'ER': ratio(sum_b['Red'] + sum_b['Pur'], total),  # error rate
        'PSM': ratio(sum_b['Pur'], total),  # probability of serious mistakes
        'PSM_NW': ratio(no_warning[pur[0, 1:]].sum(), no_warning.sum()),  # serius, tanpa peringatan
        'PSM_NL': ratio(no_landslide[pur[1:, 0]].sum(), no_landslide.sum()),  # serius, tanpa longsor
        'IMA': ratio(d[pur & (alert == 'MA')].sum(), ma),  # keparahan missed alert
        'IFA': ratio(d[pur & (alert == 'FA')].sum(), fa),  # keparahan false alert
    }
