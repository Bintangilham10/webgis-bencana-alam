import { query } from '../db.js';
import { fetchText } from '../lib/http.js';
import { fetchSynopReports } from '../lib/recorder.js';
import { toRow } from '../sources/synop.js';

// Laporan koreksi (isi berbeda untuk stasiun dan jam yang sama) menimpa laporan
// lama selama berasal dari berkas yang sama atau lebih baru; first_seen_at tetap.
const UPSERT_REPORT = `
  INSERT INTO synop_reports
    (wmo, observed_at, rain_mm, rain_hours, rain_trace, weather, temp_c, temp_max_c, temp_min_c, bulletin, raw, source_file_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (wmo, observed_at) DO UPDATE SET
    rain_mm = EXCLUDED.rain_mm,
    rain_hours = EXCLUDED.rain_hours,
    rain_trace = EXCLUDED.rain_trace,
    weather = EXCLUDED.weather,
    temp_c = EXCLUDED.temp_c,
    temp_max_c = EXCLUDED.temp_max_c,
    temp_min_c = EXCLUDED.temp_min_c,
    bulletin = EXCLUDED.bulletin,
    raw = EXCLUDED.raw,
    source_file_at = EXCLUDED.source_file_at,
    updated_at = now()
  WHERE synop_reports.raw IS DISTINCT FROM EXCLUDED.raw
    AND EXCLUDED.source_file_at >= synop_reports.source_file_at`;

// Gerbang NOAA menyimpan ±25 jam berkas 5 menitan. Tiap sinkronisasi hanya
// membaca berkas yang diubah sejak sinkronisasi sebelumnya; batasnya diingat di
// memori dan, setelah server dimulai ulang, diambil dari laporan terakhir yang
// tersimpan. Server yang baru dipasang (atau mati lebih dari sehari) membaca
// semua berkas yang masih ada (±300 berkas, ±5 MB).
export function createSynopSync({ fetchReports = fetchSynopReports, getText = fetchText } = {}) {
  let lastFileAt;
  return async function syncSynop() {
    if (lastFileAt === undefined) {
      const { rows } = await query('SELECT max(source_file_at) AS at FROM synop_reports');
      lastFileAt = rows[0].at?.toISOString() ?? null;
    }
    const { reports, latest, errors } = await fetchReports({ fetchText: getText, since: lastFileAt });
    for (const report of reports) {
      const row = toRow(report);
      if (!row) continue;
      await query(UPSERT_REPORT, [
        row.wmo, row.observedAt, row.rainMm, row.rainHours, row.rainTrace, row.weather,
        row.tempC, row.tempMaxC, row.tempMinC, row.bulletin, row.raw, row.sourceFileAt,
      ]);
    }
    lastFileAt = latest;
    return { items: reports.length, message: errors.length ? errors.join('; ') : null };
  };
}
