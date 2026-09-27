"""Metrik verifikasi untuk desain kasus-kontrol berpasangan (PROTOKOL.md bagian 5)."""

from __future__ import annotations

import numpy as np
import pandas as pd

BOOTSTRAP_N = 2000
BOOTSTRAP_SEED = 20260927


def concordance(case_score: float, control_scores: np.ndarray) -> float:
    """Peluang skor kasus > skor kontrol, seri dihitung setengah."""
    if len(control_scores) == 0:
        return np.nan
    return float(np.mean((case_score > control_scores) + 0.5 * (case_score == control_scores)))


def rank_average(values: np.ndarray) -> np.ndarray:
    """Peringkat (mulai 1) dengan rata-rata untuk nilai seri."""
    order = np.argsort(values, kind='mergesort')
    ranks = np.empty(len(values))
    _, first, counts = np.unique(values[order], return_index=True, return_counts=True)
    ranks[order] = np.repeat(first + (counts + 1) / 2, counts)
    return ranks


def pooled_auc(cases: np.ndarray, controls: np.ndarray) -> float:
    """AUC gabungan (Mann–Whitney): semua kasus vs semua kontrol."""
    cases, controls = np.asarray(cases, float), np.asarray(controls, float)
    if not len(cases) or not len(controls):
        return np.nan
    ranks = rank_average(np.concatenate([cases, controls]))
    return float((ranks[: len(cases)].sum() - len(cases) * (len(cases) + 1) / 2) / (len(cases) * len(controls)))


def per_case(sample: pd.DataFrame, score: str, control_kind: str, threshold_low: int = 2, threshold_high: int = 3) -> pd.DataFrame:
    """Satu baris per kasus: konkordansi dengan kontrolnya sendiri dan jumlah peringatan."""
    rows = []
    cases = sample[sample['jenis'] == 'kasus'].set_index('kasus_id')
    controls = sample[sample['jenis'] == control_kind]
    for case_id, group in controls.groupby('kasus_id'):
        if case_id not in cases.index:
            continue
        s = float(cases.at[case_id, score])
        c = group[score].to_numpy(float)
        rows.append({
            'kasus_id': case_id,
            'konkordansi': concordance(s, c),
            'kasus_skor': s,
            'n_kontrol': len(c),
            'kasus_peringatan_2': float(s >= threshold_low),
            'kasus_peringatan_3': float(s >= threshold_high),
            'kontrol_peringatan_2': float((c >= threshold_low).sum()),
            'kontrol_peringatan_3': float((c >= threshold_high).sum()),
        })
    return pd.DataFrame(rows)


def summarize(cases: pd.DataFrame) -> dict:
    """AUC berpasangan, POD, POFD, TSS, dan rasio frekuensi dari tabel per_case."""
    n_controls = cases['n_kontrol'].sum()
    result = {'n_kasus': len(cases), 'n_kontrol': int(n_controls), 'auc': cases['konkordansi'].mean()}
    for t in (2, 3):
        pod = cases[f'kasus_peringatan_{t}'].mean()
        pofd = cases[f'kontrol_peringatan_{t}'].sum() / n_controls if n_controls else np.nan
        result |= {f'pod_{t}': pod, f'pofd_{t}': pofd, f'tss_{t}': pod - pofd, f'rasio_frekuensi_{t}': pod / pofd if pofd else np.nan}
    return result


def bootstrap_ci(cases: pd.DataFrame, statistic, n: int = BOOTSTRAP_N, seed: int = BOOTSTRAP_SEED) -> tuple[float, float]:
    """CI 95% bootstrap klaster: kasus diambil ulang beserta kontrolnya."""
    if len(cases) < 2:
        return np.nan, np.nan
    rng = np.random.default_rng(seed)
    values = [statistic(cases.iloc[rng.integers(0, len(cases), len(cases))]) for _ in range(n)]
    lo, hi = np.nanpercentile(values, [2.5, 97.5])
    return float(lo), float(hi)
