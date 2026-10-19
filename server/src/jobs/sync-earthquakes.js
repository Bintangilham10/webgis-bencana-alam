import { query } from '../db.js';
import { fetchBmkgEarthquakes } from '../sources/bmkg-gempa.js';
import { fetchUsgsDetail, fetchUsgsEarthquakes } from '../sources/usgs-gempa.js';
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

// Detail PAGER dan ground failure diambil ulang hanya bila gempanya direvisi USGS
// (field `updated` di feed berubah), paling sering tiap 10 menit per gempa karena
// laporan warga (DYFI) bisa merevisi gempa besar tiap menit. Paling banyak 5 detail
// per sinkronisasi; sisanya menyusul semenit kemudian.
const DETAIL_REFRESH_MS = 10 * 60_000;
const MAX_DETAILS_PER_RUN = 5;

const MERGE_DETAIL = 'UPDATE events SET props = props || $2::jsonb, updated_at = now() WHERE id = $1';
// Detail yang gagal dicatat waktunya saja, supaya dicoba lagi 10 menit kemudian, bukan tiap menit.
const MARK_DETAIL_ATTEMPT = 'UPDATE events SET props = props || $2::jsonb WHERE id = $1';

async function syncUsgsDetails(events, { fetchDetail, now }) {
  const candidates = events.filter((e) => e.hasDetail && e.revision !== null);
  if (!candidates.length) return { fetched: 0, errors: [] };
  const { rows } = await query(
    `SELECT id, props->>'detail_revision' AS revision, props->>'detail_fetched_at' AS fetched_at
     FROM events WHERE id = ANY($1)`,
    [candidates.map((e) => e.id)],
  );
  const stored = new Map(rows.map((r) => [r.id, r]));
  const due = candidates
    .filter((e) => {
      const s = stored.get(e.id);
      if (!s?.fetched_at) return true;
      return s.revision !== String(e.revision) && now - new Date(s.fetched_at).getTime() >= DETAIL_REFRESH_MS;
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, MAX_DETAILS_PER_RUN);

  const errors = [];
  const fetchedAt = new Date(now).toISOString();
  for (const e of due) {
    try {
      const detail = await fetchDetail(e.code);
      await query(MERGE_DETAIL, [e.id, { ...detail, detail_revision: String(e.revision), detail_fetched_at: fetchedAt }]);
    } catch (err) {
      errors.push(`detail ${e.code}: ${err.message}`);
      await query(MARK_DETAIL_ATTEMPT, [e.id, { detail_fetched_at: fetchedAt }]);
    }
  }
  return { fetched: due.length - errors.length, errors };
}

// Gempa USGS disimpan di tabel yang sama dengan source 'usgs'; tampilan BMKG
// dan cek risiko hanya membaca source 'bmkg', jadi gempa yang sama tidak terhitung dua kali.
export async function syncUsgsEarthquakes({ fetchEvents = fetchUsgsEarthquakes, fetchDetail = fetchUsgsDetail, now = Date.now() } = {}) {
  const last = await lastSuccessfulSync('usgs-gempa');
  const feed = last && now - new Date(last).getTime() < USGS_BACKFILL_AFTER_MS ? 'day' : 'week';
  const fetched = await fetchEvents({ feed });
  const result = await syncEarthquakes({ fetchEvents: async () => fetched });
  // Detail yang gagal tidak menggagalkan sinkronisasi gempa; dicatat di pesan dan dicoba lagi berikutnya.
  const details = await syncUsgsDetails(fetched.events, { fetchDetail, now });
  const messages = [result.message, ...details.errors].filter(Boolean);
  return { items: result.items, message: messages.length ? messages.join('; ') : null };
}
