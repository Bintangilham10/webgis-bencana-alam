"""Arsip perekam SIGAP (branch `arsip-data`) untuk skrip riset.

Folder yang diminta disalin dari branch itu ke research/data/arsip/, jadi skrip
membaca berkas biasa. Hash commit arsip dikembalikan supaya bisa dicatat di
keluaran: dua kali jalan pada commit yang sama memberi data yang sama.
"""

from __future__ import annotations

import io
import re
import shutil
import subprocess
import tarfile
from dataclasses import dataclass

from .paths import DATA, ROOT

ARCHIVE_DIR = DATA / 'arsip'


@dataclass(frozen=True)
class Arsip:
    commit: str
    waktu: str  # waktu commit, ISO 8601


def _git(*args: str, text: bool = True):
    return subprocess.run(['git', *args], cwd=ROOT.parent, check=True, capture_output=True, text=text).stdout


def extract(folder: str, fetch: bool = True, commit: str | None = None) -> Arsip:
    """Salin satu folder tingkat atas dari branch arsip-data ke research/data/arsip/.

    Salinan lama folder itu dibuang dulu, jadi isinya persis seperti di commit yang
    disalin. `fetch=False` memakai arsip yang terakhir diambil (tanpa jaringan).
    `commit` menyalin arsip pada commit tertentu, untuk mengulang hasil lama."""
    if '/' in folder or '\\' in folder or folder in ('', '.', '..'):
        raise ValueError(f'Nama folder arsip tidak sah: {folder!r}')
    if commit and not re.fullmatch(r'[0-9a-f]{7,40}', commit):
        raise ValueError(f'Hash commit tidak sah: {commit!r}')
    if fetch:
        _git('fetch', '--depth=1', 'origin', commit or 'arsip-data')
        ref = 'FETCH_HEAD'
    else:
        ref = commit or 'refs/remotes/origin/arsip-data'
    commit = _git('rev-parse', f'{ref}^{{commit}}').strip()
    waktu = _git('show', '-s', '--format=%cI', commit).strip()
    tar_bytes = _git('archive', commit, folder, text=False)
    target = ARCHIVE_DIR / folder
    if target.exists():
        shutil.rmtree(target)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tar:
        tar.extractall(ARCHIVE_DIR, filter='data')
    return Arsip(commit=commit, waktu=waktu)
