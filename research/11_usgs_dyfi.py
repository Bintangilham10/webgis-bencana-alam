"""Laporan guncangan USGS "Did You Feel It?" untuk gempa kuat di wilayah Indonesia.

Arsip BMKG milik SIGAP baru dimulai 21 Sep 2026 dan hampir semua laporannya
berintensitas II–IV. Untuk gempa kuat dan intensitas tinggi dipakai data USGS:
gempa M ≥ 5 sejak 2010 di wilayah yang sama dengan aplikasi, yang punya
sedikitnya 10 respons DYFI. Tiap gempa memberi intensitas per kotak 10 km
beserta jumlah responsnya.

Masukan: katalog FDSN USGS dan produk DYFI tiap gempa (cache di data/cache/usgs/;
±2 permintaan per gempa, satu per detik).

Keluaran:
- data/gempa/usgs_kejadian.csv      satu baris per gempa
- data/gempa/usgs_dyfi.csv          satu baris per kotak 10 km yang punya responden
                                    (per kota untuk gempa lama tanpa berkas kotak)
- results/gempa_usgs_ringkasan.md

Jalankan dari root repo:
  research/.venv/Scripts/python research/11_usgs_dyfi.py --sampai 2026-11-24

`--sampai` wajib ditulis supaya kueri katalognya tetap sama saat diulang (jawaban
yang sudah di-cache dipakai lagi).
"""

from __future__ import annotations

import argparse
import json
import math

import pandas as pd

from sigap_riset import usgs
from sigap_riset.geo import haversine_km
from sigap_riset.http import Client
from sigap_riset.paths import DATA, RESULTS

OUT = DATA / 'gempa'


def laporan_gempa(client: Client, kejadian: dict, detail_url: str) -> list[dict] | None:
    """Kotak DYFI satu gempa; None bila USGS tidak punya berkasnya."""
    detail = client.json(detail_url)
    if detail is None:
        return None
    url_kotak, url_geo, url_kota = usgs.berkas_dyfi(detail)
    berjudul = lambda isi: isi.lstrip().startswith('#')  # noqa: E731
    baris, satuan = None, 'kotak 10 km'
    if url_kotak:
        teks = client.text(url_kotak, valid=berjudul)
        baris = usgs.baca_cdi_geo(teks) if teks is not None else None
    if baris is None and url_geo:
        geo = client.json(url_geo)
        baris = usgs.baca_geojson(geo) if geo is not None else None
    if baris is None and url_kota:
        teks = client.text(url_kota, valid=berjudul)
        baris, satuan = (usgs.baca_cdi_geo(teks), 'kota') if teks is not None else (None, satuan)
    if baris is None:
        return None
    # Baris berkoordinat (0, 0) adalah respons yang tidak berhasil dipetakan USGS.
    baris = [b for b in baris if (b['lat'], b['lon']) != (0.0, 0.0)]
    for b in baris:
        episenter = float(haversine_km(kejadian['lat'], kejadian['lon'], b['lat'], b['lon']))
        b.update({'gempa_id': kejadian['id'], 'satuan': satuan, 'jarak_episenter_km': round(episenter, 1),
                  'jarak_hiposenter_km': round(math.hypot(episenter, kejadian['kedalaman_km']), 1)})
    return baris


def tabel(pasangan) -> str:
    return '\n'.join(f'| {a} | {b} |' for a, b in pasangan)


def ringkasan(kejadian: pd.DataFrame, dyfi: pd.DataFrame, tanpa_berkas: list[str], url: str, args, permintaan: int) -> str:
    kelas_m = pd.cut(kejadian['magnitudo'], [0, 5.5, 6, 6.5, 7, 10], right=False, labels=['5–5,4', '5,5–5,9', '6–6,4', '6,5–6,9', '≥ 7'])
    kelas_n = pd.cut(dyfi['n_respons'], [0, 2, 3, 10, 10**9], right=False, labels=['1', '2', '3–9', '≥ 10'])
    tahun = kejadian['waktu_utc'].str[:4].value_counts().sort_index()
    mantap = dyfi[(dyfi['n_respons'] >= 3) & ~dyfi['meragukan']]
    # CDI berdesimal dibulatkan ke kelas MMI terdekat (2,5 sampai < 3,5 = III, dan seterusnya).
    batas_cdi, label_cdi = [0, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 13], ['≤ II', 'III', 'IV', 'V', 'VI', 'VII', '≥ VIII']
    cdi_semua = pd.cut(dyfi['cdi'], batas_cdi, right=False, labels=label_cdi).value_counts()
    cdi_mantap = pd.cut(mantap['cdi'], batas_cdi, right=False, labels=label_cdi).value_counts()
    baris_cdi = '\n'.join(f'| {k} | {int(cdi_semua.get(k, 0))} | {int(cdi_mantap.get(k, 0))} |' for k in label_cdi)
    return f"""# Gempa kuat di wilayah Indonesia: laporan guncangan USGS (DYFI)

Dibuat oleh `11_usgs_dyfi.py`.

## Sumber dan versi

| Hal | Nilai |
|---|---|
| Kueri katalog | <{url}> |
| Syarat | M ≥ {args.mag_min:g}, sedikitnya {args.felt_min} respons DYFI, {args.dari} sampai {args.sampai} |
| Wilayah | lintang {usgs.REGION['south']}° sampai {usgs.REGION['north']}°, bujur {usgs.REGION['west']}° sampai {usgs.REGION['east']}° (sama dengan aplikasi) |
| Permintaan ke USGS pada jalan ini | {permintaan} (sisanya dari cache `data/cache/usgs/`, waktu ambil di `_manifest.jsonl`) |

## Jumlah

| Hal | Nilai |
|---|---|
| Gempa | {len(kejadian)} |
| Gempa tanpa berkas DYFI yang terbaca | {len(tanpa_berkas)}{' (' + ', '.join(tanpa_berkas) + ')' if tanpa_berkas else ''} |
| Baris laporan (kotak 10 km, atau kota pada {int(dyfi.loc[dyfi['satuan'] == 'kota', 'gempa_id'].nunique())} gempa lama) | {len(dyfi)} |
| Baris dengan ≥ 3 respons dan tidak ditandai meragukan | {len(mantap)} |
| Baris dengan CDI 1 (responden tidak merasakan) | {int((dyfi['cdi'] < 1.5).sum())} |
| Total respons | {int(dyfi['n_respons'].sum())} |
| Gempa yang juga punya ShakeMap | {int(kejadian['ada_shakemap'].sum())} |

Gempa menurut magnitudo:

| Magnitudo | Gempa |
|---|---|
{tabel((k, int(v)) for k, v in kelas_m.value_counts().sort_index().items())}

Gempa menurut tahun:

| Tahun | Gempa |
|---|---|
{tabel((k, int(v)) for k, v in tahun.items())}

Kotak menurut intensitas (CDI dibulatkan ke kelas MMI):

| Intensitas | Semua kotak | Kotak ≥ 3 respons dan tidak meragukan |
|---|---|---|
{baris_cdi}

Kotak menurut jumlah respons:

| Respons | Kotak |
|---|---|
{tabel((k, int(v)) for k, v in kelas_n.value_counts().sort_index().items())}

Jarak episenter ke kotak: median {dyfi['jarak_episenter_km'].median():.0f} km, persentil ke-90 {dyfi['jarak_episenter_km'].quantile(0.9):.0f} km, terjauh {dyfi['jarak_episenter_km'].max():.0f} km.

Gempa menurut negara di nama tempat USGS (kosong = di laut tanpa nama negara):

| Negara | Gempa |
|---|---|
{tabel((k or '(tanpa nama negara)', int(v)) for k, v in kejadian['negara'].value_counts().items())}

## Batasan data

- Laporan DYFI datang dari warga yang mengisi kuesioner daring, jadi lebih banyak dari kota besar dan dari pengguna internet. Kotak dengan satu atau dua respons tidak stabil.
- CDI sebanding dengan MMI tetapi berdesimal dan diturunkan dari kuesioner, sedangkan daftar BMKG berupa rentang MMI dari pengamatan petugas. Menggabungkan keduanya perlu diuji dulu pada gempa yang ada di kedua sumber.
- Hanya kotak yang punya responden yang muncul. Kotak tanpa responden belum tentu tidak merasakan, tetapi CDI 1 memang berarti respondennya tidak merasakan.
- Sebagian respons datang dari sangat jauh (lebih dari 1.500 km); analisis perlu menetapkan batas jarak.
- Wilayah kueri berbentuk kotak, jadi memuat juga gempa di negara tetangga (kolom `negara`).
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--dari', default='2010-01-01', help='tanggal awal (UTC), YYYY-MM-DD')
    parser.add_argument('--sampai', required=True, help='tanggal akhir (UTC), YYYY-MM-DD')
    parser.add_argument('--mag-min', type=float, default=5.0)
    parser.add_argument('--felt-min', type=int, default=10, help='jumlah respons DYFI paling sedikit')
    args = parser.parse_args()

    client = Client('usgs', min_interval_s=1.0)
    url = usgs.url_daftar(args.dari, args.sampai, args.mag_min, args.felt_min)
    fitur = json.loads(client.text(url, timeout=120, valid=lambda isi: '"features"' in isi))['features']
    print(f'{len(fitur)} gempa di katalog')

    kejadian, dyfi, tanpa_berkas = [], [], []
    for i, f in enumerate(fitur, 1):
        k = usgs.baris_kejadian(f)
        try:
            baris = laporan_gempa(client, k, f['properties']['detail'])
        except (ValueError, KeyError, IndexError) as galat:
            # Berkas bersusunan tak dikenal: gempa ini dicatat tanpa kotak, tidak menghentikan yang lain.
            print(f'  {k["id"]}: berkas DYFI tidak terbaca ({galat})')
            baris = None
        if baris is None:
            tanpa_berkas.append(k['id'])
        else:
            dyfi.extend(baris)
        k['n_kotak'] = len(baris or [])
        kejadian.append(k)
        if i % 25 == 0:
            print(f'  {i}/{len(fitur)} gempa, {len(dyfi)} kotak, {client.network_requests} permintaan')

    kolom = ['gempa_id', 'satuan', 'kotak', 'tempat', 'lat', 'lon', 'cdi', 'n_respons', 'meragukan', 'simpangan_baku',
             'jarak_episenter_km', 'jarak_hiposenter_km', 'jarak_usgs_km', 'jenis_jarak_usgs']
    kejadian_df, dyfi_df = pd.DataFrame(kejadian), pd.DataFrame(dyfi, columns=kolom)
    OUT.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)
    kejadian_df.to_csv(OUT / 'usgs_kejadian.csv', index=False)
    dyfi_df.to_csv(OUT / 'usgs_dyfi.csv', index=False)
    (RESULTS / 'gempa_usgs_ringkasan.md').write_text(
        ringkasan(kejadian_df, dyfi_df, tanpa_berkas, url, args, client.network_requests), encoding='utf-8', newline='\n')
    print(f'{len(kejadian_df)} gempa, {len(dyfi_df)} kotak DYFI, {len(tanpa_berkas)} gempa tanpa berkas, '
          f'{client.network_requests} permintaan jaringan')


if __name__ == '__main__':
    main()
