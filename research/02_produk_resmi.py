"""Nilai produk peringatan resmi di titik kasus dan kontrol (RQ-L1).

- PVMBG: potensi gerakan tanah bulanan (`zona_perki`) dan ZKGT (`unsur`) dari
  GetFeatureInfo layer `pmbgi:prakiraan_{tahun}_{bulan}`.
- CEWS BMKG: level peringatan curah hujan tinggi per kab/kota per dasarian,
  dibaca dari arsip perekam (branch `arsip-data`, folder `bmkg-cews/`), yang
  nama kab/kotanya sudah dicocokkan ke kode Kepmendagri.

Desain kasus-kontrol mengikuti PROTOKOL.md bagian 3–4. Semua respons PVMBG
di-cache, jadi skrip aman dihentikan dan dijalankan ulang.

Jalankan dari root repo:
    research/.venv/Scripts/python research/02_produk_resmi.py            # PVMBG + CEWS
    research/.venv/Scripts/python research/02_produk_resmi.py --batas 3  # uji 3 kasus
"""

from __future__ import annotations

import argparse
import io
import json
import random
import subprocess
import tarfile
import time
import zlib
from datetime import date

import pandas as pd

from sigap_riset.http import Client
from sigap_riset.paths import DATA, ROOT
from sigap_riset.waktu import dasarian, dasarian_index, month_index
from sigap_riset.wilayah import kab_kota_at, random_points

PVMBG_WMS = 'https://vsi.esdm.go.id/data/api/public/geohazard/map-layer/wms'
# Titik rujukan di zona kerentanan Tinggi (Banjarnegara) untuk mengenali layer kosong.
REFERENCE = (-7.275, 109.67)
# Galat GeoServer untuk layer yang rusak permanen (2025-12: kolom zona_perki hilang).
BROKEN_LAYER = 'can not be used with this layer'
FIRST_MONTH, LAST_MONTH = (2022, 1), (2025, 12)
N_SPATIAL = 10
N_TEMPORAL = 6
SCORES = {'tinggi': 3, 'menengah': 2, 'rendah': 1, 'sangat rendah': 0}
CEWS_LEVELS = {'aman': 0, 'waspada': 1, 'siaga': 2, 'awas': 3}
ARCHIVE_DIR = DATA / 'arsip'


def score(label) -> int:
    # Di luar poligon (None/NaN) dianggap skor 0, sama dengan Sangat Rendah.
    return SCORES.get(label.strip().lower(), 0) if isinstance(label, str) else 0


def seed_of(text: str) -> int:
    return zlib.crc32(text.encode()) & 0x7FFFFFFF


def all_months() -> list[tuple[int, int]]:
    start, end = month_index(*FIRST_MONTH), month_index(*LAST_MONTH)
    return [(i // 12, i % 12 + 1) for i in range(start, end + 1)]


def all_dasarian() -> list[tuple[int, int, int]]:
    return [(y, m, n) for y, m in all_months() for n in (1, 2, 3)]


def other_periods(periods: list, current, index_of, rng: random.Random, k: int) -> list:
    """k periode acak yang berjarak > 1 dari periode kejadian."""
    pool = [p for p in periods if abs(index_of(*p) - index_of(*current)) > 1]
    return rng.sample(pool, min(k, len(pool)))


# ---------- PVMBG ----------

def feature_info_url(year: int, month: int, lat: float, lon: float) -> str:
    layer = f'pmbgi:prakiraan_{year}_{month}'
    d = 0.01
    params = {
        'service': 'WMS', 'version': '1.1.1', 'request': 'GetFeatureInfo', 'layers': layer, 'query_layers': layer,
        'styles': '', 'srs': 'EPSG:4326', 'bbox': f'{lon - d},{lat - d},{lon + d},{lat + d}',
        'width': '101', 'height': '101', 'x': '50', 'y': '50', 'info_format': 'application/json', 'feature_count': '5',
    }
    return f"{PVMBG_WMS}?{'&'.join(f'{k}={v}' for k, v in params.items())}"


def is_feature_info(text: str) -> bool:
    """Balasan yang sah: JSON GetFeatureInfo, atau galat GeoServer untuk layer
    yang rusak permanen. Galat lain (mis. GeoServer sedang bermasalah) dicoba
    ulang oleh Client dan tidak di-cache."""
    return text.lstrip().startswith('{') or BROKEN_LAYER in text


def parse_feature_info(text: str | None) -> dict | None:
    """Atribut poligon di titik; None bila layer bulan itu tidak ada (404) atau
    rusak (layer 2025-12 tidak punya kolom zona_perki, jadi style-nya ditolak)."""
    if text is None or BROKEN_LAYER in text:
        return None
    features = json.loads(text).get('features') or []
    props = features[0]['properties'] if features else {}
    return {'ada_poligon': bool(features), 'potensi': props.get('zona_perki'), 'zkgt': props.get('unsur')}


def read_pvmbg(client: Client, year: int, month: int, lat: float, lon: float) -> dict | None:
    url = feature_info_url(year, month, round(lat, 5), round(lon, 5))
    return parse_feature_info(client.text(url, valid=is_feature_info))


def layer_status(client: Client) -> dict[tuple[int, int], str]:
    status = {}
    for year, month in all_months():
        result = read_pvmbg(client, year, month, *REFERENCE)
        status[(year, month)] = 'tidak_ada_atau_rusak' if result is None else 'ada' if result['ada_poligon'] else 'kosong'
    return status


def build_pvmbg_plan(cases: pd.DataFrame, status: dict) -> pd.DataFrame:
    """Baris (kasus/kontrol, titik, bulan) yang perlu dibaca dari layer PVMBG."""
    usable = [m for m, s in status.items() if s == 'ada']
    in_scope = cases[[status.get((d.year, d.month)) == 'ada' for d in cases['tanggal']]]
    specs = []
    for c in in_scope.itertuples():
        specs.append((f'{c.id}|prov', c.prov_kode, N_SPATIAL, seed_of(f'{c.id}|prov')))
        specs.append((f'{c.id}|kab', c.kab_kode, N_SPATIAL, seed_of(f'{c.id}|kab')))
    controls = random_points(specs)

    rows = []
    for c in in_scope.itertuples():
        month = (c.tanggal.year, c.tanggal.month)
        base = {'kasus_id': c.id}
        rows.append({**base, 'jenis': 'kasus', 'lat': c.lat, 'lon': c.lon, 'tahun': month[0], 'bulan': month[1]})
        for kind in ('prov', 'kab'):
            for lat, lon in controls.get(f'{c.id}|{kind}', []):
                rows.append({**base, 'jenis': f'kontrol_{kind}', 'lat': lat, 'lon': lon, 'tahun': month[0], 'bulan': month[1]})
        rng = random.Random(seed_of(f'{c.id}|waktu'))
        for year, mon in other_periods(usable, month, month_index, rng, N_TEMPORAL):
            rows.append({**base, 'jenis': 'kontrol_waktu', 'lat': c.lat, 'lon': c.lon, 'tahun': year, 'bulan': mon})
    return pd.DataFrame(rows)


def sample_pvmbg(cases: pd.DataFrame) -> pd.DataFrame:
    client = Client('pvmbg-wms', min_interval_s=1.0)
    status = layer_status(client)
    excluded = {f'{y}-{m:02d}': s for (y, m), s in status.items() if s != 'ada'}
    print(f'Layer PVMBG 2022–2025: {sum(s == "ada" for s in status.values())} bulan terpakai; dikeluarkan: {excluded or "-"}')

    plan = build_pvmbg_plan(cases, status)
    print(f'Titik yang dibaca: {len(plan)} (kasus {int((plan["jenis"] == "kasus").sum())})')
    results = []
    started = time.monotonic()
    for i, row in enumerate(plan.itertuples(), 1):
        results.append(read_pvmbg(client, row.tahun, row.bulan, row.lat, row.lon) or {'ada_poligon': False, 'potensi': None, 'zkgt': None})
        if i % 250 == 0:
            rate = client.network_requests / max(time.monotonic() - started, 1)
            remaining = (len(plan) - i) / rate / 60 if rate else 0
            print(f'  {i}/{len(plan)} titik; {client.network_requests} request jaringan; sisa ±{remaining:.0f} menit', flush=True)

    sample = pd.concat([plan.reset_index(drop=True), pd.DataFrame(results)], axis=1)
    sample['skor_potensi'] = sample['potensi'].map(score)
    sample['skor_zkgt'] = sample['zkgt'].map(score)
    pd.DataFrame([{'bulan': k, 'status': v} for k, v in excluded.items()]).to_csv(DATA / 'pvmbg_bulan_dikeluarkan.csv', index=False)
    return sample


# ---------- CEWS ----------

def extract_cews_archive() -> None:
    """Salin folder bmkg-cews/ dari branch arsip-data ke research/data/arsip/."""
    repo = ROOT.parent
    subprocess.run(['git', 'fetch', '--depth=1', 'origin', 'arsip-data'], cwd=repo, check=True, capture_output=True)
    tar_bytes = subprocess.run(['git', 'archive', 'FETCH_HEAD', 'bmkg-cews'], cwd=repo, check=True, capture_output=True).stdout
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tar:
        tar.extractall(ARCHIVE_DIR, filter='data')


def load_cews_levels() -> tuple[dict, set]:
    """{(kode kab/kota, tahun, bulan, dasarian): skor} dan himpunan dasarian yang tersedia.
    Bila satu dasarian punya beberapa versi (revisi), yang terakhir terlihat dipakai."""
    latest: dict[tuple[int, int, int], dict] = {}
    for file in (ARCHIVE_DIR / 'bmkg-cews').glob('*/*/dasarian-*.json'):
        record = json.loads(file.read_text(encoding='utf-8'))
        d = record['dasarian']
        key = (d['year'], d['month'], d['num'])
        if key not in latest or record['first_seen_at'] > latest[key]['first_seen_at']:
            latest[key] = record
    levels = {}
    for (year, month, num), record in latest.items():
        for level, entries in record['levels'].items():
            for entry in entries:
                if entry.get('kode'):
                    levels[(entry['kode'], year, month, num)] = CEWS_LEVELS[level]
    return levels, set(latest)


def sample_cews(cases: pd.DataFrame, pvmbg_sample: pd.DataFrame | None, force: bool) -> pd.DataFrame | None:
    extract_cews_archive()
    levels, available = load_cews_levels()
    needed = set(all_dasarian())
    missing = sorted(needed - available)
    if missing and not force:
        print(f'CEWS: arsip perekam belum lengkap ({len(needed) - len(missing)}/{len(needed)} dasarian 2022–2025); '
              f'jalankan ulang setelah backfill selesai, atau pakai --paksa-cews.')
        return None

    # Kontrol spasial CEWS memakai kab/kota titik kontrol provinsi yang sama dengan PVMBG.
    control_points = {}
    if pvmbg_sample is not None:
        prov = pvmbg_sample[(pvmbg_sample['jenis'] == 'kontrol_prov')].drop_duplicates(['kasus_id', 'lat', 'lon'])
        codes = kab_kota_at(prov['lat'].tolist(), prov['lon'].tolist())
        for (case_id, _), code in zip(prov[['kasus_id', 'lat']].itertuples(index=False), codes):
            control_points.setdefault(case_id, []).append(code[0] if code else None)

    usable = sorted(available & needed)
    rows = []
    for c in cases.itertuples():
        das = dasarian(c.tanggal)
        if das not in available:
            continue
        base = {'kasus_id': c.id}
        rows.append({**base, 'jenis': 'kasus', 'kab_kode': c.kab_kode, 'dasarian': das})
        for code in control_points.get(c.id, []):
            if code:
                rows.append({**base, 'jenis': 'kontrol_prov', 'kab_kode': code, 'dasarian': das})
        rng = random.Random(seed_of(f'{c.id}|cews'))
        for other in other_periods(usable, das, dasarian_index, rng, N_TEMPORAL):
            rows.append({**base, 'jenis': 'kontrol_waktu', 'kab_kode': c.kab_kode, 'dasarian': other})
    sample = pd.DataFrame(rows)
    # Kab/kota yang tidak tercantum di daftar mana pun dianggap Aman (PROTOKOL.md bagian 5).
    sample['skor_cews'] = [levels.get((k, *d), 0) for k, d in zip(sample['kab_kode'], sample['dasarian'])]
    sample[['tahun', 'bulan', 'ke']] = pd.DataFrame(sample['dasarian'].tolist(), index=sample.index)
    return sample.drop(columns='dasarian')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--batas', type=int, help='hanya N kasus pertama (uji coba)')
    parser.add_argument('--tanpa-pvmbg', action='store_true')
    parser.add_argument('--tanpa-cews', action='store_true')
    parser.add_argument('--paksa-cews', action='store_true', help='jalankan CEWS walau arsip belum lengkap')
    args = parser.parse_args()

    inventory = pd.read_parquet(DATA / 'inventaris.parquet')
    inventory['tanggal'] = pd.to_datetime(inventory['tanggal']).dt.date
    cases = inventory[inventory['di_daratan'] & inventory['tanggal'].map(lambda d: date(2022, 1, 1) <= d <= date(2025, 12, 31))]
    if args.batas:
        cases = cases.head(args.batas)
    print(f'Kasus 2022–2025: {len(cases)}')
    suffix = f'_uji{args.batas}' if args.batas else ''

    pvmbg = None
    if not args.tanpa_pvmbg:
        pvmbg = sample_pvmbg(cases)
        pvmbg.to_parquet(DATA / f'sampel_pvmbg{suffix}.parquet', index=False)
        print(f'PVMBG: {len(pvmbg)} baris → data/sampel_pvmbg{suffix}.parquet')
    elif (DATA / f'sampel_pvmbg{suffix}.parquet').exists():
        pvmbg = pd.read_parquet(DATA / f'sampel_pvmbg{suffix}.parquet')

    if not args.tanpa_cews:
        cews = sample_cews(cases, pvmbg, args.paksa_cews)
        if cews is not None:
            cews.to_parquet(DATA / f'sampel_cews{suffix}.parquet', index=False)
            print(f'CEWS: {len(cews)} baris → data/sampel_cews{suffix}.parquet')


if __name__ == '__main__':
    main()
