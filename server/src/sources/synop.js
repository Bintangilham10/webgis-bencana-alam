import { readFileSync } from 'node:fs';
import { decodeSynopReport, reportedRain } from '../lib/recorder.js';

// Hujan terukur di stasiun cuaca BMKG. Alat ukurnya (penakar hujan, termometer,
// pengamat cuaca) ada di Indonesia; laporannya (SYNOP) dipertukarkan lewat
// jaringan WMO dan diambil SIGAP dari gerbang NOAA/NWS di Amerika Serikat, karena
// BMKG tidak membuka data mentah stasiunnya untuk umum. Pembaca sandinya dipakai
// bersama dengan perekam arsip (recorder/src/lib/synop.js).
export const ATTRIBUTION =
  'Hujan terukur: stasiun cuaca BMKG, laporan SYNOP lewat jaringan WMO (gerbang NOAA/NWS); daftar stasiun WMO OSCAR/Surface';

// Daftar stasiun dari registri WMO (npm run build:stasiun).
const STATION_FILE = new URL('../../data/stasiun-cuaca.json', import.meta.url);
export const STATIONS = new Map(JSON.parse(readFileSync(STATION_FILE, 'utf8')).map((station) => [station.wmo, station]));

const SIX_HOURS_MS = 6 * 3_600_000;
const round1 = (value) => Math.round(value * 10) / 10;
const isMainHour = (date) => date.getUTCHours() % 6 === 0 && date.getUTCMinutes() === 0;

// Laporan mentah dari gerbang NOAA → kolom tabel synop_reports. Laporan yang
// tidak terbaca (kelompok wajibnya rusak) dilewati.
export function toRow({ wmo, observed_at: observedAt, bulletin, raw, file_modified_at: sourceFileAt }) {
  const decoded = decodeSynopReport(raw);
  if (!decoded) return null;
  const rain = reportedRain(decoded, new Date(observedAt).getUTCHours());
  return {
    wmo,
    observedAt,
    rainMm: rain?.mm ?? null,
    rainHours: rain?.hours ?? null,
    rainTrace: rain?.trace ?? false,
    weather: decoded.weather,
    tempC: decoded.tempC,
    tempMaxC: decoded.tempMaxC,
    tempMinC: decoded.tempMinC,
    bulletin,
    raw,
    sourceFileAt,
  };
}

// Hujan per 6 jam satu stasiun dari laporan jam utama (00, 06, 12, 18 UTC):
// Map(waktu akhir jendela dalam ms → { mm, trace }).
// Laporan 06/12/18 UTC memuat hujan 6 jam. Laporan 00 UTC memuat total 24 jam,
// jadi jendela 18–00 UTC = total itu dikurangi tiga jendela sebelumnya (bila
// ketiganya ada).
export function sixHourAmounts(rows) {
  const amounts = new Map();
  const mainRows = rows.filter((row) => isMainHour(row.observed_at) && row.rain_mm !== null);
  for (const row of [...mainRows].sort((a, b) => a.observed_at - b.observed_at)) {
    const at = row.observed_at.getTime();
    if (row.rain_hours === 6) {
      amounts.set(at, { mm: row.rain_mm, trace: row.rain_trace });
    } else if (row.rain_hours === 24) {
      const earlier = [1, 2, 3].map((k) => amounts.get(at - k * SIX_HOURS_MS));
      if (earlier.every(Boolean)) {
        const mm = Math.max(0, round1(row.rain_mm - earlier.reduce((sum, amount) => sum + amount.mm, 0)));
        amounts.set(at, { mm, trace: mm === 0 && row.rain_trace });
      }
    }
  }
  return amounts;
}

// Akumulasi hujan satu stasiun sampai jam utama `until`: 24 jam bila datanya
// lengkap, lebih pendek bila laporan sebelumnya tidak ada (hours < 24), null
// bila stasiun tidak melaporkan hujan pada `until`.
export function accumulatedRain(rows, until) {
  const at = until.getTime();
  const exact = rows.find((row) => row.observed_at.getTime() === at);
  if (exact?.rain_hours === 24 && exact.rain_mm !== null) return { mm: exact.rain_mm, hours: 24, trace: exact.rain_trace };
  const amounts = sixHourAmounts(rows);
  let mm = 0;
  let hours = 0;
  let trace = false;
  for (let k = 0; k < 4; k++) {
    const amount = amounts.get(at - k * SIX_HOURS_MS);
    if (!amount) break;
    mm += amount.mm;
    hours += 6;
    trace ||= amount.trace;
  }
  return hours ? { mm: round1(mm), hours, trace: mm === 0 && trace } : null;
}

// Total harian versi BMKG (24 jam yang berakhir 00 UTC = 07.00 WIB), dari yang lama.
export function dailyTotals(rows) {
  return rows
    .filter((row) => isMainHour(row.observed_at) && row.observed_at.getUTCHours() === 0 && row.rain_hours === 24 && row.rain_mm !== null)
    .sort((a, b) => a.observed_at - b.observed_at)
    .map((row) => ({ until: row.observed_at.toISOString(), mm: row.rain_mm, trace: row.rain_trace }));
}

// Jam utama terakhir yang laporannya sudah masuk dari cukup banyak stasiun,
// supaya semua stasiun di peta memakai periode yang sama. Beberapa menit pertama
// sesudah jam utama baru sebagian buletin yang tiba; selama itu peta tetap
// memakai jam utama sebelumnya. counts: [{ observed_at, stations }].
export function latestMainHour(counts, minStations = 10) {
  const main = counts.filter((entry) => isMainHour(entry.observed_at)).sort((a, b) => b.observed_at - a.observed_at);
  return (main.find((entry) => entry.stations >= minStations) ?? main[0])?.observed_at ?? null;
}
