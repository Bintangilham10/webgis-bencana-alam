"""Garis pantai untuk latar bumi halaman depan (web/src/ui/globe-backdrop.js).

Menulis public/images/landing/bumi/pantai.json:
  land  cincin daratan seluruh dunia (Natural Earth 1:50m, land)
  idn   cincin daratan Indonesia (Natural Earth 1:50m, admin 0 countries, ADM0_A3 = IDN)
Tiap cincin = [[bujur, lintang], ...] dibulatkan 3 desimal, disederhanakan dengan
Ramer-Douglas-Peucker (toleransi dalam derajat). Pulau yang sangat kecil dibuang.

Jalankan dari folder web dengan Python apa pun (hanya pustaka standar):
  python scripts/landing_pantai.py
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / "public" / "images" / "landing" / "bumi" / "pantai.json"
BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson"
LAND = f"{BASE}/ne_50m_land.geojson"
COUNTRIES = f"{BASE}/ne_50m_admin_0_countries.geojson"
# Toleransi penyederhanaan dan luas minimum cincin (derajat, derajat persegi).
TOLERANCE = {"land": 0.05, "idn": 0.01}
MIN_AREA = {"land": 0.03, "idn": 0.002}


def get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "sigap-bencana-landing/1.0"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read())


def simplify(points: list[list[float]], tol: float) -> list[list[float]]:
    if len(points) < 6:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        length = (dx * dx + dy * dy) ** 0.5
        best, index = 0.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            dist = abs(dy * px - dx * py + bx * ay - by * ax) / length if length else ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if dist > best:
                best, index = dist, i
        if best > tol:
            keep[index] = True
            stack += [(a, index), (index, b)]
    return [p for p, k in zip(points, keep) if k]


def area(ring: list[list[float]]) -> float:
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]))) / 2


def rings(features, kind: str) -> list[list[list[float]]]:
    out = []
    for feature in features:
        geom = feature["geometry"]
        polygons = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for polygon in polygons:
            for ring in polygon:
                ring = simplify(ring[:-1] if ring[0] == ring[-1] else ring, TOLERANCE[kind])
                if len(ring) >= 4 and area(ring) >= MIN_AREA[kind]:
                    out.append([[round(x, 3), round(y, 3)] for x, y in ring])
    return out


def main() -> None:
    land = rings(get(LAND)["features"], "land")
    idn = rings([f for f in get(COUNTRIES)["features"] if f["properties"]["ADM0_A3"] == "IDN"], "idn")
    OUT.write_text(json.dumps({"land": land, "idn": idn}, separators=(",", ":")), encoding="utf-8")
    points = sum(len(r) for r in land) + sum(len(r) for r in idn)
    print(f"Tertulis {OUT.relative_to(WEB)}: {len(land)} cincin daratan, {len(idn)} cincin Indonesia, {points} titik, {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
