import { query } from '../db.js';

// Paparan rute terhadap zona bahaya banjir dan tanah longsor InaRISK (raster kelas
// ±550 m di bahaya_raster: 1 rendah, 2 sedang, 3 tinggi). Rute dipecah menjadi
// ruas ≤ 50 m; kelas tiap ruas dibaca di titik tengahnya. Raster ini hasil
// ekspor yang diperhalus, jadi angkanya perkiraan untuk membandingkan rute, bukan
// batas zona yang persis.
const SEGMENT_M = 50;

const EXPOSURE = `
  WITH line AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
  segs AS (
    SELECT row_number() OVER () AS i, d.geom AS seg
    FROM line, ST_DumpSegments(ST_Segmentize(line.g::geography, $2)::geometry) AS d
  ),
  sampled AS (
    SELECT i, seg, ST_Length(seg::geography) AS len, ST_LineInterpolatePoint(seg, 0.5) AS mid FROM segs
  ),
  classed AS (
    -- Syarat && pada ST_ConvexHull memakai indeks GiST bahaya_raster_hull_idx
    -- (ST_Intersects(raster, titik) tidak, dan memeriksa semua 513 petak per titik).
    -- Petak tidak diputar, jadi kotak pembatasnya = cakupannya. Titik tepat di batas
    -- dua petak cukup dihitung sekali.
    SELECT DISTINCT ON (s.i, r.hazard) s.i, r.hazard, ST_Value(r.rast, s.mid) AS kelas, s.len, s.seg
    FROM sampled s JOIN bahaya_raster r ON ST_ConvexHull(r.rast) && s.mid
    ORDER BY s.i, r.hazard, kelas DESC NULLS LAST
  )
  SELECT hazard, kelas::int AS kelas, round(sum(len))::int AS meters,
         CASE WHEN kelas = 3 THEN ST_AsGeoJSON(ST_LineMerge(ST_Collect(seg)), 5)::json END AS geometry
  FROM classed WHERE kelas IS NOT NULL
  GROUP BY hazard, kelas`;

const HAZARDS = ['banjir', 'longsor'];

// { banjir: { tinggi_m, sedang_m, rendah_m }, longsor: {…}, tinggi_m (gabungan),
//   tinggi_geometry: { banjir: MultiLineString|null, longsor: … } }
export async function routeExposure(geometry) {
  const { rows } = await query(EXPOSURE, [JSON.stringify(geometry), SEGMENT_M]);
  const exposure = { tinggi_m: 0, tinggi_geometry: {} };
  for (const hazard of HAZARDS) {
    const of = (kelas) => rows.find((r) => r.hazard === hazard && r.kelas === kelas);
    exposure[hazard] = { tinggi_m: of(3)?.meters ?? 0, sedang_m: of(2)?.meters ?? 0, rendah_m: of(1)?.meters ?? 0 };
    exposure.tinggi_geometry[hazard] = of(3)?.geometry ?? null;
  }
  // Ruas yang tinggi untuk banjir dan longsor sekaligus dihitung dua kali; jarang
  // terjadi karena zona banjir di dataran dan zona longsor di lereng.
  exposure.tinggi_m = exposure.banjir.tinggi_m + exposure.longsor.tinggi_m;
  return exposure;
}

// Bahaya yang kelasnya tinggi di tiap titik (ujung rute, titik evakuasi), urut
// sesuai masukan: [['banjir'], [], …].
const HIGH_ZONES_AT = `
  WITH p AS (
    SELECT i, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS g
    FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS u(lon, lat, i)
  )
  SELECT DISTINCT p.i::int AS i, r.hazard
  FROM p JOIN bahaya_raster r ON ST_ConvexHull(r.rast) && p.g
  WHERE ST_Value(r.rast, p.g) = 3`;

export async function highZonesAt(points) {
  if (!points.length) return [];
  const { rows } = await query(HIGH_ZONES_AT, [points.map((p) => p.lon), points.map((p) => p.lat)]);
  return points.map((_, i) => HAZARDS.filter((hazard) => rows.some((r) => r.i === i + 1 && r.hazard === hazard)));
}

// Petak raster kelas tinggi yang dilewati rute, digabung menjadi blok, untuk
// dihindari Valhalla. Blok dekat titik asal atau tujuan tidak ikut (rute harus tetap
// bisa dimulai dan berakhir), dan blok terkecil dipilih lebih dulu sampai batas
// keliling Valhalla.
const EXCLUSIONS = `
  WITH line AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
  mids AS (
    SELECT ST_LineInterpolatePoint(d.geom, 0.5) AS mid
    FROM line, ST_DumpSegments(ST_Segmentize(line.g::geography, $2)::geometry) AS d
  ),
  pixels AS (
    SELECT DISTINCT ST_PixelAsPolygon(r.rast, ST_WorldToRasterCoordX(r.rast, m.mid), ST_WorldToRasterCoordY(r.rast, m.mid)) AS px
    FROM mids m JOIN bahaya_raster r ON ST_ConvexHull(r.rast) && m.mid
    WHERE ST_Value(r.rast, m.mid) = 3
  ),
  -- Sudut piksel bertetangga bisa berselisih di desimal ke-15 (110,005 vs
  -- 110,00500000000001), jadi diselaraskan ke grid dulu supaya bloknya menyatu.
  blocks AS (SELECT (ST_Dump(ST_Union(ST_SnapToGrid(px, 1e-7)))).geom AS g FROM pixels),
  ends AS (SELECT ST_SetSRID(ST_MakePoint($3, $4), 4326) AS a, ST_SetSRID(ST_MakePoint($5, $6), 4326) AS b)
  SELECT ST_AsGeoJSON(b.g, 6)::json AS geometry, ST_Perimeter(b.g::geography) AS perimeter_m
  FROM blocks b, ends
  WHERE NOT ST_DWithin(b.g::geography, ends.a::geography, $7) AND NOT ST_DWithin(b.g::geography, ends.b::geography, $7)
  ORDER BY perimeter_m`;

const KEEP_CLEAR_OF_ENDS_M = 300;

export async function exclusionRings(geometry, from, to, maxPerimeterM) {
  const { rows } = await query(EXCLUSIONS, [JSON.stringify(geometry), SEGMENT_M, from.lon, from.lat, to.lon, to.lat, KEEP_CLEAR_OF_ENDS_M]);
  const rings = [];
  let total = 0;
  for (const row of rows) {
    if (total + row.perimeter_m > maxPerimeterM) break;
    total += row.perimeter_m;
    rings.push(row.geometry.coordinates[0]);
  }
  return rings;
}
