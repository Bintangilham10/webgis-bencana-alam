"""Evaluasi RQ-L1: skill produk peringatan longsor resmi (PROTOKOL.md bagian 5–6).

Masukan: data/inventaris.parquet, data/sampel_pvmbg.parquet, dan (bila ada)
data/sampel_cews.parquet dari 01_inventaris.py dan 02_produk_resmi.py.
Keluaran: results/rq_l1_ringkasan.csv, results/rq_l1_ringkasan.md, dan
results/rq_l1_distribusi.png.

Jalankan dari root repo:
    research/.venv/Scripts/python research/06_evaluasi_rq_l1.py
    research/.venv/Scripts/python research/06_evaluasi_rq_l1.py --uji 3   # sampel uji, keluaran ke data/uji/
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from sigap_riset.metrik import BOOTSTRAP_N, bootstrap_ci, per_case, pooled_auc, summarize  # noqa: E402
from sigap_riset.paths import CACHE, DATA, RESULTS  # noqa: E402

CONTROL_LABELS = {'kontrol_prov': 'spasial (provinsi)', 'kontrol_kab': 'spasial (kab/kota)', 'kontrol_waktu': 'temporal'}
SCORE_LABELS = {'skor_potensi': 'Potensi bulanan PVMBG', 'skor_zkgt': 'ZKGT (dalam layer bulanan)', 'skor_cews': 'Peringatan hujan BMKG (CEWS)'}
CLASS_NAMES = ['0 (luar/sangat rendah)', '1 Rendah', '2 Menengah', '3 Tinggi']
CEWS_NAMES = ['0 Aman', '1 Waspada', '2 Siaga', '3 Awas']


def analyse(sample: pd.DataFrame, score: str, control: str, keep: set | None = None) -> dict:
    table = per_case(sample, score, control)
    if keep is not None:
        table = table[table['kasus_id'].isin(keep)]
    if table.empty:
        return {'n_kasus': 0}
    result = summarize(table)
    result['auc_ci'] = bootstrap_ci(table, lambda t: t['konkordansi'].mean())
    result['tss_2_ci'] = bootstrap_ci(table, lambda t: summarize(t)['tss_2'])
    cases = sample[(sample['jenis'] == 'kasus') & sample['kasus_id'].isin(table['kasus_id'])][score]
    controls = sample[(sample['jenis'] == control) & sample['kasus_id'].isin(table['kasus_id'])][score]
    result['auc_gabungan'] = pooled_auc(cases.to_numpy(), controls.to_numpy())
    return result


def auc_difference(sample: pd.DataFrame, control: str, keep: set | None = None) -> dict:
    """L1c: konkordansi potensi bulanan − ZKGT pada kasus dan kontrol yang sama."""
    a = per_case(sample, 'skor_potensi', control)[['kasus_id', 'konkordansi']]
    b = per_case(sample, 'skor_zkgt', control)[['kasus_id', 'konkordansi']]
    table = a.merge(b, on='kasus_id', suffixes=('_potensi', '_zkgt'))
    if keep is not None:
        table = table[table['kasus_id'].isin(keep)]
    table['selisih'] = table['konkordansi_potensi'] - table['konkordansi_zkgt']
    return {'n_kasus': len(table), 'selisih_auc': table['selisih'].mean(), 'selisih_ci': bootstrap_ci(table, lambda t: t['selisih'].mean())}


def month_coverage(sample: pd.DataFrame) -> tuple[pd.Series, set]:
    """Fraksi kontrol provinsi yang jatuh di dalam poligon layer, per bulan (sensitivitas 6)."""
    coverage = sample[sample['jenis'] == 'kontrol_prov'].groupby(['tahun', 'bulan'])['ada_poligon'].mean()
    incomplete = set(coverage[coverage < 0.5 * coverage.median()].index)
    return coverage, incomplete


def row(produk: str, analisis: str, kontrol: str, result: dict) -> dict:
    out = {'produk': produk, 'analisis': analisis, 'kontrol': kontrol}
    for key, value in result.items():
        if isinstance(value, tuple):
            out[f'{key}_bawah'], out[f'{key}_atas'] = value
        else:
            out[key] = value
    return out


# PROTOKOL.md v1.1 bagian 3: tingkat ketepatan tanggal yang boleh masuk analisis
# utama. Produk bulanan butuh bulan yang benar; CEWS per dasarian butuh tanggalnya.
MAIN_PRECISION = {'pvmbg': {'hari', 'bulan'}, 'cews': {'hari'}}


def case_info(sample: pd.DataFrame, inventory: pd.DataFrame) -> pd.DataFrame:
    return inventory.set_index('id').loc[list(set(sample.loc[sample['jenis'] == 'kasus', 'kasus_id']))]


def main_cases(info: pd.DataFrame, product: str) -> set:
    return set(info.index[info['presisi_tanggal'].isin(MAIN_PRECISION[product])])


def evaluate_pvmbg(sample: pd.DataFrame, inventory: pd.DataFrame) -> tuple[list[dict], dict]:
    rows = []
    info = case_info(sample, inventory)
    main = main_cases(info, 'pvmbg')
    coverage, incomplete = month_coverage(sample)

    # Analisis utama.
    for score in ('skor_potensi', 'skor_zkgt'):
        for control in ('kontrol_prov', 'kontrol_waktu'):
            rows.append(row(SCORE_LABELS[score], 'utama', CONTROL_LABELS[control], analyse(sample, score, control, main)))
    rows.append(row('Potensi − ZKGT (L1c)', 'utama', CONTROL_LABELS['kontrol_prov'], auc_difference(sample, 'kontrol_prov', main)))

    # Sensitivitas (PROTOKOL.md bagian 6), semuanya di dalam himpunan kasus utama
    # kecuali nomor 7 yang justru memasukkan kembali tanggal perkiraan.
    typed = set(info.index[info['tipe_diketahui']]) & main
    rows.append(row(SCORE_LABELS['skor_potensi'], 'sens: tipe diketahui', CONTROL_LABELS['kontrol_prov'], analyse(sample, 'skor_potensi', 'kontrol_prov', typed)))
    rows.append(row(SCORE_LABELS['skor_potensi'], 'sens: tipe diketahui', CONTROL_LABELS['kontrol_waktu'], analyse(sample, 'skor_potensi', 'kontrol_waktu', typed)))
    rows.append(row(SCORE_LABELS['skor_potensi'], 'sens: kontrol kab/kota', CONTROL_LABELS['kontrol_kab'], analyse(sample, 'skor_potensi', 'kontrol_kab', main)))
    rows.append(row('Potensi − ZKGT (L1c)', 'sens: kontrol kab/kota', CONTROL_LABELS['kontrol_kab'], auc_difference(sample, 'kontrol_kab', main)))
    for source, ids in info.groupby('sumber').groups.items():
        for control in ('kontrol_prov', 'kontrol_waktu'):
            rows.append(row(SCORE_LABELS['skor_potensi'], f'sens: sumber {source}', CONTROL_LABELS[control], analyse(sample, 'skor_potensi', control, set(ids) & main)))
    years = pd.to_datetime(info['tanggal']).dt.year
    for year, ids in years.groupby(years).groups.items():
        for control in ('kontrol_prov', 'kontrol_waktu'):
            rows.append(row(SCORE_LABELS['skor_potensi'], f'sens: tahun {year}', CONTROL_LABELS[control], analyse(sample, 'skor_potensi', control, set(ids) & main)))

    # Tanpa bulan bercakupan tidak lengkap: kasus di bulan itu dan kontrol temporal di bulan itu dibuang.
    case_month = sample[sample['jenis'] == 'kasus'].set_index('kasus_id')[['tahun', 'bulan']].apply(tuple, axis=1)
    complete_cases = set(case_month.index[~case_month.isin(incomplete)]) & main
    trimmed = sample[~((sample['jenis'] == 'kontrol_waktu') & sample[['tahun', 'bulan']].apply(tuple, axis=1).isin(incomplete))]
    for control in ('kontrol_prov', 'kontrol_waktu'):
        rows.append(row(SCORE_LABELS['skor_potensi'], 'sens: tanpa bulan tak lengkap', CONTROL_LABELS[control], analyse(trimmed, 'skor_potensi', control, complete_cases)))

    # Sensitivitas 7: semua kasus, termasuk yang tanggalnya hanya perkiraan tahun.
    for control in ('kontrol_prov', 'kontrol_waktu'):
        rows.append(row(SCORE_LABELS['skor_potensi'], 'sens: semua presisi tanggal', CONTROL_LABELS[control], analyse(sample, 'skor_potensi', control)))
    rows.append(row('Potensi − ZKGT (L1c)', 'sens: semua presisi tanggal', CONTROL_LABELS['kontrol_prov'], auc_difference(sample, 'kontrol_prov')))

    meta = {
        'bulan_tak_lengkap': sorted(f'{y}-{m:02d}' for y, m in incomplete),
        'cakupan_median': float(coverage.median()),
        'presisi_pvmbg': {k: int(v) for k, v in info['presisi_tanggal'].value_counts().items()},
    }
    return rows, meta


def evaluate_cews(sample: pd.DataFrame, inventory: pd.DataFrame) -> list[dict]:
    main = main_cases(case_info(sample, inventory), 'cews')
    controls = ('kontrol_prov', 'kontrol_waktu')
    rows = [row(SCORE_LABELS['skor_cews'], 'utama', CONTROL_LABELS[c], analyse(sample, 'skor_cews', c, main)) for c in controls]
    rows += [row(SCORE_LABELS['skor_cews'], 'sens: semua presisi tanggal', CONTROL_LABELS[c], analyse(sample, 'skor_cews', c)) for c in controls]
    return rows


def plot_distributions(pvmbg: pd.DataFrame, cews: pd.DataFrame | None, path) -> None:
    panels = [('skor_potensi', pvmbg, CLASS_NAMES), ('skor_zkgt', pvmbg, CLASS_NAMES)]
    if cews is not None:
        panels.append(('skor_cews', cews, CEWS_NAMES))
    fig, axes = plt.subplots(1, len(panels), figsize=(5.2 * len(panels), 3.8), constrained_layout=True)
    colors = {'kasus': '#c62828', 'kontrol_prov': '#546e7a', 'kontrol_waktu': '#90a4ae'}
    names = {'kasus': 'Kasus', 'kontrol_prov': 'Kontrol spasial', 'kontrol_waktu': 'Kontrol temporal'}
    for ax, (score, sample, labels) in zip(np.atleast_1d(axes), panels):
        width = 0.26
        for i, kind in enumerate(('kasus', 'kontrol_prov', 'kontrol_waktu')):
            values = sample.loc[sample['jenis'] == kind, score]
            share = values.value_counts(normalize=True).reindex(range(4), fill_value=0)
            ax.bar(np.arange(4) + (i - 1) * width, share, width, color=colors[kind], label=names[kind])
        ax.set_xticks(range(4), labels, rotation=20, ha='right', fontsize=8)
        ax.set_ylabel('Proporsi')
        ax.set_title(SCORE_LABELS[score], fontsize=10)
        ax.spines[['top', 'right']].set_visible(False)
    np.atleast_1d(axes)[0].legend(frameon=False, fontsize=8)
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fmt(value, digits=3) -> str:
    return '–' if value is None or (isinstance(value, float) and np.isnan(value)) else f'{value:.{digits}f}'


def markdown(table: pd.DataFrame, meta: dict) -> str:
    lines = [
        '# Hasil RQ-L1 — skill produk peringatan longsor resmi',
        '',
        f"Dihitung {meta['dihitung']} dari cache data (diambil {meta['diambil']}). Protokol: `research/PROTOKOL.md`.",
        f"Bootstrap klaster {BOOTSTRAP_N} kali. Layer PVMBG yang tidak ada/rusak: {', '.join(meta['bulan_dikeluarkan']) or '-'}.",
        f"Bulan bercakupan tidak lengkap (sensitivitas): {', '.join(meta['bulan_tak_lengkap']) or '-'} (median cakupan {fmt(meta['cakupan_median'], 2)}).",
        f"Presisi tanggal kasus PVMBG: {meta['presisi_pvmbg']}. Analisis utama PVMBG memakai presisi hari dan bulan; CEWS hanya presisi hari (PROTOKOL.md v1.1).",
        *([f"Dasarian CEWS tanpa produk di sumber BMKG (dikeluarkan): {', '.join(meta['cews_dikeluarkan']) or '-'}."] if meta['cews'] else []),
        '',
        '| Produk | Analisis | Kontrol | n kasus | AUC berpasangan [CI 95%] | AUC gabungan | POD≥2 | POFD≥2 | TSS≥2 [CI 95%] | POD=3 | POFD=3 |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
    ]
    for r in table.to_dict('records'):
        if 'selisih_auc' in r and not np.isnan(r.get('selisih_auc', np.nan)):
            auc = f"Δ {fmt(r['selisih_auc'])} [{fmt(r.get('selisih_ci_bawah'))}, {fmt(r.get('selisih_ci_atas'))}]"
            lines.append(f"| {r['produk']} | {r['analisis']} | {r['kontrol']} | {int(r['n_kasus'])} | {auc} | | | | | | |")
            continue
        if not r.get('n_kasus'):
            continue
        lines.append(
            f"| {r['produk']} | {r['analisis']} | {r['kontrol']} | {int(r['n_kasus'])} "
            f"| {fmt(r['auc'])} [{fmt(r.get('auc_ci_bawah'))}, {fmt(r.get('auc_ci_atas'))}] | {fmt(r.get('auc_gabungan'))} "
            f"| {fmt(r.get('pod_2'), 2)} | {fmt(r.get('pofd_2'), 2)} | {fmt(r.get('tss_2'))} [{fmt(r.get('tss_2_ci_bawah'))}, {fmt(r.get('tss_2_ci_atas'))}] "
            f"| {fmt(r.get('pod_3'), 2)} | {fmt(r.get('pofd_3'), 2)} |"
        )
    lines += [
        '',
        'Kriteria (ditetapkan sebelum hasil dihitung): produk punya diskriminasi bila batas bawah CI AUC > 0,5; '
        'potensi bulanan memberi nilai tambah atas ZKGT bila batas bawah CI selisih > 0.',
    ]
    return '\n'.join(lines) + '\n'


def read_list(path, column: str) -> list:
    return pd.read_csv(path)[column].tolist() if path.exists() and path.stat().st_size > len(column) + 2 else []


def fetched_range() -> str:
    times = []
    for name in ('pvmbg-wms', 'pvmbg-portal', 'magma'):
        manifest = CACHE / name / '_manifest.jsonl'
        if manifest.exists():
            times += [json.loads(line)['fetched_at'] for line in manifest.read_text(encoding='utf-8').splitlines() if line]
    return f'{min(times)[:10]} s.d. {max(times)[:10]}' if times else '-'


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--uji', type=int, help='pakai sampel uji N kasus; keluaran ke data/uji/')
    args = parser.parse_args()
    suffix = f'_uji{args.uji}' if args.uji else ''
    out_dir = DATA / 'uji' if args.uji else RESULTS
    out_dir.mkdir(parents=True, exist_ok=True)

    inventory = pd.read_parquet(DATA / 'inventaris.parquet')
    pvmbg = pd.read_parquet(DATA / f'sampel_pvmbg{suffix}.parquet')
    cews_file = DATA / f'sampel_cews{suffix}.parquet'
    cews = pd.read_parquet(cews_file) if cews_file.exists() else None

    rows, meta = evaluate_pvmbg(pvmbg, inventory)
    if cews is not None:
        rows += evaluate_cews(cews, inventory)
    meta |= {
        'dihitung': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
        'diambil': fetched_range(),
        'bulan_dikeluarkan': read_list(DATA / 'pvmbg_bulan_dikeluarkan.csv', 'bulan'),
        'cews': cews is not None,
        'cews_dikeluarkan': read_list(DATA / 'cews_dasarian_dikeluarkan.csv', 'dasarian'),
    }

    table = pd.DataFrame(rows)
    table.to_csv(out_dir / 'rq_l1_ringkasan.csv', index=False)
    (out_dir / 'rq_l1_ringkasan.md').write_text(markdown(table, meta), encoding='utf-8')
    # Grafik memakai kasus analisis utama, sama dengan angka utama di tabel.
    precision = inventory.set_index('id')['presisi_tanggal']
    main_only = lambda sample, product: sample[sample['kasus_id'].map(precision).isin(MAIN_PRECISION[product])]  # noqa: E731
    plot_distributions(main_only(pvmbg, 'pvmbg'), None if cews is None else main_only(cews, 'cews'), out_dir / 'rq_l1_distribusi.png')
    print(f'Keluaran di {out_dir}')
    if not args.uji:
        print(markdown(table[table['analisis'] == 'utama'], meta))


if __name__ == '__main__':
    main()
