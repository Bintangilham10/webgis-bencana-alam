import { query } from './db.js';

export async function recordSync({ source, ok, items, message, startedAt, durationMs }) {
  await query(
    'INSERT INTO sync_logs (source, ok, items, message, started_at, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)',
    [source, ok, items, message, startedAt, durationMs],
  );
}

export async function lastSuccessfulSync(source) {
  const { rows } = await query('SELECT max(started_at) AS at FROM sync_logs WHERE source = $1 AND ok', [source]);
  return rows[0].at;
}

// Status terakhir tiap sumber + kapan terakhir berhasil, untuk halaman kesehatan.
export async function sourceStatuses() {
  const { rows } = await query(`
    SELECT DISTINCT ON (l.source)
           l.source, l.ok, l.items, l.message, l.started_at AS last_run_at, l.duration_ms,
           s.last_ok_at, s.runs_24h, s.failures_24h
    FROM sync_logs l
    JOIN (
      SELECT source,
             max(started_at) FILTER (WHERE ok) AS last_ok_at,
             count(*) FILTER (WHERE started_at > now() - interval '24 hours') AS runs_24h,
             count(*) FILTER (WHERE NOT ok AND started_at > now() - interval '24 hours') AS failures_24h
      FROM sync_logs GROUP BY source
    ) s USING (source)
    ORDER BY l.source, l.started_at DESC`);
  return rows.map((row) => ({ ...row, runs_24h: Number(row.runs_24h), failures_24h: Number(row.failures_24h) }));
}
