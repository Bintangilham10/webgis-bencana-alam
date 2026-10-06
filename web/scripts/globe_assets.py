"""Tekstur bumi untuk latar halaman depan (web/src/ui/globe-scene.js).

Dua tingkat detail, keduanya proyeksi lintang-bujur (equirectangular):
  bumi       seluruh dunia
  indonesia  90-150 BT, 15 LS-13 LU; lebih rinci untuk wilayah di tengah cakrawala

Tiap tingkat menghasilkan:
  <nama>-warna.webp  citra satelit: daratan Sentinel-2 cloudless 2016 (EOX, CC BY 4.0),
                     laut NASA Blue Marble dengan relief dasar laut; batas pantai dari
                     data ketinggian. Latar "Atlas alam" hanya membaca kecerahan lautnya
                     untuk membagi tingkat kedalaman.
  <nama>-tinggi.webp ketinggian daratan 0..maks meter dalam 8 bit (laut = 0), untuk
                     tingkat warna daratan Indonesia

Garis pantainya dibuat terpisah oleh scripts/landing_pantai.py.

Batas wilayah dan ketinggian maksimum ditulis ke web/src/lib/globe-tiers.js.

Jalankan dari folder web dengan Python yang punya numpy dan Pillow (mis. venv riset):
  ../research/.venv/Scripts/python scripts/globe_assets.py
Unduhan mentah (±60 MB) disimpan di scripts/.cache-globe supaya bisa diulang.
"""

from __future__ import annotations

import io
import json
import math
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / "public" / "images" / "landing" / "bumi"
CACHE = Path(__file__).resolve().parent / ".cache-globe"
TIERS_JS = WEB / "src" / "lib" / "globe-tiers.js"

EOX_WMS = "https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&version=1.1.1&layers=s2cloudless&styles=&srs=EPSG:4326&format=image/jpeg"
GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&STYLES=&CRS=EPSG:4326&FORMAT=image/jpeg&LAYERS=BlueMarble_ShadedRelief_Bathymetry"
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# bbox = (barat, selatan, timur, utara); color/height = ukuran piksel; zoom = tingkat
# AWS Terrain Tiles yang resolusinya mendekati citra.
TIERS = [
    dict(name="bumi", bbox=(-180.0, -90.0, 180.0, 90.0), color=(2048, 1024), height=(1024, 512), zoom=3),
    dict(name="indonesia", bbox=(90.0, -15.0, 150.0, 13.0), color=(3840, 1792), height=(1920, 896), zoom=7),
]
CHUNK = 2048  # ukuran maksimum satu permintaan WMS


def fetch(url: str, name: str) -> bytes:
    path = CACHE / name
    if path.exists():
        return path.read_bytes()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "sigap-bencana-landing/1.0"})
            with urllib.request.urlopen(req, timeout=90) as res:
                data = res.read()
            if data[:5] == b"<?xml" or data[:1] == b"<":
                raise RuntimeError(f"bukan gambar: {data[:200]!r}")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return data
        except Exception as err:  # noqa: BLE001 - ulang untuk galat jaringan apa pun
            if attempt == 3:
                raise
            print(f"  ulang {name}: {err}")
            time.sleep(2 + attempt * 3)
    raise AssertionError


def wms(base: str, bbox, size, tag: str, lat_first: bool) -> np.ndarray:
    """Citra WMS EPSG:4326 dalam potongan <= CHUNK piksel, disambung jadi satu.
    WMS 1.3.0 (GIBS) memakai urutan lintang-bujur dan nama parameter huruf besar."""
    keys = ("BBOX", "WIDTH", "HEIGHT") if lat_first else ("bbox", "width", "height")
    west, south, east, north = bbox
    width, height = size
    out = np.zeros((height, width, 3), dtype=np.uint8)
    for y0 in range(0, height, CHUNK):
        for x0 in range(0, width, CHUNK):
            w = min(CHUNK, width - x0)
            h = min(CHUNK, height - y0)
            lon0 = west + (east - west) * x0 / width
            lon1 = west + (east - west) * (x0 + w) / width
            lat1 = north - (north - south) * y0 / height
            lat0 = north - (north - south) * (y0 + h) / height
            box = f"{lat0},{lon0},{lat1},{lon1}" if lat_first else f"{lon0},{lat0},{lon1},{lat1}"
            data = fetch(f"{base}&{keys[0]}={box}&{keys[1]}={w}&{keys[2]}={h}", f"{tag}-{x0}-{y0}-{w}x{h}.img")
            out[y0 : y0 + h, x0 : x0 + w] = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
    return out


def tile_xy(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2**z
    lat = max(-85.0511, min(85.0511, lat))
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def dem(bbox, size, z: int) -> np.ndarray:
    """Ketinggian (meter, laut negatif) dari AWS Terrain Tiles, diproyeksikan ulang
    dari Web Mercator ke grid lintang-bujur dengan interpolasi bilinear."""
    west, south, east, north = bbox
    width, height = size
    x0, y0 = tile_xy(west, min(north, 85.05), z)
    x1, y1 = tile_xy(east, max(south, -85.05), z)
    n = 2**z
    tx0, tx1 = int(math.floor(x0)), min(n - 1, int(math.floor(x1 - 1e-9)))
    ty0, ty1 = int(math.floor(y0)), min(n - 1, int(math.floor(y1 - 1e-9)))
    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), dtype=np.float32)
    total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    done = 0
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            raw = fetch(TERRARIUM.format(z=z, x=tx, y=ty), f"terrarium-{z}-{tx}-{ty}.png")
            px = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB")).astype(np.float32)
            mosaic[(ty - ty0) * 256 : (ty - ty0 + 1) * 256, (tx - tx0) * 256 : (tx - tx0 + 1) * 256] = px[..., 0] * 256 + px[..., 1] + px[..., 2] / 256 - 32768
            done += 1
        print(f"  ketinggian z{z}: {done}/{total} tile", end="\r")
    print()
    lons = west + (np.arange(width) + 0.5) * (east - west) / width
    lats = north - (np.arange(height) + 0.5) * (north - south) / height
    mx = np.array([tile_xy(lon, 0, z)[0] for lon in lons]) - tx0
    my = np.array([tile_xy(0, lat, z)[1] for lat in lats]) - ty0
    px = np.clip(mx * 256 - 0.5, 0, mosaic.shape[1] - 1.001)
    py = np.clip(my * 256 - 0.5, 0, mosaic.shape[0] - 1.001)
    ix, iy = np.floor(px).astype(int), np.floor(py).astype(int)
    fx, fy = (px - ix)[None, :], (py - iy)[:, None]
    a = mosaic[iy][:, ix]
    b = mosaic[iy][:, ix + 1]
    c = mosaic[iy + 1][:, ix]
    d = mosaic[iy + 1][:, ix + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def build(tier: dict) -> dict:
    name, bbox = tier["name"], tier["bbox"]
    print(f"[{name}] citra Sentinel-2 cloudless")
    land = wms(EOX_WMS, bbox, tier["color"], f"s2-{name}", lat_first=False).astype(np.float32)
    print(f"[{name}] laut Blue Marble")
    sea = wms(GIBS_WMS, bbox, tier["color"], f"bm-{name}", lat_first=True).astype(np.float32)
    print(f"[{name}] ketinggian")
    elevation = dem(bbox, tier["color"], tier["zoom"])

    # Batas darat-laut dari ketinggian, dihaluskan satu piksel supaya pantai tidak bergerigi.
    mask = Image.fromarray(((elevation > 0.0) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    m = (np.asarray(mask).astype(np.float32) / 255.0)[..., None]
    # Laut sedikit diredupkan dan dikurangi kejenuhannya supaya mendekati warna asli dari orbit.
    gray = sea.mean(axis=2, keepdims=True)
    sea = np.clip((gray + (sea - gray) * 0.85) * 0.82, 0, 255)
    color = (land * m + sea * (1.0 - m)).astype(np.uint8)
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(color).save(OUT / f"{name}-warna.webp", quality=80, method=6)

    # Ketinggian daratan untuk GPU: 8 bit, 0 = permukaan laut.
    hmap = np.asarray(Image.fromarray(np.maximum(elevation, 0.0)).resize(tier["height"], Image.BILINEAR))
    top = float(np.ceil(hmap.max() / 10.0) * 10.0)
    Image.fromarray(np.round(hmap / top * 255.0).astype(np.uint8)).save(OUT / f"{name}-tinggi.webp", quality=92, method=6)
    sizes = {kind: (OUT / f"{name}-{kind}.webp").stat().st_size for kind in ("warna", "tinggi")}
    print(f"[{name}] maks {top:.0f} m, warna {sizes['warna'] / 1024:.0f} KB, tinggi {sizes['tinggi'] / 1024:.0f} KB")
    return {"name": name, "bbox": list(bbox), "maxHeight": top}


def main() -> None:
    tiers = [build(tier) for tier in TIERS]
    lines = ",\n".join(f"  {{ name: '{t['name']}', bbox: [{', '.join(str(v) for v in t['bbox'])}], maxHeight: {t['maxHeight']:.0f} }}" for t in tiers)
    TIERS_JS.write_text(
        "// Dibuat oleh scripts/globe_assets.py; jangan diubah manual.\n"
        "// bbox = [barat, selatan, timur, utara] dalam derajat; maxHeight = meter untuk nilai 255.\n"
        f"export const GLOBE_TIERS = [\n{lines},\n];\n",
        encoding="utf-8",
    )
    # Tingkat lama yang tidak dipakai lagi.
    keep = {f"{t['name']}-{kind}.webp" for t in tiers for kind in ("warna", "tinggi")}
    for path in OUT.glob("*.webp"):
        if path.name not in keep:
            path.unlink()
            print(f"Dihapus {path.name}")
    print(f"Tertulis {TIERS_JS.relative_to(WEB)}: {json.dumps(tiers)}")


if __name__ == "__main__":
    main()
