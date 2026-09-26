import { Router } from 'express';
import { query } from '../db.js';
import { sourceStatuses } from '../sync-logs.js';

export const healthRouter = Router();

healthRouter.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
  } catch {
    return res.status(503).json({ ok: false, database: false, sources: [] });
  }
  res.json({ ok: true, database: true, sources: await sourceStatuses() });
});
