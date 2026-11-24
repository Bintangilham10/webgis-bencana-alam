"""Laporan guncangan "Did You Feel It?" (DYFI) USGS untuk gempa di wilayah Indonesia.

USGS mengumpulkan laporan warga lewat kuesioner daring dan merangkumnya menjadi
intensitas (CDI, sebanding dengan MMI tetapi berdesimal) per kotak 10 km. Berbeda
dengan daftar BMKG, tiap kotak membawa jumlah responsnya, gempa besar punya
ratusan laporan sampai jauh dari episenter, dan CDI 1 berarti responden di kotak
itu tidak merasakan gempa. Data USGS berstatus domain publik.

Yang perlu diingat saat memakai datanya:
- kotak dengan satu atau dua respons tidak stabil; USGS bisa menandai kotak
  sebagai meragukan (kolom `meragukan`);
- hanya kotak yang punya responden yang muncul;
- jarak yang ditulis USGS adalah jarak hiposenter pada berkas susunan baru dan
  jarak episenter pada susunan lama, jadi skrip menghitung ulang keduanya sendiri.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from urllib.parse import urlencode

FDSN = 'https://earthquake.usgs.gov/fdsnws/event/1/query'
# Sama dengan wilayah yang dipakai aplikasi (server/src/sources/usgs-gempa.js).
REGION = {'south': -12, 'north': 7, 'west': 94, 'east': 142}


def url_daftar(dari: str, sampai: str, mag_min: float, felt_min: int) -> str:
    """Kueri katalog: gempa di wilayah Indonesia dengan sedikitnya `felt_min` respons DYFI."""
    return FDSN + '?' + urlencode({
        'format': 'geojson', 'starttime': dari, 'endtime': sampai,
        'minlatitude': REGION['south'], 'maxlatitude': REGION['north'],
        'minlongitude': REGION['west'], 'maxlongitude': REGION['east'],
        'minmagnitude': mag_min, 'minfelt': felt_min, 'orderby': 'time-asc',
    })


def baris_kejadian(fitur: dict) -> dict:
    """Satu fitur katalog USGS → satu baris kejadian."""
    p = fitur['properties']
    lon, lat, kedalaman = fitur['geometry']['coordinates'][:3]
    tempat = p.get('place') or ''
    return {
        'id': fitur['id'],
        'waktu_utc': datetime.fromtimestamp(p['time'] / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'lat': lat, 'lon': lon, 'kedalaman_km': kedalaman, 'magnitudo': p['mag'], 'jenis_magnitudo': p.get('magType') or '',
        'tempat': tempat, 'negara': tempat.rsplit(', ', 1)[1] if ', ' in tempat else '',
        'n_respons': p.get('felt'), 'cdi_maks': p.get('cdi'), 'mmi_shakemap': p.get('mmi'),
        'ada_shakemap': ',shakemap,' in (p.get('types') or ''), 'url': p.get('url') or '',
    }


def berkas_dyfi(detail: dict) -> tuple[str | None, str | None, str | None]:
    """(URL cdi_geo.txt, URL dyfi_geo_10km.geojson, URL cdi_zip.txt) dari produk DYFI utama sebuah gempa.

    Dua yang pertama berisi kotak 10 km. Sebagian gempa 2011–2012 hanya punya
    cdi_zip.txt, yang merangkum respons per kota."""
    produk = (detail.get('properties', {}).get('products', {}).get('dyfi') or [None])[0]
    if not produk:
        return None, None, None
    isi = produk.get('contents', {})
    return tuple((isi.get(nama) or {}).get('url') for nama in ('cdi_geo.txt', 'dyfi_geo_10km.geojson', 'cdi_zip.txt'))


def baca_cdi_geo(teks: str) -> list[dict]:
    """cdi_geo.txt (atau cdi_zip.txt) → satu baris per kotak 10 km (atau per kota).

    Kolom dibaca menurut baris judul, karena USGS memakai dua susunan:
    - baru: Geocoded box, CDI, No. of responses, Hypocentral distance, Latitude,
      Longitude, Suspect?, Standard deviation, City, State;
    - lama: ZIP/Location, CDI, No. of responses, Epicentral distance, Latitude,
      Longitude, Suspect?, City, State (kolom City mengulang nama kotak).
    Jarak USGS disimpan beserta jenisnya, sebab susunan lama memakai jarak episenter."""
    judul: dict[str, int] = {}
    baris = []
    for kolom in csv.reader(io.StringIO(teks)):
        if not kolom:
            continue
        if kolom[0].startswith('#'):
            kolom[0] = kolom[0].split(':', 1)[1] if ':' in kolom[0] else kolom[0].lstrip('# ')
            judul = {nama.strip(): i for i, nama in enumerate(kolom)}
            continue

        def nilai(*nama: str) -> str:
            return next((kolom[judul[n]] for n in nama if n in judul and judul[n] < len(kolom)), '')

        kotak = nilai('Geocoded box', 'ZIP/Location')
        tempat = nilai('City')
        baris.append({
            'kotak': kotak, 'cdi': float(nilai('CDI')), 'n_respons': int(nilai('No. of responses')),
            'lat': float(nilai('Latitude')), 'lon': float(nilai('Longitude')),
            'meragukan': nilai('Suspect?').strip() not in ('', '0'),
            'simpangan_baku': float(nilai('Standard deviation')) if nilai('Standard deviation') else None,
            'tempat': '' if tempat == kotak else tempat,
            'jarak_usgs_km': float(nilai('Hypocentral distance', 'Epicentral distance')),
            'jenis_jarak_usgs': 'hiposenter' if 'Hypocentral distance' in judul else 'episenter',
        })
    return baris


def baca_geojson(geo: dict) -> list[dict]:
    """dyfi_geo_10km.geojson → baris yang sama; dipakai bila cdi_geo.txt tidak ada."""
    baris = []
    for fitur in geo.get('features', []):
        p = fitur['properties']
        cincin = fitur['geometry']['coordinates'][0]
        titik = cincin[:-1] if len(cincin) > 1 and cincin[0] == cincin[-1] else cincin
        kotak, _, tempat = (p.get('name') or '').partition('<br>')
        baris.append({
            'kotak': kotak, 'cdi': float(p['cdi']), 'n_respons': int(p['nresp']),
            'lat': sum(t[1] for t in titik) / len(titik), 'lon': sum(t[0] for t in titik) / len(titik),
            'meragukan': False, 'simpangan_baku': p.get('stddev'), 'tempat': tempat,
            'jarak_usgs_km': float(p['dist']), 'jenis_jarak_usgs': '',
        })
    return baris
