"""Inventaris kejadian gerakan tanah terharmonisasi (RQ-L1 sampai RQ-L3).

Sumber:
- Laporan pemeriksaan lapangan PVMBG (Portal MBG, api/get-field-reports), 2017–2025.
- Tanggapan gerakan tanah MAGMA Indonesia, Januari 2017–Mei 2023.

Aturan pembersihan mengikuti PROTOKOL.md bagian 3. Keluaran satu baris per
kejadian di data/inventaris.parquet (dan .csv), plus ringkasan per tahun di
results/inventaris_per_tahun.csv. Salinan ringkas untuk layer riwayat longsor
SIGAP ditulis ke server/data/landslides.geojson (tanpa data pribadi).

Jalankan dari root repo: research/.venv/Scripts/python research/01_inventaris.py
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone

import pandas as pd
from bs4 import BeautifulSoup

from sigap_riset.geo import haversine_km
from sigap_riset.http import Client
from sigap_riset.paths import DATA, RESULTS, ROOT
from sigap_riset.waktu import BULAN, TZ_OFFSET_JAM
from sigap_riset.wilayah import kab_kota_at, nearest_kab_kota

FIELD_REPORTS_URL = 'https://vsi.esdm.go.id/portalmbg/api/get-field-reports'
MAGMA_LIST_URL = 'https://magma.esdm.go.id/v1/gerakan-tanah/tanggapan?page={page}'

# Entri laporan lapangan yang bukan kejadian gerakan tanah.
NON_EVENT = re.compile(r'kajian lokasi|calon lahan|geolistrik', re.I)
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = 94.0, -12.0, 142.0, 7.0
SAME_REPORT_KM = 1.0
SAME_EVENT_KM = 2.0
SAME_EVENT_DAYS = 3

DATE_LONG = re.compile(
    r'pada\s+(?:\w+,\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+pukul\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(WIB|WITA|WIT)\b', re.I
)
DATE_ISO = re.compile(r'pada\s+tanggal\s+(\d{4})-(\d{2})-(\d{2})\s+pukul\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(WIB|WITA|WIT)\b', re.I)
COORD = re.compile(r'posisi\s+(-?\d+(?:\.\d+)?)\s*LU\s+dan\s+(-?\d+(?:\.\d+)?)\s*BT', re.I)
ZONA = re.compile(r'Zona Potensi Gerakan Tanah\s+([^.]+?)\s*\.', re.I)
CRS = re.compile(r'/tanggapan/(CRS\d+)')


def in_indonesia(lat: float, lon: float) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def cluster(points: list[dict], radius_km: float) -> list[list[dict]]:
    """Kelompok titik berantai: titik masuk kelompok bila ≤ radius dari salah satu anggota."""
    groups = []
    unassigned = list(range(len(points)))
    while unassigned:
        queue = [unassigned.pop(0)]
        members = []
        while queue:
            i = queue.pop()
            members.append(i)
            near = [
                j for j in unassigned
                if haversine_km(points[i]['lat'], points[i]['lon'], points[j]['lat'], points[j]['lon']) <= radius_km
            ]
            for j in near:
                unassigned.remove(j)
            queue.extend(near)
        groups.append([points[i] for i in sorted(members)])
    return groups


# ---------- Laporan lapangan PVMBG ----------

def load_pvmbg(client: Client) -> tuple[pd.DataFrame, dict]:
    raw = client.json(FIELD_REPORTS_URL)
    points = [dict(item, grup_tahun=grup) for grup, items in raw.items() for item in items]
    rows = []
    dropped = {'tanggal_tidak_valid': 0, 'koordinat_tidak_valid': 0, 'bukan_kejadian': 0}
    for p in points:
        try:
            tanggal = date.fromisoformat(p['date_occurred'])
        except (TypeError, ValueError):
            dropped['tanggal_tidak_valid'] += 1
            continue
        try:
            lat, lon = float(p['lat']), float(p['long'])
        except (TypeError, ValueError):
            dropped['koordinat_tidak_valid'] += 1
            continue
        if not in_indonesia(lat, lon):
            dropped['koordinat_tidak_valid'] += 1
            continue
        tipe = (p.get('landslide_type') or '').strip() or None
        if tipe and NON_EVENT.search(tipe):
            dropped['bukan_kejadian'] += 1
            continue
        rows.append({
            'doc_id': p.get('doc_id') or f"tanpa-doc-{p['id']}",
            'tanggal': tanggal,
            'lat': lat,
            'lon': lon,
            'tipe': tipe,
            'jenis_laporan': p.get('event_type') or None,
            # Label di Portal MBG: city = kab/kota, regency = kecamatan, district = desa.
            'kab_teks': p.get('city_string') or None,
            'kecamatan': p.get('regency_string') or None,
            'desa': p.get('district_string') or p.get('village_string') or None,
            'tahun_pemeriksaan': p.get('investigation_year') or p['grup_tahun'],
        })

    events = []
    for (doc_id, tanggal), group in pd.DataFrame(rows).groupby(['doc_id', 'tanggal'], sort=True):
        for k, members in enumerate(cluster(group.to_dict('records'), SAME_REPORT_KM)):
            first = members[0]
            tipe = next((m['tipe'] for m in members if m['tipe']), None)
            events.append({
                'id': f'pvmbg:{doc_id}:{tanggal.isoformat()}:{k}',
                'sumber': 'pvmbg-lapangan',
                'ref': str(doc_id),
                'tanggal': tanggal,
                'waktu_utc': None,
                'lat': first['lat'],
                'lon': first['lon'],
                'tipe': tipe,
                'jenis_laporan': first['jenis_laporan'],
                'zona_sumber': None,
                'kab_teks': first['kab_teks'],
                'kecamatan': first['kecamatan'],
                'desa': first['desa'],
                'n_titik': len(members),
                'tahun_pemeriksaan': first['tahun_pemeriksaan'],
                'rekomendasi': None,
            })
    stats = {'titik_mentah': len(points), 'titik_dipakai': len(rows), **dropped, 'kejadian': len(events)}
    return pd.DataFrame(events), stats


# ---------- Tanggapan MAGMA ----------

def parse_waktu(text: str) -> tuple[date, datetime] | None:
    """Tanggal lokal dan waktu UTC dari "pada Kamis, 23 Februari 2023 pukul 23:00:00 WIB"."""
    m = DATE_ISO.search(text)
    if m:
        year, month, day = int(m[1]), int(m[2]), int(m[3])
    else:
        m = DATE_LONG.search(text)
        if not m or m[2].lower() not in BULAN:
            return None
        year, month, day = int(m[3]), BULAN[m[2].lower()], int(m[1])
    hour, minute, second, tz = int(m[4]), int(m[5]), int(m[6] or 0), m[7].upper()
    try:
        local = datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None
    return local.date(), (local - timedelta(hours=TZ_OFFSET_JAM[tz])).replace(tzinfo=timezone.utc)


def parse_magma_page(html: str) -> list[dict]:
    soup = BeautifulSoup(html, 'html.parser')
    items = []
    for item in soup.select('div.timeline-item'):
        title = item.select_one('p.timeline-title')
        if title is None:
            continue
        link = item.select_one('a.card-link')
        crs = CRS.search(link.get('href', '')) if link else None
        rekomendasi = None
        for label in item.select('label'):
            if 'Rekomendasi' in label.get_text():
                paragraph = label.find_next_sibling('p')
                rekomendasi = paragraph.get_text(' ', strip=True) if paragraph else None
        items.append({
            'crs': crs[1] if crs else None,
            'judul': title.get_text(' ', strip=True),
            'teks': ' '.join(p.get_text(' ', strip=True) for p in item.select('p.blog-text')),
            'rekomendasi': rekomendasi,
        })
    return items


def load_magma(client: Client) -> tuple[pd.DataFrame, dict]:
    items, page = [], 1
    while True:
        html = client.text(MAGMA_LIST_URL.format(page=page))
        found = parse_magma_page(html) if html else []
        if not found:
            break
        items.extend(found)
        page += 1

    events = []
    dropped = {'tanpa_waktu': 0, 'tanpa_koordinat': 0, 'koordinat_ditukar': 0}
    for item in items:
        when = parse_waktu(item['teks'])
        coord = COORD.search(item['teks'])
        if when is None:
            dropped['tanpa_waktu'] += 1
            continue
        if coord is None:
            dropped['tanpa_koordinat'] += 1
            continue
        lat, lon = float(coord[1]), float(coord[2])
        # Sebagian laporan menulis bujur di posisi lintang.
        if not in_indonesia(lat, lon) and in_indonesia(lon, lat):
            lat, lon = lon, lat
            dropped['koordinat_ditukar'] += 1
        if not in_indonesia(lat, lon):
            dropped['tanpa_koordinat'] += 1
            continue
        lokasi = item['judul'].split(' di ', 1)[-1]
        parts = [part.strip() for part in lokasi.split(',')]
        zona = ZONA.search(item['teks'])
        events.append({
            'id': f"magma:{item['crs']}",
            'sumber': 'magma-tanggapan',
            'ref': item['crs'],
            'tanggal': when[0],
            'waktu_utc': when[1].isoformat(),
            'lat': lat,
            'lon': lon,
            'tipe': None,
            'jenis_laporan': 'Tanggapan',
            'zona_sumber': zona[1].strip() if zona else None,
            'kab_teks': parts[-2] if len(parts) >= 2 else None,
            'kecamatan': parts[1] if len(parts) >= 4 else None,
            'desa': parts[0] if len(parts) >= 3 else None,
            'n_titik': 1,
            'tahun_pemeriksaan': None,
            'rekomendasi': item['rekomendasi'],
        })
    stats = {'halaman': page - 1, 'laporan': len(items), **dropped, 'kejadian': len(events)}
    return pd.DataFrame(events).drop_duplicates('id'), stats


# ---------- Penggabungan ----------

def merge_sources(magma: pd.DataFrame, pvmbg: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Kejadian PVMBG yang sama dengan tanggapan MAGMA (≤ 3 hari, ≤ 2 km) dibuang;
    tipenya dipakai untuk baris MAGMA."""
    pvmbg = pvmbg.copy()
    magma = magma.copy()
    pvmbg['duplikat_dari'] = None
    pv_dates = pd.to_datetime(pvmbg['tanggal'])
    for i, m in magma.iterrows():
        near_in_time = (pv_dates - pd.Timestamp(m['tanggal'])).abs() <= pd.Timedelta(days=SAME_EVENT_DAYS)
        candidates = pvmbg[near_in_time & pvmbg['duplikat_dari'].isna()]
        if candidates.empty:
            continue
        distance = haversine_km(m['lat'], m['lon'], candidates['lat'].to_numpy(), candidates['lon'].to_numpy())
        same = candidates.index[distance <= SAME_EVENT_KM]
        if len(same):
            pvmbg.loc[same, 'duplikat_dari'] = m['id']
            tipe = next((t for t in pvmbg.loc[same, 'tipe'] if t), None)
            if tipe and not m['tipe']:
                magma.loc[i, 'tipe'] = tipe
            magma.loc[i, 'sumber'] = 'magma-tanggapan+pvmbg-lapangan'
    duplicates = int(pvmbg['duplikat_dari'].notna().sum())
    merged = pd.concat([magma, pvmbg[pvmbg['duplikat_dari'].isna()].drop(columns='duplikat_dari')], ignore_index=True)
    return merged, duplicates


def date_precision(sumber: str, tanggal: date) -> str:
    """Seberapa tepat tanggal kejadian (PROTOKOL.md v1.1 bagian 3).

    Laporan lapangan PVMBG yang hanya tahu tahun kejadian diisi 1 Januari atau
    31 Desember, dan yang hanya tahu bulannya diisi tanggal 1: 83 dari 788
    kejadian jatuh pada 1 Januari, padahal sebaran merata hanya memberi ±2.
    Tanggal 1 tetap bisa asli, jadi tanda 'bulan' berarti "mungkin hanya bulan".
    Tanggapan MAGMA memuat tanggal dan jam kejadian di teksnya.
    """
    if sumber != 'pvmbg-lapangan':
        return 'hari'
    if (tanggal.month, tanggal.day) in ((1, 1), (12, 31)):
        return 'tahun'
    return 'bulan' if tanggal.day == 1 else 'hari'


# Garis pantai poligon Kepmendagri lebih kasar dari kenyataan: 13 kejadian pantai
# jatuh 2–389 m di laut. Kejadian sampai 1 km di luar poligon diberi kab/kota
# terdekat (untuk peta dan analisis lanjutan), tetapi tetap tidak memenuhi definisi
# kasus RQ-L1 ("koordinat di dalam poligon kab/kota", PROTOKOL.md bagian 3).
COAST_SNAP_M = 1000


def assign_wilayah(events: pd.DataFrame) -> pd.DataFrame:
    """Kode kab/kota dan provinsi dari poligon Kepmendagri 2025 di PostGIS.

    `di_daratan` = titik di dalam poligon kab/kota. `jarak_batas_m` = 0 untuk titik
    di dalam poligon, jarak ke kab/kota terdekat untuk titik pantai yang dipasangkan
    (≤ 1 km), dan kosong untuk titik yang lebih jauh."""
    lats, lons = events['lat'].tolist(), events['lon'].tolist()
    found = kab_kota_at(lats, lons)
    outside = [i for i, row in enumerate(found) if row is None]
    nearby = nearest_kab_kota([lats[i] for i in outside], [lons[i] for i in outside], COAST_SNAP_M)
    distance = [0.0 if row else None for row in found]
    for i, row in zip(outside, nearby):
        if row:
            found[i] = row[:4]
            distance[i] = round(row[4], 1)
    events = events.copy()
    outside_set = set(outside)
    events['di_daratan'] = [i not in outside_set for i in range(len(found))]
    for col, pos in (('kab_kode', 0), ('kab_nama', 1), ('prov_kode', 2), ('provinsi', 3)):
        events[col] = [row[pos] if row else None for row in found]
    events['jarak_batas_m'] = distance
    return events


# ---------- Ekspor untuk layer riwayat SIGAP ----------

SERVER_GEOJSON = ROOT.parent / 'server' / 'data' / 'landslides.geojson'


def export_for_server(events: pd.DataFrame) -> int:
    """GeoJSON ringkas untuk seed tabel events (hazard longsor). Hanya waktu,
    lokasi, dan tipe gerakan tanah; rekomendasi panjang dan identitas petugas
    tidak ikut. Koordinat 4 desimal (±10 m) sudah cukup untuk peta."""
    def text(value):
        return value.strip() if isinstance(value, str) and value.strip() else None

    features = []
    for e in events.itertuples():
        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [round(e.lon, 4), round(e.lat, 4)]},
            'properties': {
                'id': e.id,
                'tanggal': e.tanggal.isoformat(),
                'presisi_tanggal': e.presisi_tanggal,
                'waktu_utc': text(e.waktu_utc),
                'sumber': e.sumber,
                'tipe': text(e.tipe),
                'desa': text(e.desa),
                'kecamatan': text(e.kecamatan),
                'kab_kode': text(e.kab_kode),
                'kab_nama': text(e.kab_nama),
                'provinsi': text(e.provinsi),
            },
        })
    collection = {
        'type': 'FeatureCollection',
        'attribution': 'Kejadian gerakan tanah: PVMBG, Badan Geologi, Kementerian ESDM (Portal MBG dan MAGMA Indonesia), '
                       'dihimpun dan dideduplikasi oleh research/01_inventaris.py',
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'features': features,
    }
    SERVER_GEOJSON.parent.mkdir(parents=True, exist_ok=True)
    SERVER_GEOJSON.write_text(json.dumps(collection, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    return len(features)


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)

    pvmbg, pvmbg_stats = load_pvmbg(Client('pvmbg-portal', min_interval_s=1.0))
    print('PVMBG laporan lapangan:', pvmbg_stats)
    magma, magma_stats = load_magma(Client('magma', min_interval_s=2.0))
    print('MAGMA tanggapan:', magma_stats)

    events, duplicates = merge_sources(magma, pvmbg)
    events = assign_wilayah(events)
    events['tipe_diketahui'] = events['tipe'].notna()
    events['tanggal'] = pd.to_datetime(events['tanggal']).dt.date
    events['presisi_tanggal'] = [date_precision(s, t) for s, t in zip(events['sumber'], events['tanggal'])]
    events = events.sort_values(['tanggal', 'id']).reset_index(drop=True)
    snapped = int((events['jarak_batas_m'] > 0).sum())
    print(f'Kejadian gabungan: {len(events)} (duplikat PVMBG↔MAGMA dibuang: {duplicates}, di luar poligon kab/kota: '
          f'{(~events["di_daratan"]).sum()}, {snapped} di antaranya ≤ 1 km dari pantai dan diberi kab/kota terdekat)')

    events.to_parquet(DATA / 'inventaris.parquet', index=False)
    events.to_csv(DATA / 'inventaris.csv', index=False)
    print(f'Riwayat untuk server: {export_for_server(events)} kejadian → server/data/landslides.geojson')

    per_year = (
        events[events['di_daratan']]
        .assign(tahun=pd.to_datetime(events['tanggal']).dt.year)
        .pivot_table(index='tahun', columns='sumber', values='id', aggfunc='count', fill_value=0)
    )
    per_year['total'] = per_year.sum(axis=1)
    per_year.to_csv(RESULTS / 'inventaris_per_tahun.csv')
    print(per_year.loc[per_year.index >= 2015].to_string())
    window = events[events['di_daratan'] & (pd.to_datetime(events['tanggal']).dt.year.between(2022, 2025))]
    print(f'Kasus kandidat RQ-L1 (2022–2025, di daratan): {len(window)}; bertipe diketahui: {window["tipe_diketahui"].sum()}; '
          f'presisi tanggal: {window["presisi_tanggal"].value_counts().to_dict()}')


if __name__ == '__main__':
    main()
