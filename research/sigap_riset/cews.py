"""Arsip peringatan dini curah hujan tinggi BMKG (CEWS) dari perekam SIGAP.

Perekam menyimpan daftar kab/kota per level untuk tiap dasarian di branch
`arsip-data` (folder `bmkg-cews/`), lengkap dengan kode Kepmendagri.
"""

from __future__ import annotations

import io
import json
import subprocess
import tarfile

from .paths import DATA, ROOT

LEVELS = {'aman': 0, 'waspada': 1, 'siaga': 2, 'awas': 3}
ARCHIVE_DIR = DATA / 'arsip'


def extract_archive() -> None:
    """Salin folder bmkg-cews/ dari branch arsip-data ke research/data/arsip/."""
    repo = ROOT.parent
    subprocess.run(['git', 'fetch', '--depth=1', 'origin', 'arsip-data'], cwd=repo, check=True, capture_output=True)
    tar_bytes = subprocess.run(['git', 'archive', 'FETCH_HEAD', 'bmkg-cews'], cwd=repo, check=True, capture_output=True).stdout
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tar:
        tar.extractall(ARCHIVE_DIR, filter='data')


def load_levels() -> tuple[dict, set]:
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
                    levels[(entry['kode'], year, month, num)] = LEVELS[level]
    return levels, set(latest)
