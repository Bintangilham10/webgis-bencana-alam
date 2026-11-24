"""Koordinat untuk nama lokasi di laporan gempa dirasakan BMKG.

Nama dicari di dua daftar tetap, jadi hasilnya bisa diulang tanpa layanan daring:
- 514 kab/kota Kepmendagri 2025 (recorder/data/wilayah.json);
- GeoNames Indonesia (https://download.geonames.org/export/dump/ID.zip, CC BY 4.0):
  ibu kota kab/kota, kecamatan, desa/kelurahan, permukiman, dan pulau.

Banyak nama dipakai lebih dari satu tempat. Urutan pemilihannya, per laporan:
1. hanya kandidat dalam jangkauan wajar dari episenter yang dipertimbangkan
   (makin besar dan makin dalam gempanya makin jauh, lihat jangkauan_km), dan
   kandidat yang jauh lebih jauh daripada kandidat terdekat disisihkan;
2. di antara yang tersisa, tingkat yang lebih tinggi menang: kab/kota, ibu kota
   kab/kota, kecamatan, desa, permukiman lain, pulau. BMKG hampir selalu menyebut
   wilayah administratif, bukan kampung;
3. bila beberapa tempat setingkat masih mungkin (dua kecamatan bernama sama),
   yang dipilih adalah yang paling dekat dengan lokasi lain di daftar yang sama
   (lokasi sebelum dan sesudahnya yang sudah pasti), karena BMKG menulis tempat
   yang berdekatan secara berurutan;
4. bila tidak ada lokasi lain yang bisa dijadikan petunjuk, yang terdekat ke
   episenter.

Kolom `kepastian` mencatat langkah mana yang menentukan, supaya analisis bisa
diulang hanya dengan lokasi yang tidak ambigu. Koreksi tangan ditaruh di
research/lokasi_manual.csv dan selalu didahulukan.

Nama kabupaten diberi koordinat ibu kotanya (dari GeoNames), karena guncangan
dilaporkan dari tempat berpenduduk; titik wakil poligonnya ikut disimpan.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import unicodedata
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import requests

from .http import USER_AGENT
from .paths import CACHE, ROOT

GEONAMES_URL = 'https://download.geonames.org/export/dump/ID.zip'
WILAYAH_JSON = ROOT.parent / 'recorder' / 'data' / 'wilayah.json'
MANUAL_CSV = ROOT / 'lokasi_manual.csv'

# Tingkat tempat: makin kecil makin diutamakan saat nama yang sama dipakai beberapa tempat.
T_KABKOTA, T_IBU_KOTA, T_KECAMATAN, T_DESA, T_PERMUKIMAN, T_PULAU = 0, 1, 2, 3, 4, 5
_TINGKAT_KODE = {'PPLC': T_IBU_KOTA, 'PPLA': T_IBU_KOTA, 'PPLA2': T_IBU_KOTA, 'ADM3': T_KECAMATAN, 'PPLA3': T_KECAMATAN,
                 'ADM4': T_DESA, 'PPLA4': T_DESA, 'ISL': T_PULAU, 'ISLS': T_PULAU}
_PRESISI = {T_IBU_KOTA: 'ibu kota', T_KECAMATAN: 'kecamatan', T_DESA: 'desa', T_PERMUKIMAN: 'permukiman', T_PULAU: 'pulau'}

# Kandidat sedekat ini dihitung sebagai satu tempat (kecamatan dan ibu kotanya, misalnya).
SATU_TEMPAT_KM = 25
# Keterangan wilayah ("Ulu Belu, Tanggamus") membatasi kandidat sejauh ini dari wilayah itu.
DEKAT_WILAYAH_KM = 120
# Lokasi lain di daftar yang sama hanya dipakai sebagai petunjuk bila ada kandidat sedekat ini.
KONTEKS_KM = 150
# Kandidat lebih jauh dari max(3 x jarak kandidat terdekat, jarak itu + 100 km) disisihkan.
JENDELA_KALI = 3
JENDELA_KM = 100
ARAH = {'utara', 'selatan', 'timur', 'barat', 'tengah'}

_AWALAN = re.compile(r'^(kabupaten|kab|kota|kecamatan|kec|kelurahan|kel|desa)\b\.?\s*', re.I)
_AWALAN_GEONAMES = re.compile(r'^(kecamatan|kelurahan|desa|kabupaten|kota administrasi|kota|provinsi|propinsi)\s+', re.I)
_AKHIRAN_GEONAMES = re.compile(r'\s+(regency|city|district|subdistrict|village)$', re.I)


def kunci(nama: str) -> str:
    """Bentuk pembanding nama: huruf kecil ASCII tanpa spasi dan tanda baca."""
    teks = unicodedata.normalize('NFKD', nama).encode('ascii', 'ignore').decode().lower()
    teks = re.sub(r'\bkep\b\.?', 'kepulauan', teks)
    return re.sub(r'[^a-z0-9]', '', teks)


def jarak_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(a))


def jangkauan_km(magnitudo: float, kedalaman_km: float = 10) -> float:
    """Jarak terjauh dari episenter yang masih wajar untuk tempat yang merasakan gempa.

    Dipakai hanya untuk memilih di antara tempat bernama sama, bukan sebagai model
    guncangan: 100 km sampai M 3,5, lalu dua kali lipat tiap naik satu magnitudo,
    1,5 kali lebih jauh untuk gempa berkedalaman 60 km atau lebih, paling jauh 1.200 km."""
    dasar = 100 * 2 ** max(0.0, magnitudo - 3.5)
    return min(1200.0, dasar * (1.5 if kedalaman_km >= 60 else 1.0))


def _selisih_huruf(a: str, b: str, batas: int) -> int:
    """Jarak sunting Levenshtein, berhenti lebih awal bila melebihi batas."""
    if abs(len(a) - len(b)) > batas:
        return batas + 1
    sebelumnya = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        baris = [i]
        for j, cb in enumerate(b, 1):
            baris.append(min(sebelumnya[j] + 1, baris[j - 1] + 1, sebelumnya[j - 1] + (ca != cb)))
        if min(baris) > batas:
            return batas + 1
        sebelumnya = baris
    return sebelumnya[-1]


@dataclass(frozen=True)
class Tempat:
    nama: str
    lat: float
    lon: float
    tingkat: int
    presisi: str
    sumber: str  # 'kepmendagri', 'geonames', atau 'manual'
    id: str  # kode Kepmendagri atau geonameid
    kode: str = ''  # kode fitur GeoNames, mis. PPLA3 atau ADM3
    lat_wakil: float | None = None  # titik wakil poligon (kab/kota)
    lon_wakil: float | None = None
    titik: str = ''  # asal koordinat kab/kota: ibu kota, tempat bernama sama, titik GeoNames, atau titik wakil

    def jarak_ke(self, lain: 'Tempat') -> float:
        """Jarak ke tempat lain; untuk kab/kota, yang terdekat dari ibu kota dan titik wakilnya."""
        jarak = jarak_km(self.lat, self.lon, lain.lat, lain.lon)
        if lain.lat_wakil is not None:
            jarak = min(jarak, jarak_km(self.lat, self.lon, lain.lat_wakil, lain.lon_wakil))
        return jarak


@dataclass(frozen=True)
class Hasil:
    tempat: Tempat | None
    kepastian: str  # tunggal, peringkat, keterangan, tetangga, terdekat, mirip, manual, tidak ketemu
    n_kandidat: int = 0
    jarak_km: float | None = None
    catatan: str = ''

    @property
    def perlu_tinjau(self) -> bool:
        return self.tempat is None or self.kepastian in ('terdekat', 'mirip') or bool(self.catatan)

    @property
    def jangkar(self) -> bool:
        """Cukup pasti untuk dijadikan petunjuk bagi lokasi lain di daftar yang sama."""
        return self.tempat is not None and not self.catatan and self.kepastian in ('tunggal', 'peringkat', 'keterangan', 'manual')


@dataclass
class _Calon:
    kandidat: list[tuple[float, Tempat]] = field(default_factory=list)  # (jarak episenter, tempat), terdekat dulu
    manual: Tempat | None = None
    kepastian: str | None = None
    catatan: list[str] = field(default_factory=list)


def unduh_geonames(izinkan_jaringan: bool = True) -> Path:
    """Berkas GeoNames Indonesia di cache; diunduh sekali bila belum ada."""
    berkas = CACHE / 'geonames' / 'ID.zip'
    if berkas.exists():
        return berkas
    if not izinkan_jaringan:
        raise FileNotFoundError(f'{berkas} belum ada; jalankan tanpa --tanpa-unduh sekali.')
    res = requests.get(GEONAMES_URL, headers={'User-Agent': USER_AGENT}, timeout=300)
    res.raise_for_status()
    berkas.parent.mkdir(parents=True, exist_ok=True)
    berkas.write_bytes(res.content)
    with (berkas.parent / '_manifest.jsonl').open('a', encoding='utf-8') as f:
        f.write(json.dumps({'file': berkas.name, 'url': GEONAMES_URL, 'status': res.status_code, 'bytes': len(res.content),
                            'sha256': hashlib.sha256(res.content).hexdigest(),
                            'fetched_at': datetime.now(timezone.utc).isoformat()}) + '\n')
    return berkas


def keterangan_geonames(berkas: Path) -> dict:
    """Tanggal isi dan sidik berkas GeoNames, untuk dicatat di keluaran."""
    with zipfile.ZipFile(berkas) as z:
        tanggal = '{:04d}-{:02d}-{:02d}'.format(*z.getinfo('ID.txt').date_time[:3])
    return {'tanggal': tanggal, 'sha256': hashlib.sha256(berkas.read_bytes()).hexdigest()}


def baca_geonames(berkas: Path) -> list[list[str]]:
    """Baris GeoNames yang dipakai: permukiman, wilayah administratif tingkat 2–4, dan pulau."""
    baris = []
    with zipfile.ZipFile(berkas) as z, z.open('ID.txt') as f:
        for line in io.TextIOWrapper(f, encoding='utf-8'):
            p = line.rstrip('\n').split('\t')
            if p[6] == 'P' or (p[6] == 'A' and p[7] in ('ADM2', 'ADM3', 'ADM4')) or (p[6] == 'T' and p[7] in ('ISL', 'ISLS')):
                baris.append(p)
    return baris


def _polos(p: list[str], nama: str) -> str:
    """Nama GeoNames tanpa awalan administratif ("Kecamatan Sumur" → "Sumur", "Pulau Romang" → "Romang")."""
    polos = _AKHIRAN_GEONAMES.sub('', _AWALAN_GEONAMES.sub('', nama))
    if p[6] == 'T':
        polos = re.sub(r'^(pulau|kepulauan)\s+', '', polos, flags=re.I)
    return polos


def _nama_geonames(p: list[str]) -> set[str]:
    """Kunci pembanding satu baris GeoNames: nama, nama ASCII, dan nama lain, dengan dan tanpa awalan."""
    kunci_nama = set()
    for nama in (p[1], p[2], *p[3].split(',')):
        if nama:
            kunci_nama.update(k for k in (kunci(nama), kunci(_polos(p, nama))) if k)
    return kunci_nama


def _jenis_adm2(p: list[str]) -> str | None:
    nama = [p[1], p[2], *p[3].split(',')]
    if any(re.match(r'kota\b', n, re.I) or re.search(r'\bcity$', n, re.I) for n in nama):
        return 'kota'
    if any(re.match(r'kabupaten\b', n, re.I) or re.search(r'\bregency$', n, re.I) for n in nama):
        return 'kabupaten'
    return None


class Gazetir:
    def __init__(self, wilayah: list[dict], geonames: list[list[str]], manual: dict | None = None):
        self.manual = manual or {}
        self.tempat: dict[str, list[Tempat]] = defaultdict(list)
        self.kabkota: dict[str, list[Tempat]] = defaultdict(list)
        self._petak: dict[tuple[int, int], list[tuple[str, Tempat]]] = defaultdict(list)

        adm2: dict[str, list[list[str]]] = defaultdict(list)
        ibu_kota: dict[tuple[str, str], list[list[str]]] = defaultdict(list)
        for p in geonames:
            kode = p[7]
            if kode == 'ADM2':
                for k in _nama_geonames(p):
                    adm2[k].append(p)
                continue
            if kode in ('PPLA2', 'PPLA', 'PPLC') and p[11]:
                ibu_kota[(p[10], p[11])].append(p)
            tingkat = _TINGKAT_KODE.get(kode, T_PERMUKIMAN)
            t = Tempat(nama=p[1], lat=float(p[4]), lon=float(p[5]), tingkat=tingkat, presisi=_PRESISI[tingkat],
                       sumber='geonames', id=p[0], kode=kode)
            for k in _nama_geonames(p):
                self.tempat[k].append(t)
            utama = kunci(_polos(p, p[1]))
            if utama:
                self._petak[(math.floor(t.lat), math.floor(t.lon))].append((utama, t))

        self.tanpa_ibu_kota: list[str] = []
        for w in wilayah:
            t = self._kabkota(w, adm2, ibu_kota)
            polos = re.sub(r'^(Kabupaten|Kota)( Administrasi)?\s+', '', w['nama'])
            for k in {kunci(polos), kunci(re.sub(r'^Kepulauan\s+', '', polos))}:
                self.kabkota[k].append(t)

    def _kabkota(self, w: dict, adm2: dict, ibu_kota: dict) -> Tempat:
        """Kab/kota dengan koordinat ibu kotanya bila GeoNames mengenalnya."""
        polos = re.sub(r'^(Kabupaten|Kota)( Administrasi)?\s+', '', w['nama'])
        lat, lon, titik = w['lat'], w['lon'], 'titik wakil'
        # Baris ADM2 GeoNames dengan nama dan jenis yang sama, terdekat ke titik wakil.
        calon = [p for p in adm2.get(kunci(polos), []) if _jenis_adm2(p) in (w['tingkat'], None)
                 and jarak_km(w['lat'], w['lon'], float(p[4]), float(p[5])) <= 150]
        kursi = None
        if calon:
            a = min(calon, key=lambda p: jarak_km(w['lat'], w['lon'], float(p[4]), float(p[5])))
            lat, lon, titik = float(a[4]), float(a[5]), 'titik GeoNames'
            kursi = ibu_kota.get((a[10], a[11]))
        if kursi:
            k = max(kursi, key=lambda p: int(p[14] or 0))
            lat, lon, titik = float(k[4]), float(k[5]), f'ibu kota ({k[1]})'
        else:
            # GeoNames tidak menandai ibu kotanya: pakai permukiman bernama sama di dekatnya.
            senama = [(t.tingkat, jarak_km(lat, lon, t.lat, t.lon), t) for t in self.tempat.get(kunci(polos), [])
                      if t.tingkat != T_PULAU and jarak_km(lat, lon, t.lat, t.lon) <= 80]
            if senama:
                s = min(senama, key=lambda x: x[:2])[2]
                lat, lon, titik = s.lat, s.lon, f'tempat bernama sama ({s.nama})'
            else:
                self.tanpa_ibu_kota.append(w['nama'])
        return Tempat(nama=w['nama'], lat=lat, lon=lon, tingkat=T_KABKOTA, presisi=w['tingkat'], sumber='kepmendagri',
                      id=w['kode'], kode='KABKOTA', lat_wakil=w['lat'], lon_wakil=w['lon'], titik=titik)

    @classmethod
    def muat(cls, izinkan_jaringan: bool = True) -> 'Gazetir':
        wilayah = json.loads(WILAYAH_JSON.read_text(encoding='utf-8'))
        return cls(wilayah, baca_geonames(unduh_geonames(izinkan_jaringan)), baca_manual(MANUAL_CSV))

    # --- kandidat --------------------------------------------------------------

    def _wilayah(self, teks: str | None) -> list[Tempat]:
        """Kab/kota yang dimaksud sebuah keterangan, mis. "Tanggamus" atau "Kep. Selayar"."""
        if not teks:
            return []
        return self.kabkota.get(kunci(_AWALAN.sub('', teks.strip())), [])

    def _senama(self, nama: str) -> tuple[list[Tempat], bool]:
        """Tempat bernama persis `nama`; nilai kedua True bila awalannya menuntut kabupaten."""
        cocok = _AWALAN.match(nama)
        awalan = cocok.group(1).lower() if cocok else None
        inti = nama[cocok.end():] if cocok else nama
        kab = self.kabkota.get(kunci(inti), [])
        lain = self.tempat.get(kunci(inti), [])
        if awalan in ('kab', 'kabupaten'):
            return [t for t in kab if t.presisi == 'kabupaten'] or kab, True
        if awalan == 'kota':
            kota = [t for t in kab if t.presisi == 'kota']
            if kota:
                return kota, False
            # "Kota Agung" adalah nama tempat; "Kota Cianjur" berarti ibu kota Kabupaten Cianjur.
            penuh = self.tempat.get(kunci(nama), [])
            if penuh:
                return penuh, False
            kursi = [Tempat(nama=t.titik[t.titik.index('(') + 1:-1], lat=t.lat, lon=t.lon, tingkat=T_IBU_KOTA, presisi='ibu kota',
                            sumber=t.sumber, id=t.id, kode='PPLA2', titik=t.titik) for t in kab if '(' in t.titik]
            return kursi or lain or kab, False
        if awalan in ('kec', 'kecamatan'):
            return [t for t in lain if t.tingkat == T_KECAMATAN] or lain, False
        if awalan in ('kel', 'kelurahan', 'desa'):
            return [t for t in lain if t.tingkat == T_DESA] or lain, False
        # Nama polos yang dipakai kota dan kabupaten sekaligus: kotanya yang dimaksud.
        return ([t for t in kab if t.presisi == 'kota'] or kab) + lain, False

    def _mirip(self, nama: str, lat: float, lon: float, radius: float, hanya_kab: bool) -> list[Tempat]:
        """Tempat yang namanya berbeda satu huruf (dua untuk nama panjang) dari `nama`."""
        k = kunci(_AWALAN.sub('', nama))
        if len(k) < 4:
            return []
        batas = 2 if len(k) >= 10 else 1
        hasil = [t for kab, daftar in self.kabkota.items() if _selisih_huruf(k, kab, batas) <= batas for t in daftar]
        if hanya_kab or len(k) < 5:
            return hasil
        langkah = int(radius // 111) + 1
        for i in range(math.floor(lat) - langkah, math.floor(lat) + langkah + 1):
            for j in range(math.floor(lon) - langkah, math.floor(lon) + langkah + 1):
                hasil += [t for tempat, t in self._petak.get((i, j), ()) if _selisih_huruf(k, tempat, batas) <= batas]
        return hasil

    def _memuat(self, inti: str, wilayah: list[Tempat]) -> list[Tempat]:
        """Tempat di sekitar `wilayah` yang namanya memuat `inti` ("Jampea" → "Bentengjampea")."""
        k = kunci(inti)
        if len(k) < 5:
            return []
        hasil = []
        for w in wilayah:
            for i in range(math.floor(w.lat) - 2, math.floor(w.lat) + 3):
                for j in range(math.floor(w.lon) - 2, math.floor(w.lon) + 3):
                    hasil += [t for tempat, t in self._petak.get((i, j), ()) if k in tempat and t.jarak_ke(w) <= DEKAT_WILAYAH_KM]
        return hasil

    def _calon(self, nama: str, keterangan: str | None, lat: float, lon: float, radius: float) -> _Calon:
        c = _Calon(manual=self.manual.get((kunci(nama), kunci(keterangan or ''))))
        if c.manual:
            return c
        batas_wilayah = self._wilayah(keterangan)
        kandidat, hanya_kab = self._senama(nama)
        kata = _AWALAN.sub('', nama).split()
        if not kandidat and not hanya_kab and len(kata) > 1:
            # "Benteng Selayar", "Bungku Morowali": kata belakang menyebut wilayahnya.
            for potong in range(1, len(kata)):
                wilayah = self._wilayah(' '.join(kata[potong:]))
                if not wilayah:
                    continue
                depan = ' '.join(kata[:potong])
                kandidat, batas_wilayah = self._senama(depan)[0], wilayah
                if not kandidat:
                    kandidat = self._memuat(depan, wilayah)
                    c.kepastian = 'mirip' if kandidat else None
                break
        if not kandidat and not hanya_kab and len(kata) > 1 and kata[-1].lower() in ARAH:
            # "Karawang Selatan" tanpa kecamatan bernama itu: bagian selatan Karawang.
            kandidat = self.kabkota.get(kunci(' '.join(kata[:-1])), [])
            if kandidat:
                c.catatan.append(f'bagian {kata[-1].lower()} wilayah ini; koordinat mewakili seluruh wilayah')
        if not kandidat:
            kandidat = self._mirip(nama, lat, lon, radius, hanya_kab)
            if kandidat:
                c.kepastian = 'mirip'
        if kandidat and batas_wilayah:
            dekat = [t for t in kandidat if t.tingkat != T_KABKOTA and any(t.jarak_ke(w) <= DEKAT_WILAYAH_KM for w in batas_wilayah)]
            # "Benteng Selayar": bila salah satu kandidat adalah ibu kota wilayah itu, itulah yang dimaksud.
            kursi = [t for t in dekat if any(jarak_km(t.lat, t.lon, w.lat, w.lon) <= 10 for w in batas_wilayah)]
            if dekat:
                kandidat = kursi or dekat
                c.kepastian = c.kepastian or 'keterangan'
            else:
                c.catatan.append('keterangan wilayah tidak cocok dengan kandidat mana pun')
        c.kandidat = sorted(((jarak_km(lat, lon, t.lat, t.lon), t) for t in kandidat), key=lambda x: x[0])
        return c

    # --- pemilihan -------------------------------------------------------------

    @staticmethod
    def _kelompok(tempat: list[tuple[float, Tempat]]) -> int:
        """Jumlah tempat berbeda: kandidat yang berdekatan dihitung satu."""
        wakil: list[Tempat] = []
        for _, t in tempat:
            if all(jarak_km(t.lat, t.lon, w.lat, w.lon) > SATU_TEMPAT_KM for w in wakil):
                wakil.append(t)
        return len(wakil)

    @staticmethod
    def _wakil(pilih: Tempat, setingkat: list[tuple[float, Tempat]]) -> tuple[float, Tempat]:
        """Baris yang mewakili satu tempat, selalu sama dari gempa ke gempa: titik
        permukimannya dulu, baru titik wilayah administratifnya."""
        satu = [x for x in setingkat if jarak_km(x[1].lat, x[1].lon, pilih.lat, pilih.lon) <= SATU_TEMPAT_KM]
        return min(satu, key=lambda x: (x[1].kode.startswith('ADM'), int(x[1].id) if x[1].id.isdigit() else 0))

    def _pilih(self, c: _Calon, lat: float, lon: float, radius: float, jangkar: list[Tempat] | None) -> Hasil | None:
        """Tempat untuk satu nama. `jangkar` None = putaran pertama: mengembalikan None
        bila beberapa tempat setingkat masih mungkin, untuk diputuskan dengan lokasi lain."""
        if c.manual:
            return Hasil(c.manual, 'manual', 1, jarak_km(lat, lon, c.manual.lat, c.manual.lon))
        catatan = '; '.join(c.catatan)
        if not c.kandidat:
            return Hasil(None, 'tidak ketemu', catatan=catatan)
        dalam = [x for x in c.kandidat if x[0] <= radius]
        if not dalam:
            jarak, t = c.kandidat[0]
            n = self._kelompok(c.kandidat)
            catatan = '; '.join([*c.catatan, f'di luar jangkauan wajar {radius:.0f} km'])
            return Hasil(t, c.kepastian or ('tunggal' if n == 1 else 'terdekat'), n, jarak, catatan)
        n = self._kelompok(dalam)
        jendela = [x for x in dalam if x[0] <= max(JENDELA_KALI * dalam[0][0], dalam[0][0] + JENDELA_KM)]
        terbaik = min(t.tingkat for _, t in jendela)
        setingkat = [x for x in jendela if x[1].tingkat == terbaik]
        if self._kelompok(setingkat) == 1:
            jarak, t = self._wakil(setingkat[0][1], setingkat)
            return Hasil(t, c.kepastian or ('tunggal' if n == 1 else 'peringkat'), n, jarak, catatan)
        if jangkar is None:
            return None
        if jangkar:
            konteks, t = min(((min(t.jarak_ke(j) for j in jangkar), t) for _, t in setingkat), key=lambda x: x[0])
            if konteks <= KONTEKS_KM:
                jarak, t = self._wakil(t, setingkat)
                return Hasil(t, c.kepastian or 'tetangga', n, jarak, catatan)
        jarak, t = self._wakil(setingkat[0][1], setingkat)
        return Hasil(t, c.kepastian or 'terdekat', n, jarak, catatan)

    def cari_semua(self, laporan: list[tuple[str, str | None]], lat: float, lon: float, magnitudo: float,
                   kedalaman_km: float = 10) -> list[Hasil]:
        """Tempat untuk tiap (nama, keterangan) di satu daftar gempa berepisenter (lat, lon)."""
        radius = jangkauan_km(magnitudo, kedalaman_km)
        calon = [self._calon(nama, keterangan, lat, lon, radius) for nama, keterangan in laporan]
        hasil: list[Hasil | None] = [self._pilih(c, lat, lon, radius, None) for c in calon]
        pasti = [i for i, h in enumerate(hasil) if h is not None and h.jangkar]
        for i, h in enumerate(hasil):
            if h is None:
                sebelum = [j for j in pasti if j < i][-1:]
                sesudah = [j for j in pasti if j > i][:1]
                hasil[i] = self._pilih(calon[i], lat, lon, radius, [hasil[j].tempat for j in sebelum + sesudah])
        return hasil

    def cari(self, nama: str, keterangan: str | None, lat: float, lon: float, magnitudo: float,
             kedalaman_km: float = 10) -> Hasil:
        """Tempat untuk satu nama, tanpa petunjuk dari lokasi lain."""
        return self.cari_semua([(nama, keterangan)], lat, lon, magnitudo, kedalaman_km)[0]


def baca_manual(berkas: Path) -> dict:
    """Koreksi tangan: (kunci nama, kunci keterangan) → Tempat."""
    if not berkas.exists():
        return {}
    manual = {}
    with berkas.open(encoding='utf-8', newline='') as f:
        for baris in csv.DictReader(f):
            if not (baris.get('nama') or '').strip():
                continue
            t = Tempat(nama=(baris.get('tempat') or '').strip() or baris['nama'], lat=float(baris['lat']), lon=float(baris['lon']),
                       tingkat=T_PERMUKIMAN, presisi=(baris.get('presisi') or '').strip() or 'manual', sumber='manual', id='')
            manual[(kunci(baris['nama']), kunci(baris.get('keterangan') or ''))] = t
    return manual
