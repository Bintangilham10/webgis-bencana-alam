"""Query spasial ke tabel wilayah SIGAP (batas Kepmendagri 2025 di PostGIS)."""

from __future__ import annotations

from .db import connect


def kab_kota_at(lats: list[float], lons: list[float]) -> list[tuple | None]:
    """(kode kab/kota, nama, kode provinsi, nama provinsi) di tiap titik; None di luar poligon."""
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT t.idx, k.kode, k.nama, p.kode, p.nama
            FROM unnest(%s::int[], %s::float8[], %s::float8[]) AS t(idx, lon, lat)
            JOIN LATERAL (
              SELECT kode, nama, induk_kode FROM wilayah
              WHERE tingkat <> 'provinsi' AND ST_Intersects(geom, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326))
              LIMIT 1
            ) k ON true
            JOIN wilayah p ON p.kode = k.induk_kode
            """,
            (list(range(len(lats))), list(lons), list(lats)),
        ).fetchall()
    found = {idx: rest for idx, *rest in rows}
    return [tuple(found[i]) if i in found else None for i in range(len(lats))]


def nearest_kab_kota(lats: list[float], lons: list[float], max_m: float) -> list[tuple | None]:
    """(kode kab/kota, nama, kode provinsi, nama provinsi, jarak m) kab/kota terdekat
    dalam max_m meter dari tiap titik; None bila tidak ada."""
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT t.idx, k.kode, k.nama, p.kode, p.nama, k.jarak
            FROM unnest(%s::int[], %s::float8[], %s::float8[]) AS t(idx, lon, lat)
            JOIN LATERAL (
              SELECT kode, nama, induk_kode,
                     ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)::geography) AS jarak
              FROM wilayah
              WHERE tingkat <> 'provinsi'
                AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326)::geography, %s)
              ORDER BY jarak
              LIMIT 1
            ) k ON true
            JOIN wilayah p ON p.kode = k.induk_kode
            """,
            (list(range(len(lats))), list(lons), list(lats), max_m),
        ).fetchall()
    found = {idx: rest for idx, *rest in rows}
    return [tuple(found[i]) if i in found else None for i in range(len(lats))]


def random_points(specs: list[tuple[str, str, int, int]]) -> dict[str, list[tuple[float, float]]]:
    """Titik acak di dalam wilayah. specs = [(kunci, kode wilayah, jumlah, seed)] → {kunci: [(lat, lon), ...]}.

    ST_GeneratePoints dengan seed memberi titik yang sama setiap kali dijalankan.
    Untuk multipoligon (wilayah kepulauan) jumlahnya dibagi per pulau dan bisa
    berkurang karena pembulatan, jadi dibuat beberapa titik cadangan lalu dipotong.
    """
    keys, codes, counts, seeds = map(list, zip(*specs)) if specs else ([], [], [], [])
    wanted = dict(zip(keys, counts))
    counts = [n + max(3, n // 2) for n in counts]
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT s.key, (g.d).path[1], ST_Y((g.d).geom), ST_X((g.d).geom)
            FROM unnest(%s::text[], %s::text[], %s::int[], %s::int[]) AS s(key, kode, n, seed)
            JOIN wilayah w ON w.kode = s.kode
            CROSS JOIN LATERAL (SELECT ST_Dump(ST_GeneratePoints(w.geom, s.n, s.seed)) AS d) g
            ORDER BY s.key, 2
            """,
            (keys, codes, counts, seeds),
        ).fetchall()
    points: dict[str, list[tuple[float, float]]] = {}
    for key, _, lat, lon in rows:
        if len(points.setdefault(key, [])) < wanted[key]:
            points[key].append((lat, lon))
    return points
