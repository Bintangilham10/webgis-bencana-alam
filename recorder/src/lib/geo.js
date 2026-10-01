// Apakah titik berada di dalam geometri Polygon/MultiPolygon GeoJSON (koordinat
// [lon, lat]). Aturan genap-ganjil dihitung atas semua ring satu poligon, jadi
// titik di dalam lubang (ring dalam) dianggap di luar.
export function containsPoint(geometry, { lat, lon }) {
  if (!geometry) return false;
  const polygons =
    geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : [];
  return polygons.some((rings) => {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  });
}
