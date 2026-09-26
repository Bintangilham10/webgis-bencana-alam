import { withTransaction } from '../src/db.js';
import { loadRaw } from './raw-cache.js';

// Model sesar kerak dangkal PuSGeN 2024, dipublikasikan lewat layanan InaRISK BNPB.
const PUSGEN_URL =
  'https://gis.bnpb.go.id/server/rest/services/inarisk/Faults_new/MapServer/1/query' +
  '?where=1%3D1&outFields=FID,Name,Segment,Region,Type,Mmax,Sliprate_m,Length_km&outSR=4326&f=geojson';

const toNumber = (value) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
};

const UPSERT = `
  INSERT INTO faults (id, nama, segmen, region, tipe, mmax, slip_rate_mm_per_year, panjang_km, geom)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($9), 4326)))
  ON CONFLICT (id) DO UPDATE SET
    nama = EXCLUDED.nama, segmen = EXCLUDED.segmen, region = EXCLUDED.region, tipe = EXCLUDED.tipe,
    mmax = EXCLUDED.mmax, slip_rate_mm_per_year = EXCLUDED.slip_rate_mm_per_year,
    panjang_km = EXCLUDED.panjang_km, geom = EXCLUDED.geom`;

export async function seedFaults() {
  const { features } = JSON.parse(await loadRaw('pusgen2024.geojson', PUSGEN_URL));
  const usable = features.filter((f) => f.geometry);

  await withTransaction(async (client) => {
    for (const { properties: p, geometry } of usable) {
      await client.query(UPSERT, [
        p.FID, p.Name, p.Segment, p.Region, p.Type,
        toNumber(p.Mmax), toNumber(p.Sliprate_m), toNumber(p.Length_km), JSON.stringify(geometry),
      ]);
    }
  });
  return usable.length;
}
