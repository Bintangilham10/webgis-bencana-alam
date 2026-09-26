import { Router } from 'express';
import { query } from '../db.js';
import { VOLCANO_LEVELS } from '../lib/classify.js';
import { featureCollection } from '../lib/geojson.js';
import { lastSuccessfulSync } from '../sync-logs.js';

export const volcanoesRouter = Router();

volcanoesRouter.get('/volcanoes', async (req, res) => {
  const { rows } = await query(
    `SELECT kode, nama, kabupaten, provinsi, elevasi_m, level, checked_at, level_changed_at,
            ST_AsGeoJSON(geom, 4)::json AS geometry
     FROM volcanoes
     ORDER BY level DESC, nama`,
  );
  res.json(
    featureCollection(rows, ({ geometry, ...v }) => ({ ...v, level_label: VOLCANO_LEVELS[v.level] }), {
      meta: { synced_at: await lastSuccessfulSync('magma') },
    }),
  );
});
