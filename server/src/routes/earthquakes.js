import { Router } from 'express';
import { query } from '../db.js';
import { depthClass, hasTsunamiPotential } from '../lib/classify.js';
import { featureCollection } from '../lib/geojson.js';
import { lastSuccessfulSync } from '../sync-logs.js';

export const earthquakesRouter = Router();

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

earthquakesRouter.get('/earthquakes', async (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || DEFAULT_DAYS, 1), MAX_DAYS);
  const { rows } = await query(
    `SELECT id, source, magnitude, depth_km, occurred_at, first_seen_at, props,
            ST_AsGeoJSON(geom, 4)::json AS geometry
     FROM events
     WHERE hazard = 'gempa' AND occurred_at >= now() - make_interval(days => $1)
     ORDER BY occurred_at DESC`,
    [days],
  );

  res.json(
    featureCollection(
      rows,
      (r) => ({
        id: r.id,
        source: r.source.toUpperCase(),
        magnitude: r.magnitude,
        depth_km: r.depth_km,
        depth_class: depthClass(r.depth_km),
        occurred_at: r.occurred_at,
        first_seen_at: r.first_seen_at,
        wilayah: r.props.wilayah ?? null,
        potensi: r.props.potensi ?? null,
        tsunami: hasTsunamiPotential(r.props.potensi),
        dirasakan: r.props.dirasakan ?? null,
        shakemap: r.props.shakemap ?? null,
      }),
      { meta: { days, synced_at: await lastSuccessfulSync('bmkg-gempa') } },
    ),
  );
});
