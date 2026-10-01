import { query, withTransaction } from '../src/db.js';
import { postForm } from '../src/lib/http.js';
import { hazardClassValue } from '../src/lib/warning-rules.js';
import { loadRawBuffer, readRawJson, writeRawJson } from './raw-cache.js';

// Raster kelas bahaya InaRISK BNPB untuk seluruh Indonesia, dasar indikasi
// SIGAP 3 hari. Server BNPB membagi indeks 0–1 menjadi kelas dengan Remap yang
// sama dengan peta (web/src/layers/hazards.js) dan recorder/src/lib/rules.json:
// 1 rendah (≤ 1/3), 2 sedang (≤ 2/3), 3 tinggi; indeks 0 dan laut menjadi NoData (0).
const SERVICE_URL = 'https://gis.bnpb.go.id/server/rest/services/inarisk';
export const RASTER_HAZARDS = [
  { id: 'banjir', service: 'INDEKS_BAHAYA_BANJIR' },
  { id: 'longsor', service: 'INDEKS_BAHAYA_TANAHLONGSOR' },
];
// 0,005° ≈ 550 m: 9.240 × 3.440 piksel, masih di bawah batas satu permintaan
// exportImage (15.000 × 4.100). Sumbernya 100 m; walau diminta nearest neighbour,
// server menghaluskannya (resampling bawaan bilinear), jadi raster ini dipakai
// untuk statistik zona dan memilih sel, sedangkan kelas titik pantau dicek ulang
// ke nilai aslinya (sampleIndices).
const BBOX = { west: 94.9, south: -11.1, east: 141.1, north: 6.1 };
const PIXEL_DEG = 0.005;
const PIXEL_KM2_AT_EQUATOR = (PIXEL_DEG * 111.32) ** 2;
// Titik pantau: sel 0,25° (±28 km, supaya titik tersebar di kab/kota), minimal
// 3 piksel (±1 km²) kelas itu, paling banyak 3 sel per jenis bahaya per kab/kota.
// Tiap sel punya sampai 16 kandidat titik: piksel kelas itu yang terdekat ke
// pusat sebarannya.
export const CELL_DEG = 0.25;
const MIN_PIXELS = 3;
const MAX_CELLS = 3;
const CANDIDATES = 16;
// getSamples: titik per permintaan dan jeda antarpermintaan (sopan ke server BNPB).
const SAMPLE_BATCH = 500;
const SAMPLE_PAUSE_MS = 1_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Versi Remap ikut menjadi nama berkas cache raster, supaya raster lama (batas
// kelas aturan v0.1: 0,3335 dan 0,6665) tidak terpakai lagi setelah batasnya berubah.
const REMAP_VERSION = 2;
const REMAP = {
  rasterFunction: 'Remap',
  rasterFunctionArguments: { InputRanges: [0, 0.3334, 0.3334, 0.6667, 0.6667, 1.01], OutputValues: [1, 2, 3], NoDataRanges: [-1, 0.0001] },
  outputPixelType: 'U8',
};

export function exportUrl(service) {
  const params = new URLSearchParams({
    bbox: [BBOX.west, BBOX.south, BBOX.east, BBOX.north].join(','),
    bboxSR: '4326',
    imageSR: '4326',
    size: `${Math.round((BBOX.east - BBOX.west) / PIXEL_DEG)},${Math.round((BBOX.north - BBOX.south) / PIXEL_DEG)}`,
    format: 'tiff',
    pixelType: 'U8',
    noData: '0',
    interpolation: 'RSP_NearestNeighbor',
    compression: 'LZW',
    renderingRule: JSON.stringify(REMAP),
    f: 'image',
  });
  return `${SERVICE_URL}/${service}/ImageServer/exportImage?${params}`;
}

// Galat ArcGIS dibalas sebagai JSON; yang diterima hanya GeoTIFF.
export function assertGeoTiff(buffer) {
  const magic = buffer.subarray(0, 4).toString('latin1');
  if (magic !== 'II*\0' && magic !== 'MM\0*') throw new Error(`Balasan bukan GeoTIFF: ${buffer.subarray(0, 160).toString('utf8')}`);
}

// Satu kab/kota, satu jenis bahaya: jumlah piksel per kelas dan kandidat titik
// pantau per sel. Piksel di-clip ke batas (disederhanakan ±100 m, jauh di bawah
// ukuran piksel).
const ZONE_SQL = `
WITH px AS MATERIALIZED (
  SELECT (pc).val::int AS kelas, (pc).geom AS geom,
         floor(ST_X((pc).geom) / $3)::int AS cx, floor(ST_Y((pc).geom) / $3)::int AS cy
  FROM (SELECT ST_SimplifyPreserveTopology(geom, 0.001) AS geom FROM wilayah WHERE kode = $1) w
  JOIN bahaya_raster r ON r.hazard = $2 AND ST_Intersects(r.rast, w.geom)
  CROSS JOIN LATERAL ST_PixelAsCentroids(ST_Clip(r.rast, w.geom, true)) AS pc
),
per_class AS (
  SELECT cx, cy, kelas, count(*)::int AS n, ST_Centroid(ST_Collect(geom)) AS pusat
  FROM px GROUP BY cx, cy, kelas
),
best AS (
  SELECT DISTINCT ON (cx, cy) cx, cy, kelas, n, pusat
  FROM per_class WHERE n >= $4
  ORDER BY cx, cy, kelas DESC, n DESC
),
ranked AS (
  SELECT *, row_number() OVER (ORDER BY kelas DESC, n DESC)::int AS urutan FROM best
)
SELECT 'luas' AS jenis, kelas, count(*)::int AS n, NULL::int AS urutan, NULL::int AS pilihan,
       NULL::float8 AS lon, NULL::float8 AS lat
FROM px GROUP BY kelas
UNION ALL
SELECT 'titik', r.kelas, r.n, r.urutan, c.pilihan, ST_X(c.geom), ST_Y(c.geom)
FROM ranked r
CROSS JOIN LATERAL (
  SELECT geom, row_number() OVER (ORDER BY geom <-> r.pusat)::int AS pilihan
  FROM px WHERE px.kelas = r.kelas AND px.cx = r.cx AND px.cy = r.cy
  ORDER BY geom <-> r.pusat LIMIT $6
) c
WHERE r.urutan <= $5`;

// Kandidat dibulatkan 3 desimal, sama dengan koordinat yang diperiksa cek risiko
// (routes/risk.js); pergeserannya (≤ 55 m) masih di dalam piksel 550 m yang sama.
const round3 = (x) => Math.round(x * 1000) / 1000;

export async function zoneSummary(kode, hazard, { lat }) {
  const { rows } = await query(ZONE_SQL, [kode, hazard, CELL_DEG, MIN_PIXELS, MAX_CELLS, CANDIDATES]);
  const pixelKm2 = PIXEL_KM2_AT_EQUATOR * Math.cos((lat * Math.PI) / 180);
  const km2 = (kelas) => Math.round((rows.find((r) => r.jenis === 'luas' && r.kelas === kelas)?.n ?? 0) * pixelKm2 * 10) / 10;
  const cells = new Map();
  for (const r of rows.filter((row) => row.jenis === 'titik').sort((a, b) => a.urutan - b.urutan || a.pilihan - b.pilihan)) {
    if (!cells.has(r.urutan)) cells.set(r.urutan, { kode, hazard, urutan: r.urutan, kelas: r.kelas, piksel: r.n, candidates: [] });
    cells.get(r.urutan).candidates.push({ lon: round3(r.lon), lat: round3(r.lat) });
  }
  return {
    stats: { kode, hazard, rendah_km2: km2(1), sedang_km2: km2(2), tinggi_km2: km2(3) },
    cells: [...cells.values()],
  };
}

// Nilai getSamples: angka indeks, atau kosong/"NoData" di luar zona bahaya.
export function parseSample(value) {
  if (value === '' || value === 'NoData' || value == null) return null;
  const index = Number.parseFloat(value);
  if (!Number.isFinite(index)) throw new Error(`Nilai sampel tidak valid: ${value}`);
  return index;
}

// Indeks bahaya asli (piksel 100 m) di titik-titik, lewat getSamples ImageServer
// InaRISK. Hasilnya disimpan di data/raw/, jadi seed ulang tidak meminta titik
// yang sama lagi. Mengembalikan indeks (atau null) sesuai urutan titik.
export async function sampleIndices(hazard, points, { log = () => {} } = {}) {
  const { service } = RASTER_HAZARDS.find((h) => h.id === hazard);
  const cacheName = `inarisk-${hazard}-sampel.json`;
  const cache = (await readRawJson(cacheName)) ?? {};
  const key = (p) => `${p.lon},${p.lat}`;
  const missing = [...new Map(points.filter((p) => !(key(p) in cache)).map((p) => [key(p), p])).values()];
  for (let start = 0; start < missing.length; start += SAMPLE_BATCH) {
    if (start > 0) await sleep(SAMPLE_PAUSE_MS);
    const batch = missing.slice(start, start + SAMPLE_BATCH);
    const text = await postForm(
      `${SERVICE_URL}/${service}/ImageServer/getSamples`,
      {
        geometry: JSON.stringify({ points: batch.map((p) => [p.lon, p.lat]), spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryMultipoint',
        returnFirstValueOnly: 'true',
        interpolation: 'RSP_NearestNeighbor',
        f: 'json',
      },
      { timeoutMs: 120_000 },
    );
    const json = JSON.parse(text);
    if (!Array.isArray(json.samples)) throw new Error(`Respons getSamples tidak dikenal: ${text.slice(0, 200)}`);
    // Titik di luar cakupan raster tidak dikembalikan: dianggap di luar zona.
    for (const p of batch) cache[key(p)] = null;
    for (const sample of json.samples) cache[key(batch[sample.locationId])] = parseSample(sample.value);
    await writeRawJson(cacheName, cache);
    log(`sampel ${hazard}: ${Math.min(start + SAMPLE_BATCH, missing.length)}/${missing.length} titik baru`);
  }
  return points.map((p) => cache[key(p)]);
}

// Titik pantau satu sel: kandidat pertama yang kelas aslinya (100 m) setidaknya
// kelas sel; bila tidak ada, kandidat dengan kelas asli tertinggi (kelas titik
// ikut turun); sel tanpa zona asli di semua kandidat dibuang. kelasAt(kandidat)
// → 0 (luar zona) sampai 3. isInside(kandidat) menolak kandidat yang setelah
// dibulatkan 3 desimal jatuh di luar kab/kotanya (batas yang di-clip disederhanakan).
export function pickPoint(cell, kelasAt, isInside = () => true) {
  let best = null;
  for (const candidate of cell.candidates) {
    if (!isInside(candidate)) continue;
    const kelas = kelasAt(candidate);
    if (kelas >= cell.kelas) return { ...candidate, kelas };
    if (kelas > (best?.kelas ?? 0)) best = { ...candidate, kelas };
  }
  return best;
}

// GeoTIFF nasional → petak 256 × 256 di PostGIS; petak yang seluruhnya NoData
// (laut) dibuang. GDAL di PostGIS mati bawaan, jadi driver GTiff dinyalakan
// hanya untuk transaksi ini.
export async function loadRaster(hazard, tiff) {
  await withTransaction(async (client) => {
    await client.query("SET LOCAL postgis.gdal_enabled_drivers = 'GTiff'");
    await client.query('DELETE FROM bahaya_raster WHERE hazard = $1', [hazard]);
    await client.query('INSERT INTO bahaya_raster (hazard, rast) SELECT $1, ST_Tile(ST_FromGDALRaster($2::bytea), 256, 256)', [hazard, tiff]);
    await client.query('DELETE FROM bahaya_raster WHERE hazard = $1 AND ST_BandIsNoData(rast, 1, true)', [hazard]);
  });
}

// Kandidat (koordinat 3 desimal) yang benar-benar di dalam poligon kab/kotanya.
// Sebelum pemeriksaan ini, 4 dari 3.222 titik pantau berada 7–46 m di luar
// kab/kotanya karena clip memakai batas yang disederhanakan ±100 m.
export async function insideCandidates(cells) {
  const items = cells.flatMap((cell) => cell.candidates.map((c) => ({ kode: cell.kode, lon: c.lon, lat: c.lat })));
  if (!items.length) return () => true;
  const { rows } = await query(
    `SELECT t.kode, t.lon, t.lat
     FROM unnest($1::text[], $2::float8[], $3::float8[]) AS t(kode, lon, lat)
     JOIN wilayah w ON w.kode = t.kode
     WHERE ST_Intersects(w.geom, ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326))`,
    [items.map((i) => i.kode), items.map((i) => i.lon), items.map((i) => i.lat)],
  );
  const inside = new Set(rows.map((r) => `${r.kode}|${r.lon},${r.lat}`));
  return (kode) => (candidate) => inside.has(`${kode}|${candidate.lon},${candidate.lat}`);
}

// Titik pantau dan statistik zona disimpan ulang seluruhnya dalam satu transaksi.
export async function saveZones(stats, points) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM titik_pantau');
    await client.query('DELETE FROM wilayah_bahaya');
    await client.query(
      `INSERT INTO wilayah_bahaya (kode, hazard, rendah_km2, sedang_km2, tinggi_km2)
       SELECT * FROM unnest($1::text[], $2::text[], $3::real[], $4::real[], $5::real[])`,
      [stats.map((s) => s.kode), stats.map((s) => s.hazard), stats.map((s) => s.rendah_km2), stats.map((s) => s.sedang_km2), stats.map((s) => s.tinggi_km2)],
    );
    await client.query(
      `INSERT INTO titik_pantau (kode, hazard, urutan, kelas, piksel, geom)
       SELECT kode, hazard, urutan, kelas, piksel, ST_SetSRID(ST_MakePoint(lon, lat), 4326)
       FROM unnest($1::text[], $2::text[], $3::smallint[], $4::smallint[], $5::int[], $6::float8[], $7::float8[])
         AS t(kode, hazard, urutan, kelas, piksel, lon, lat)`,
      [
        points.map((p) => p.kode), points.map((p) => p.hazard), points.map((p) => p.urutan), points.map((p) => p.kelas),
        points.map((p) => p.piksel), points.map((p) => p.lon), points.map((p) => p.lat),
      ],
    );
  });
}

// Statistik zona dan titik pantau untuk semua kab/kota dari raster yang sudah dimuat.
// Raster 550 m dihaluskan server BNPB (resampling bilinear), jadi zona sempit
// seperti banjir di sepanjang sungai tampak lebih lebar dari aslinya. Karena itu
// kelas titik pantau diambil dari nilai asli 100 m (sample), sama dengan yang
// dibaca cek risiko di titik itu. Titik acuan (di dalam poligon) tiap kab/kota
// juga dipantau hujannya, supaya kab/kota tanpa zona bahaya tetap punya
// indikasi hujan lebat.
export async function computeZones({ log = () => {}, sample = sampleIndices } = {}) {
  const { rows: regions } = await query(
    `SELECT kode, ST_X(titik) AS lon, ST_Y(titik) AS lat FROM wilayah WHERE tingkat <> 'provinsi' ORDER BY kode`,
  );
  const stats = [];
  const cells = [];
  const points = regions.map((r) => ({ kode: r.kode, hazard: 'acuan', urutan: 1, kelas: 0, piksel: 0, lon: r.lon, lat: r.lat }));
  for (const [index, region] of regions.entries()) {
    for (const { id } of RASTER_HAZARDS) {
      const zone = await zoneSummary(region.kode, id, region);
      stats.push(zone.stats);
      cells.push(...zone.cells);
    }
    if ((index + 1) % 100 === 0) log(`zona bahaya: ${index + 1}/${regions.length} kab/kota`);
  }

  const insideOf = await insideCandidates(cells);
  for (const { id } of RASTER_HAZARDS) {
    const hazardCells = cells.filter((cell) => cell.hazard === id);
    // Kandidat yang dibulatkan ke luar kab/kotanya tidak pernah dipakai.
    const usable = new Map(hazardCells.map((cell) => [cell, cell.candidates.filter(insideOf(cell.kode))]));
    // Tahap 1: kandidat pertama tiap sel; tahap 2: kandidat lain untuk sel yang belum cocok.
    const kelas = new Map();
    const measure = async (candidates) => {
      const indices = await sample(id, candidates, { log });
      candidates.forEach((candidate, k) => kelas.set(candidate, hazardClassValue(indices[k])));
    };
    await measure(hazardCells.map((cell) => usable.get(cell)[0]).filter(Boolean));
    const pending = hazardCells.filter((cell) => usable.get(cell).length && kelas.get(usable.get(cell)[0]) < cell.kelas);
    await measure(pending.flatMap((cell) => usable.get(cell).slice(1)));

    const tally = { cocok: 0, turun: 0, dibuang: 0 };
    for (const cell of hazardCells) {
      const point = pickPoint(cell, (candidate) => kelas.get(candidate), insideOf(cell.kode));
      if (!point) {
        tally.dibuang++;
        continue;
      }
      tally[point.kelas < cell.kelas ? 'turun' : 'cocok']++;
      points.push({ kode: cell.kode, hazard: id, urutan: cell.urutan, kelas: point.kelas, piksel: cell.piksel, lon: point.lon, lat: point.lat });
    }
    log(`titik pantau ${id}: ${tally.cocok} cocok, ${tally.turun} kelasnya turun, ${tally.dibuang} dibuang (kandidat di luar zona asli)`);
  }
  return { stats, points };
}

export async function seedBahaya({ log = console.log } = {}) {
  for (const { id, service } of RASTER_HAZARDS) {
    const tiff = await loadRawBuffer(`inarisk-${id}-kelas-v${REMAP_VERSION}.tif`, exportUrl(service), { validate: assertGeoTiff });
    await loadRaster(id, tiff);
    log(`raster ${id}: ${Math.round(tiff.length / 1024)} KB dimuat`);
  }
  const { stats, points } = await computeZones({ log });
  await saveZones(stats, points);
  return points.length;
}
