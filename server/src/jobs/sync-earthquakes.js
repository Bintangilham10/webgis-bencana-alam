import { query } from '../db.js';
import { fetchBmkgEarthquakes } from '../sources/bmkg-gempa.js';
import { fetchUsgsEarthquakes } from '../sources/usgs-gempa.js';
import { lastSuccessfulSync } from '../sync-logs.js';

// Feed USGS harian hanya memuat 24 jam terakhir. Bila sinkronisasi USGS terakhir
// yang berhasil lebih lama dari ini (atau belum pernah), feed mingguan diambil
// supaya gempa saat server mati tetap terisi.
const USGS_BACKFILL_AFTER_MS = 20 * 60 * 60_000;

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

// Gempa USGS disimpan di tabel yang sama dengan source 'usgs'; tampilan BMKG
// dan cek risiko hanya membaca source 'bmkg', jadi gempa yang sama tidak terhitung dua kali.
export async function syncUsgsEarthquakes({ fetchEvents = fetchUsgsEarthquakes, now = Date.now() } = {}) {
  const last = await lastSuccessfulSync('usgs-gempa');
  const feed = last && now - new Date(last).getTime() < USGS_BACKFILL_AFTER_MS ? 'day' : 'week';
  return syncEarthquakes({ fetchEvents: () => fetchEvents({ feed }) });
}
