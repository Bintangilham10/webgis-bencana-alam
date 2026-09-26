import { query } from '../db.js';
import { fetchBmkgEarthquakes } from '../sources/bmkg-gempa.js';

// Baris hanya diperbarui bila ada perubahan, supaya updated_at mencerminkan
// revisi BMKG (mis. magnitudo dikoreksi), bukan sekadar sinkronisasi ulang.
const UPSERT_EVENT = `
  INSERT INTO events (id, source, hazard, magnitude, depth_km, occurred_at, props, geom)
  VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($8, $9), 4326))
  ON CONFLICT (id) DO UPDATE SET
    magnitude = EXCLUDED.magnitude,
    depth_km = EXCLUDED.depth_km,
    props = events.props || EXCLUDED.props,
    geom = EXCLUDED.geom,
    updated_at = now()
  WHERE (events.magnitude, events.depth_km) IS DISTINCT FROM (EXCLUDED.magnitude, EXCLUDED.depth_km)
     OR NOT ST_Equals(events.geom, EXCLUDED.geom)
     OR NOT (events.props @> EXCLUDED.props)`;

export async function syncEarthquakes({ fetchEvents = fetchBmkgEarthquakes } = {}) {
  const { events, errors } = await fetchEvents();
  for (const e of events) {
    await query(UPSERT_EVENT, [
      e.id, e.source, e.hazard, e.magnitude, e.depthKm, e.occurredAt, e.props, e.lon, e.lat,
    ]);
  }
  return { items: events.length, message: errors.length ? errors.join('; ') : null };
}
