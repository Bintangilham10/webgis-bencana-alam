import { Router } from 'express';
import { query } from '../db.js';
import { featureCollection } from '../lib/geojson.js';
import { ATTRIBUTION } from '../sources/bmkg-cap.js';
import { lastSuccessfulSync } from '../sync-logs.js';

export const capRouter = Router();

// Peringatan dini cuaca BMKG yang sedang berlaku, beserta kab/kota yang terkena.
// Koordinat CAP BMKG berpresisi 3 desimal, jadi GeoJSON juga 3 desimal.
const ACTIVE_ALERTS = `
  SELECT a.identifier, a.event, a.severity, a.urgency, a.certainty, a.headline, a.description, a.area_desc,
         a.web, a.sent, a.effective, a.expires, a.utc_offset, a.first_seen_at,
         ST_AsGeoJSON(a.geom, 3)::json AS geometry,
         coalesce(json_agg(json_build_object('kode', w.kode, 'nama', w.nama) ORDER BY w.nama)
                  FILTER (WHERE w.kode IS NOT NULL), '[]') AS wilayah
  FROM cap_alerts a
  LEFT JOIN cap_alert_wilayah aw USING (identifier)
  LEFT JOIN wilayah w ON w.kode = aw.kode
  WHERE a.expires > now() AND a.superseded_at IS NULL
  GROUP BY a.identifier
  ORDER BY a.sent DESC`;

capRouter.get('/cap', async (req, res) => {
  const { rows } = await query(ACTIVE_ALERTS);
  res.json(
    featureCollection(rows, ({ geometry, ...properties }) => properties, {
      attribution: ATTRIBUTION,
      meta: { count: rows.length, synced_at: await lastSuccessfulSync('bmkg-cap') },
    }),
  );
});
