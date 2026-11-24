"""Laporan gempa dirasakan BMKG dari arsip perekam SIGAP.

BMKG menulis guncangan yang dirasakan sebagai teks, mis.
"III-IV Aceh Besar, III Banda Aceh, II Sigli" (skala MMI). Modul ini mengubah
teks itu menjadi satu baris per lokasi dan memilih revisi terakhir tiap gempa.

Yang perlu diingat saat memakai datanya:
- daftar ini hanya memuat tempat yang melaporkan merasakan; tempat yang tidak
  disebut belum tentu tidak merasakan;
- "II-III" berarti rentang, disimpan sebagai mmi_min dan mmi_maks;
- nama lokasi bisa kab/kota, kecamatan, desa, atau pulau (lihat geokode.py).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from .geo import haversine_km

FEEDS = ('gempadirasakan', 'autogempa')
ROMAN = {'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10, 'XI': 11, 'XII': 12}
_ITEM = re.compile(r'^([IVX]+)\s*(?:-\s*([IVX]+))?\s+(\S.*)$')
# Parameter gempa yang direvisi BMKG bisa muncul dengan waktu bergeser sedetik
# (13 Okt 2026: 06.42.28 M 4,6 menjadi 06.42.29 M 4,1, teks dirasakan sama). Batasnya
# sengaja sempit: pada rentetan gempa Manggarai 18 Nov 2026 ada gempa berbeda yang
# hanya berselang 33–73 detik di tempat yang hampir sama.
SAME_EVENT_SECONDS = 10
SAME_EVENT_KM = 50


@dataclass(frozen=True)
class Laporan:
    nama: str  # nama lokasi seperti ditulis BMKG, tanpa angka intensitas
    mmi_min: int
    mmi_maks: int
    keterangan: str | None = None  # bagian tanpa angka sesudah nama, mis. "Tanggamus"


@dataclass
class Gempa:
    id: str
    waktu: datetime
    lat: float
    lon: float
    kedalaman_km: float
    magnitudo: float
    wilayah: str
    dirasakan: str
    feed: str
    pertama_terlihat: datetime  # paling awal muncul di arsip, dari feed mana pun
    versi: int = 1  # jumlah versi berbeda yang terekam
    laporan: list[Laporan] = field(default_factory=list)


def parse_dirasakan(teks: str | None) -> list[Laporan]:
    """Teks "Dirasakan" → daftar laporan per lokasi, urut seperti aslinya.

    Bagian tanpa angka Romawi di depannya dianggap keterangan untuk lokasi
    sebelumnya ("III Ulu Belu, Tanggamus" = Ulu Belu di Tanggamus)."""
    laporan: list[Laporan] = []
    for bagian in (teks or '').replace('–', '-').replace('—', '-').split(','):
        bagian = ' '.join(bagian.split())
        if not bagian or bagian == '-':
            continue
        cocok = _ITEM.match(bagian)
        if cocok and cocok.group(1) in ROMAN and (cocok.group(2) is None or cocok.group(2) in ROMAN):
            a = ROMAN[cocok.group(1)]
            b = ROMAN[cocok.group(2)] if cocok.group(2) else a
            laporan.append(Laporan(nama=cocok.group(3), mmi_min=min(a, b), mmi_maks=max(a, b)))
        elif laporan and laporan[-1].keterangan is None:
            terakhir = laporan[-1]
            laporan[-1] = Laporan(terakhir.nama, terakhir.mmi_min, terakhir.mmi_maks, bagian)
    return laporan


def _waktu(teks: str) -> datetime:
    return datetime.fromisoformat(teks.replace('Z', '+00:00'))


def _dari_catatan(catatan: dict) -> Gempa | None:
    data = catatan.get('data') or {}
    try:
        waktu = _waktu(data['DateTime'])
        lat, lon = (float(x) for x in data['Coordinates'].split(','))
        kedalaman = float(re.match(r'\s*([\d.]+)', data['Kedalaman']).group(1))
        magnitudo = float(data['Magnitude'])
    except (KeyError, ValueError, AttributeError):
        return None
    teks = ' '.join((data.get('Dirasakan') or '').split())
    return Gempa(
        id=f'bmkg:{waktu:%Y%m%dT%H%M%S}Z', waktu=waktu, lat=lat, lon=lon, kedalaman_km=kedalaman, magnitudo=magnitudo,
        wilayah=' '.join((data.get('Wilayah') or '').split()), dirasakan=teks, feed=catatan.get('feed', ''),
        pertama_terlihat=_waktu(catatan['first_seen_at']), laporan=parse_dirasakan(teks),
    )


def gabung_revisi(catatan: list[Gempa]) -> list[Gempa]:
    """Satu baris per gempa: versi yang terakhir terlihat dan memuat daftar lokasi.

    Versi tanpa daftar lokasi hanya dipakai bila tidak ada versi lain."""
    kelompok: list[list[Gempa]] = []
    for g in sorted(catatan, key=lambda x: x.waktu):
        sama = None
        for anggota in reversed(kelompok):
            if g.waktu - anggota[-1].waktu > timedelta(seconds=SAME_EVENT_SECONDS):
                continue
            if any(abs((g.waktu - a.waktu).total_seconds()) <= SAME_EVENT_SECONDS
                   and haversine_km(g.lat, g.lon, a.lat, a.lon) <= SAME_EVENT_KM for a in anggota):
                sama = anggota
                break
        if sama is None:
            kelompok.append([g])
        else:
            sama.append(g)
    hasil = []
    for anggota in kelompok:
        berdaftar = [a for a in anggota if a.laporan]
        pilih = max(berdaftar or anggota, key=lambda a: a.pertama_terlihat)
        pilih.pertama_terlihat = min(a.pertama_terlihat for a in anggota)
        pilih.versi = len({(a.waktu, a.lat, a.lon, a.magnitudo, a.kedalaman_km, a.dirasakan) for a in anggota})
        hasil.append(pilih)
    return sorted(hasil, key=lambda x: x.waktu)


def load(arsip_dir: Path, sampai: datetime | None = None) -> list[Gempa]:
    """Gempa dirasakan dari salinan arsip `bmkg-gempa/`; `sampai` memotong menurut waktu gempa.

    Feed autogempa juga memuat gempa M ≥ 5 yang tidak dirasakan (Dirasakan "-");
    dari feed itu hanya catatan yang punya daftar lokasi yang diambil."""
    catatan = []
    for feed in FEEDS:
        for berkas in sorted((arsip_dir / 'bmkg-gempa' / feed).rglob('*.json')):
            g = _dari_catatan(json.loads(berkas.read_text(encoding='utf-8')))
            if g is None or (sampai is not None and g.waktu >= sampai):
                continue
            if g.laporan or (feed == 'gempadirasakan' and g.dirasakan):
                catatan.append(g)
    return gabung_revisi(catatan)
