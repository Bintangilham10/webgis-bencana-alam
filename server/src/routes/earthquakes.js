import { Router } from 'express';
import { query } from '../db.js';
import { depthClass, hasTsunamiPotential } from '../lib/classify.js';
import { featureCollection } from '../lib/geojson.js';
import { lastSuccessfulSync } from '../sync-logs.js';

export const earthquakesRouter = Router();

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

// source = katalog yang ditampilkan; pasangannya dicari di katalog lainnya.
const SOURCES = {
  bmkg: { sync: 'bmkg-gempa', other: 'usgs' },
  usgs: { sync: 'usgs-gempa', other: 'bmkg', attribution: 'Gempa: U.S. Geological Survey (USGS)' },
};

// Gempa yang sama di dua katalog: waktu berselisih ≤ 60 detik dan pusatnya ≤ 100 km.
// Dari 62 pasangan BMKG–USGS (Sep–Okt 2026), 59 berselisih ≤ 10 detik dan 61 ≤ 60
// detik; jarak pusatnya median 15 km, paling jauh 94 km.
const MATCH_SECONDS = 60;
const MATCH_METERS = 100_000;

const QUAKES = `
  SELECT e.id, e.source, e.magnitude, e.depth_km, e.occurred_at, e.first_seen_at, e.props,
         ST_AsGeoJSON(e.geom, 4)::json AS geometry, m.match
  FROM events e
  LEFT JOIN LATERAL (
    SELECT json_build_object(
             'id', o.id,
             'magnitude', o.magnitude,
             'mag_type', o.props->>'mag_type',
             'url', o.props->>'url',
             'time_diff_s', round(extract(epoch FROM o.occurred_at - e.occurred_at)::numeric, 1),
             'distance_km', round((ST_Distance(o.geom::geography, e.geom::geography) / 1000)::numeric, 1)
           ) AS match
    FROM events o
    WHERE o.hazard = 'gempa' AND o.source = $3
      AND o.occurred_at BETWEEN e.occurred_at - make_interval(secs => $4) AND e.occurred_at + make_interval(secs => $4)
      AND ST_DWithin(o.geom::geography, e.geom::geography, $5)
    ORDER BY abs(extract(epoch FROM o.occurred_at - e.occurred_at)), ST_Distance(o.geom::geography, e.geom::geography)
    LIMIT 1
  ) m ON true
  WHERE e.hazard = 'gempa' AND e.source = $2 AND e.occurred_at >= now() - make_interval(days => $1)
  ORDER BY e.occurred_at DESC`;

const common = (r) => ({
  id: r.id,
  source: r.source.toUpperCase(),
  magnitude: r.magnitude,
  depth_km: r.depth_km,
  depth_class: depthClass(r.depth_km),
  occurred_at: r.occurred_at,
  first_seen_at: r.first_seen_at,
  wilayah: r.props.wilayah ?? null,
});

const PROPERTIES = {
  bmkg: (r) => ({
    ...common(r),
    potensi: r.props.potensi ?? null,
    tsunami: hasTsunamiPotential(r.props.potensi),
    dirasakan: r.props.dirasakan ?? null,
    shakemap: r.props.shakemap ?? null,
    usgs: r.match,
  }),
  // wilayah USGS berbahasa Inggris, mis. "55 km NNW of Ruteng, Indonesia".
  usgs: (r) => ({
    ...common(r),
    mag_type: r.props.mag_type ?? null,
    status: r.props.status ?? null,
    alert: r.props.alert ?? null,
    url: r.props.url ?? null,
    bmkg: r.match,
  }),
};

earthquakesRouter.get('/earthquakes', async (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || DEFAULT_DAYS, 1), MAX_DAYS);
  const source = req.query.source ?? 'bmkg';
  if (!Object.hasOwn(SOURCES, source)) {
    return res.status(400).json({ error: 'Parameter source harus bmkg atau usgs' });
  }
  const { sync, other, attribution } = SOURCES[source];
  const { rows } = await query(QUAKES, [days, source, other, MATCH_SECONDS, MATCH_METERS]);

  res.json(
    featureCollection(rows, PROPERTIES[source], {
      ...(attribution && { attribution }),
      meta: { days, source, synced_at: await lastSuccessfulSync(sync) },
    }),
  );
});
