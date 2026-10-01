import numpy as np

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1, lon1, lat2, lon2):
    """Jarak lingkaran besar dalam km; menerima skalar atau array numpy."""
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a))


def contains_point(geometry: dict | None, lat: float, lon: float) -> bool:
    """Titik di dalam Polygon/MultiPolygon GeoJSON (koordinat [lon, lat]).

    Aturan genap-ganjil dihitung atas semua ring satu poligon, jadi titik di dalam
    lubang dianggap di luar. Sama dengan containsPoint di recorder/src/lib/geo.js."""
    if not geometry:
        return False
    if geometry.get('type') == 'MultiPolygon':
        polygons = geometry['coordinates']
    elif geometry.get('type') == 'Polygon':
        polygons = [geometry['coordinates']]
    else:
        return False
    for rings in polygons:
        inside = False
        for ring in rings:
            j = len(ring) - 1
            for i in range(len(ring)):
                xi, yi = ring[i][0], ring[i][1]
                xj, yj = ring[j][0], ring[j][1]
                if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                    inside = not inside
                j = i
        if inside:
            return True
    return False
