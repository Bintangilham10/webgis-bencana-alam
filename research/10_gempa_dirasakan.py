"""Himpunan data gempa dirasakan BMKG dengan koordinat tiap lokasi laporan.

BMKG menerbitkan intensitas yang dirasakan sebagai teks per gempa (feed
gempadirasakan dan autogempa). Feed itu hanya memuat 15 gempa terakhir, jadi
riwayatnya diambil dari arsip perekam SIGAP, yang menyimpan tiap versi sejak
21 Sep 2026. Skrip ini menyusun satu baris per gempa dan satu baris per lokasi
yang melaporkan, lalu memberi koordinat pada tiap nama lokasi
(sigap_riset/geokode.py menjelaskan aturannya).

Masukan:
- branch arsip-data, folder bmkg-gempa/ (disalin ke data/arsip/);
- recorder/data/wilayah.json (514 kab/kota);
- GeoNames Indonesia, diunduh sekali ke data/cache/geonames/ID.zip;
- lokasi_manual.csv (koreksi tangan, boleh kosong).

Keluaran:
- data/gempa/bmkg_kejadian.csv         satu baris per gempa
- data/gempa/bmkg_laporan.csv          satu baris per lokasi yang melaporkan
- data/gempa/bmkg_meta.json            commit arsip dan batas waktu himpunan ini
- results/gempa_dirasakan_lokasi.csv   nama lokasi → tempat yang dipilih, untuk ditinjau
- results/gempa_dirasakan_ringkasan.md

Jalankan dari root repo:
  research/.venv/Scripts/python research/10_gempa_dirasakan.py
  research/.venv/Scripts/python research/10_gempa_dirasakan.py --tanpa-unduh         # tanpa jaringan
  research/.venv/Scripts/python research/10_gempa_dirasakan.py --sampai 2026-12-01 --commit <hash>   # himpunan beku

Himpunan beku untuk makalah: `--sampai` memotong menurut waktu gempa dan `--commit`
memakai arsip pada commit yang dicatat di ringkasan, jadi hasilnya bisa diulang persis.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from datetime import datetime, timezone

import pandas as pd

from sigap_riset import arsip, dirasakan, geokode
from sigap_riset.geo import haversine_km
from sigap_riset.paths import DATA, RESULTS

OUT = DATA / 'gempa'
ROMAWI = {v: k for k, v in dirasakan.ROMAN.items()}


TANPA_TEMPAT = {'lat': None, 'lon': None, 'presisi': '', 'nama_cocok': '', 'sumber': '', 'id_sumber': '', 'titik': '',
                'lat_wakil': None, 'lon_wakil': None, 'jarak_episenter_km': None, 'jarak_hiposenter_km': None}


def kolom_tempat(h: geokode.Hasil, kedalaman_km: float) -> dict:
    """Kolom koordinat satu laporan; kosong bila tempatnya tidak ketemu."""
    t = h.tempat
    if t is None:
        return dict(TANPA_TEMPAT)
    return {'lat': t.lat, 'lon': t.lon, 'presisi': t.presisi, 'nama_cocok': t.nama, 'sumber': t.sumber, 'id_sumber': t.id,
            'titik': t.titik, 'lat_wakil': t.lat_wakil, 'lon_wakil': t.lon_wakil,
            'jarak_episenter_km': round(h.jarak_km, 1), 'jarak_hiposenter_km': round(math.hypot(h.jarak_km, kedalaman_km), 1)}


def utc(waktu: datetime) -> str:
    return waktu.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def susun(gempa: list[dirasakan.Gempa], gazetir: geokode.Gazetir) -> tuple[pd.DataFrame, pd.DataFrame]:
    kejadian, laporan = [], []
    for g in gempa:
        hasil = gazetir.cari_semua([(lap.nama, lap.keterangan) for lap in g.laporan], g.lat, g.lon, g.magnitudo, g.kedalaman_km)
        for urutan, (lap, h) in enumerate(zip(g.laporan, hasil), 1):
            laporan.append({
                'gempa_id': g.id, 'urutan': urutan, 'nama': lap.nama, 'keterangan': lap.keterangan or '',
                'mmi_min': lap.mmi_min, 'mmi_maks': lap.mmi_maks, **kolom_tempat(h, g.kedalaman_km),
                'kepastian': h.kepastian, 'n_kandidat': h.n_kandidat, 'perlu_tinjau': h.perlu_tinjau, 'catatan': h.catatan,
            })
        kejadian.append({
            'id': g.id, 'waktu_utc': utc(g.waktu), 'lat': g.lat, 'lon': g.lon, 'kedalaman_km': g.kedalaman_km,
            'magnitudo': g.magnitudo, 'wilayah': g.wilayah, 'dirasakan': g.dirasakan, 'n_laporan': len(g.laporan),
            'n_berkoordinat': sum(h.tempat is not None for h in hasil),
            'mmi_maks': max((lap.mmi_maks for lap in g.laporan), default=None),
            'pertama_terlihat_utc': utc(g.pertama_terlihat), 'versi': g.versi, 'feed': g.feed,
        })
    return pd.DataFrame(kejadian), pd.DataFrame(laporan)


def tabel_lokasi(laporan: pd.DataFrame) -> pd.DataFrame:
    """Satu baris per (nama, keterangan, tempat terpilih): bahan tinjauan penulis."""
    kunci = ['nama', 'keterangan', 'nama_cocok', 'presisi', 'lat', 'lon', 'sumber', 'id_sumber', 'titik']
    grup = laporan.groupby(kunci, dropna=False)
    lokasi = grup.agg(
        n_laporan=('gempa_id', 'size'),
        kepastian=('kepastian', lambda s: ', '.join(sorted(set(s)))),
        n_kandidat_maks=('n_kandidat', 'max'),
        jarak_min_km=('jarak_episenter_km', 'min'),
        jarak_maks_km=('jarak_episenter_km', 'max'),
        perlu_tinjau=('perlu_tinjau', 'any'),
        catatan=('catatan', lambda s: '; '.join(sorted({c for c in s if c}))),
    ).reset_index()
    return lokasi.sort_values(['perlu_tinjau', 'nama', 'keterangan'], ascending=[False, True, True])


def baris_tabel(pasangan) -> str:
    return '\n'.join(f'| {a} | {b} |' for a, b in pasangan)


def ringkasan(kejadian: pd.DataFrame, laporan: pd.DataFrame, lokasi: pd.DataFrame, info: arsip.Arsip,
              geonames: dict, gazetir: geokode.Gazetir, sampai: datetime | None) -> str:
    berdaftar = kejadian[kejadian['n_laporan'] > 0]
    ada = laporan[laporan['lat'].notna()]
    jarak = ada['jarak_episenter_km']
    kelas_m = pd.cut(berdaftar['magnitudo'], [0, 3, 4, 5, 6, 10], right=False, labels=['< 3', '3–3,9', '4–4,9', '5–5,9', '≥ 6'])
    tinjau = lokasi[lokasi['perlu_tinjau']]
    persen = lambda n, total: f'{n} ({100 * n / total:.1f}%)' if total else '0'  # noqa: E731
    urut_presisi = ['kota', 'kabupaten', 'ibu kota', 'kecamatan', 'desa', 'permukiman', 'pulau', 'manual']
    presisi = Counter(ada['presisi'])
    kepastian = Counter(laporan['kepastian'])
    # Seberapa jauh ibu kota dari titik wakil poligon, untuk kab/kota yang muncul di laporan.
    kab = ada[ada['lat_wakil'].notna()].drop_duplicates('nama_cocok')
    selisih = pd.Series(haversine_km(kab['lat'], kab['lon'], kab['lat_wakil'], kab['lon_wakil']).to_numpy(), index=kab['nama_cocok'])
    teks = f"""# Gempa dirasakan BMKG: himpunan data dan koordinat lokasi laporan

Dibuat oleh `10_gempa_dirasakan.py`. Angka di bawah berubah setiap arsip bertambah; untuk himpunan beku pakai `--sampai`.

## Sumber dan versi

| Hal | Nilai |
|---|---|
| Arsip perekam | commit `{info.commit[:12]}` ({info.waktu}) |
| Batas waktu gempa | {f'sebelum {sampai:%Y-%m-%d} UTC' if sampai else 'tanpa batas'} |
| Rentang gempa | {kejadian['waktu_utc'].min()} sampai {kejadian['waktu_utc'].max()} |
| GeoNames Indonesia | isi bertanggal {geonames['tanggal']}, sha256 `{geonames['sha256'][:16]}` |
| Kab/kota tanpa ibu kota di GeoNames | {len(gazetir.tanpa_ibu_kota)} dari 514 (dipakai titik GeoNames atau titik wakil poligon) |

## Jumlah

| Hal | Nilai |
|---|---|
| Gempa dirasakan | {len(kejadian)} |
| Gempa dengan daftar lokasi | {len(berdaftar)} |
| Laporan lokasi | {len(laporan)} |
| Laporan berkoordinat | {persen(len(ada), len(laporan))} |
| Nama lokasi berbeda | {laporan['nama'].nunique()} |
| Gempa dengan lebih dari satu versi di arsip | {int((kejadian['versi'] > 1).sum())} |

Gempa menurut magnitudo (yang punya daftar lokasi):

| Magnitudo | Gempa |
|---|---|
{baris_tabel((k, int(v)) for k, v in kelas_m.value_counts().sort_index().items())}

Gempa menurut intensitas tertinggi yang dilaporkan (MMI):

| MMI tertinggi | Gempa |
|---|---|
{baris_tabel((ROMAWI[int(k)], int(v)) for k, v in berdaftar['mmi_maks'].value_counts().sort_index().items())}

Laporan menurut intensitas (batas atas rentang):

| MMI | Laporan |
|---|---|
{baris_tabel((ROMAWI[int(k)], int(v)) for k, v in laporan['mmi_maks'].value_counts().sort_index().items())}

## Koordinat lokasi

Laporan berkoordinat menurut tingkat tempat:

| Tingkat | Laporan |
|---|---|
{baris_tabel((p, presisi[p]) for p in urut_presisi if presisi.get(p))}

Laporan menurut cara tempatnya ditentukan:

| Cara | Arti | Laporan |
|---|---|---|
| tunggal | hanya satu tempat bernama itu dalam jangkauan wajar | {kepastian.get('tunggal', 0)} |
| peringkat | beberapa tempat, satu yang tingkatnya paling tinggi | {kepastian.get('peringkat', 0)} |
| keterangan | dibatasi keterangan wilayah di teks BMKG | {kepastian.get('keterangan', 0)} |
| tetangga | beberapa tempat setingkat, dipilih yang terdekat ke lokasi lain di daftar yang sama | {kepastian.get('tetangga', 0)} |
| terdekat | beberapa tempat setingkat, dipilih yang terdekat ke episenter | {kepastian.get('terdekat', 0)} |
| mirip | ejaan berbeda satu atau dua huruf | {kepastian.get('mirip', 0)} |
| manual | dari lokasi_manual.csv | {kepastian.get('manual', 0)} |
| tidak ketemu | belum berkoordinat | {kepastian.get('tidak ketemu', 0)} |

Jarak episenter ke lokasi laporan: median {jarak.median():.0f} km, persentil ke-90 {jarak.quantile(0.9):.0f} km, terjauh {jarak.max():.0f} km.

Untuk {len(kab)} kab/kota yang muncul di laporan, koordinat yang dipakai (ibu kota) berjarak median {selisih.median():.0f} km dari titik wakil poligonnya, terjauh {selisih.max():.0f} km ({selisih.idxmax()}). Sebesar itulah ketidakpastian lokasi laporan bertingkat kab/kota.

## Yang perlu ditinjau penulis

{len(tinjau)} dari {len(lokasi)} baris di `gempa_dirasakan_lokasi.csv` ditandai `perlu_tinjau` ({int(laporan['perlu_tinjau'].sum())} laporan). Periksa tiap baris di peta; bila pilihannya salah, isi `research/lokasi_manual.csv` (kolom `nama`, `keterangan`, `tempat`, `lat`, `lon`, `presisi`, `catatan`) lalu jalankan ulang skrip ini.

| Nama di laporan | Keterangan | Tempat terpilih | Tingkat | Cara | Laporan | Catatan |
|---|---|---|---|---|---|---|
{chr(10).join(f"| {r.nama} | {r.keterangan} | {r.nama_cocok or '—'} | {r.presisi or '—'} | {r.kepastian} | {r.n_laporan} | {r.catatan} |" for r in tinjau.itertuples())}

## Batasan data

- Daftar BMKG hanya memuat tempat yang melaporkan merasakan gempa. Tempat yang tidak disebut belum tentu tidak merasakan, jadi data ini tidak bisa dipakai langsung untuk menghitung peringatan yang salah sasaran.
- Laporan bertingkat kabupaten diberi koordinat ibu kota kabupaten; guncangan bisa saja dirasakan di bagian lain kabupaten itu. Titik wakil poligon ada di kolom `lat_wakil` dan `lon_wakil` untuk uji kepekaan.
- Perekam mulai berjalan 25 Sep 2026 (feed saat itu memuat gempa sejak 21 Sep) dan baru tiap 15 menit sejak 27 Sep 2026 13.45 UTC, jadi gempa sebelum itu bisa terlewat.
- Koordinat tempat berasal dari GeoNames (CC BY 4.0) dan dipilih oleh aturan di `sigap_riset/geokode.py`; belum diverifikasi satu per satu.
"""
    return teks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--sampai', help='hanya gempa sebelum tanggal ini (UTC), YYYY-MM-DD')
    parser.add_argument('--commit', help='hash commit arsip yang dipakai (bawaan: yang terbaru)')
    parser.add_argument('--tanpa-unduh', action='store_true', help='tanpa jaringan: pakai arsip dan GeoNames yang sudah diambil')
    args = parser.parse_args()
    sampai = datetime.strptime(args.sampai, '%Y-%m-%d').replace(tzinfo=timezone.utc) if args.sampai else None

    info = arsip.extract('bmkg-gempa', fetch=not args.tanpa_unduh, commit=args.commit)
    gazetir = geokode.Gazetir.muat(izinkan_jaringan=not args.tanpa_unduh)
    gempa = dirasakan.load(arsip.ARCHIVE_DIR, sampai)
    kejadian, laporan = susun(gempa, gazetir)
    lokasi = tabel_lokasi(laporan)

    OUT.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)
    kejadian.to_csv(OUT / 'bmkg_kejadian.csv', index=False)
    laporan.to_csv(OUT / 'bmkg_laporan.csv', index=False)
    # Asal himpunan ini, dibaca 12_evaluasi_gempa.py supaya hasilnya bisa dilacak ke arsipnya.
    asal = {'arsip_commit': info.commit, 'arsip_waktu': info.waktu, 'sampai': args.sampai, 'dibuat_utc': utc(datetime.now(timezone.utc))}
    (OUT / 'bmkg_meta.json').write_text(json.dumps(asal, indent=2) + '\n', encoding='utf-8', newline='\n')
    lokasi.to_csv(RESULTS / 'gempa_dirasakan_lokasi.csv', index=False)
    teks = ringkasan(kejadian, laporan, lokasi, info, geokode.keterangan_geonames(geokode.unduh_geonames(False)), gazetir, sampai)
    (RESULTS / 'gempa_dirasakan_ringkasan.md').write_text(teks, encoding='utf-8', newline='\n')
    print(f'{len(kejadian)} gempa, {len(laporan)} laporan lokasi, {int(laporan["lat"].notna().sum())} berkoordinat, '
          f'{int(laporan["perlu_tinjau"].sum())} perlu ditinjau')
    print(f'Tulis: {OUT / "bmkg_kejadian.csv"}, {OUT / "bmkg_laporan.csv"}, {RESULTS / "gempa_dirasakan_lokasi.csv"}, '
          f'{RESULTS / "gempa_dirasakan_ringkasan.md"}')


if __name__ == '__main__':
    main()
