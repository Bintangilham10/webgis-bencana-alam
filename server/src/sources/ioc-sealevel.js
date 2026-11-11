import { readFileSync } from 'node:fs';
import { fetchJson } from '../lib/http.js';

// Muka laut waktu nyata dari alat pasang surut di pelabuhan Indonesia, lewat
// Sea Level Station Monitoring Facility milik IOC–UNESCO (dikelola VLIZ, Belgia).
// Alatnya terpasang di Indonesia (jaringan pasang surut nasional); datanya
// dikirim tiap menit ke jaringan pemantauan tsunami Samudra Hindia dan Pasifik
// dan dibuka untuk umum di sana. Dipakai sebagai pengamatan langsung muka laut:
// pasang surut, rob, dan gelombang tsunami bila ada.
const SERVICE_URL = 'https://www.ioc-sealevelmonitoring.org/service.php';
export const ATTRIBUTION = 'Muka laut: alat pasang surut Indonesia lewat IOC–UNESCO Sea Level Station Monitoring Facility (VLIZ)';

export const stationPageUrl = (code) => `https://www.ioc-sealevelmonitoring.org/station.php?code=${encodeURIComponent(code)}`;
export const stationListUrl = () => `${SERVICE_URL}?query=stationlist`;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
// Jendela pencocokan pasang surut dan bagian yang ditampilkan.
export const FIT_HOURS = 15;
export const SHOW_HOURS = 12;
// Alat yang sampel terakhirnya lebih lama dari ini tidak lagi dianggap aktif.
const ACTIVE_WITHIN_MS = 30 * MINUTE_MS;
// Jendela data terbaru yang diperiksa untuk status tiap alat (jam).
const STATUS_HOURS = 1.5;
const STATUS_CONCURRENCY = 6;

// Waktu IOC "2026-11-11 12:01:00" (UTC) → ms.
const utcMs = (stamp) => (stamp ? Date.parse(`${String(stamp).slice(0, 19).replace(' ', 'T')}Z`) : Number.NaN);

// ---------- Daftar alat ----------

// Daftar stasiun IOC (seluruh dunia, beberapa baris per stasiun) → alat pasang
// surut Indonesia yang pengukur muka lautnya (satuan meter) mengirim data dalam
// `withinMs` terakhir. Dipakai scripts/build-alat-pasut.js untuk membuat daftar
// statis: daftar IOC ±1,9 MB dan butuh 4–5 detik, terlalu berat untuk diambil
// tiap kali lapisan dibuka. Nama sensor di daftar ini tidak selalu cocok dengan
// datanya (Benoa tertulis "prs" tetapi mengirim "rad"), jadi sensor dipilih dari
// datanya (chooseSensor).
export function indonesianStations(list, now = Date.now(), { withinMs = 7 * 24 * HOUR_MS } = {}) {
  if (!Array.isArray(list)) throw new Error('format daftar stasiun IOC tidak dikenal: bukan daftar');
  const latest = new Map();
  for (const row of list) {
    const lastMs = utcMs(row.lasttime);
    if (row.country !== 'IDN' || row.units !== 'M' || !Number.isFinite(lastMs) || now - lastMs > withinMs) continue;
    if (![row.Lat, row.Lon].every(Number.isFinite)) continue;
    if (lastMs > (latest.get(row.Code)?.lastMs ?? -Infinity)) latest.set(row.Code, { row, lastMs });
  }
  return [...latest.values()]
    .map(({ row, lastMs }) => ({ code: row.Code, nama: row.Location, lat: row.Lat, lon: row.Lon, last_at: new Date(lastMs).toISOString() }))
    .sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
}

// Daftar statis alat pasang surut Indonesia (npm run build:pasut).
const STATION_FILE = new URL('../../data/alat-pasang-surut.json', import.meta.url);
export const STATIONS = JSON.parse(readFileSync(STATION_FILE, 'utf8'));

export function seriesUrl(code, { now = Date.now(), hours = FIT_HOURS } = {}) {
  const stamp = (ms) => new Date(ms).toISOString().slice(0, 16);
  return `${SERVICE_URL}?${new URLSearchParams({ query: 'data', code, timestart: stamp(now - hours * HOUR_MS), timestop: stamp(now), format: 'json' })}`;
}

// Sensor yang bukan pengukur muka laut: baterai, sakelar, tekanan udara, suhu.
const NOT_LEVEL = /^(bat|sw\d|atm|tmp|wtp|wnd|hum)/;

// Waktu sampel muka laut terakhir dalam satu jawaban data (ms), atau null.
export function latestSampleMs(json) {
  if (!Array.isArray(json)) throw new Error('format data muka laut IOC tidak dikenal: bukan daftar');
  const times = json.filter((row) => row.sensor && !NOT_LEVEL.test(row.sensor) && Number.isFinite(row.slevel)).map((row) => utcMs(row.stime));
  const latest = Math.max(...times.filter(Number.isFinite));
  return Number.isFinite(latest) ? latest : null;
}

// Status tiap alat di daftar statis dari data 90 menit terakhirnya (±10–20 KB per
// alat, beberapa alat sekaligus): waktu sampel terakhir dan aktif tidaknya. Alat
// tanpa sampel dalam jendela itu, atau yang gagal diperiksa, berstatus tertunda.
// Bila semua alat gagal diperiksa, layanan IOC dianggap tidak terjangkau.
export async function fetchStations({ now = Date.now(), getJson = fetchJson, stations = STATIONS } = {}) {
  const results = new Array(stations.length);
  let failures = 0;
  let next = 0;
  async function worker() {
    while (next < stations.length) {
      const index = next++;
      const station = stations[index];
      let lastMs = null;
      try {
        lastMs = latestSampleMs(await getJson(seriesUrl(station.code, { now, hours: STATUS_HOURS }), { timeoutMs: 20_000, retries: 0 }));
      } catch {
        failures++;
      }
      results[index] = {
        ...station,
        last_at: lastMs === null ? null : new Date(lastMs).toISOString(),
        active: lastMs !== null && now - lastMs <= ACTIVE_WITHIN_MS,
        url: stationPageUrl(station.code),
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(STATUS_CONCURRENCY, stations.length) }, worker));
  if (stations.length && failures === stations.length) throw new Error('semua alat gagal diperiksa');
  return results;
}

// ---------- Data satu alat ----------
const SENSOR_KINDS = [
  [/^ra/, 'radar'],
  [/^pr/, 'tekanan air'],
  [/^(enc|flt)/, 'pelampung'],
  [/^(bub|bwl)/, 'gelembung udara'],
];
export const sensorKind = (sensor) => SENSOR_KINDS.find(([pattern]) => pattern.test(sensor ?? ''))?.[1] ?? 'pengukur muka laut';

// Jawaban data IOC [{ slevel, stime, sensor }] → Map(sensor → [[ms, meter], …])
// urut waktu, hanya sensor pengukur muka laut.
export function levelSensors(json) {
  if (!Array.isArray(json)) throw new Error('format data muka laut IOC tidak dikenal: bukan daftar');
  const bySensor = new Map();
  for (const row of json) {
    const ms = utcMs(row.stime);
    if (!row.sensor || NOT_LEVEL.test(row.sensor) || !Number.isFinite(row.slevel) || !Number.isFinite(ms)) continue;
    if (!bySensor.has(row.sensor)) bySensor.set(row.sensor, []);
    bySensor.get(row.sensor).push([ms, row.slevel]);
  }
  for (const points of bySensor.values()) points.sort((a, b) => a[0] - b[0]);
  return bySensor;
}

// Lonjakan sesaat (gangguan sensor) dibuang: titik yang berjarak lebih dari
// `limit` meter dari median 11 titik di sekitarnya. Gelombang tsunami berperiode
// menit sampai jam, jadi tidak ikut terbuang.
export function despike(points, limit = 0.3) {
  return points.filter(([, level], index) => {
    const around = points.slice(Math.max(0, index - 5), index + 6).map((point) => point[1]).sort((a, b) => a - b);
    return Math.abs(level - around[Math.floor(around.length / 2)]) <= limit;
  });
}

// Persamaan normal kuadrat terkecil: matriks n × (n + 1), kolom terakhir = ruas kanan.
function normalEquations(rows, values) {
  const n = rows[0].length;
  const system = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  rows.forEach((row, r) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) system[i][j] += row[i] * row[j];
      system[i][n] += row[i] * values[r];
    }
  });
  return system;
}

// Eliminasi Gauss dengan pemilihan pivot; false bila sistemnya singular.
function eliminate(system) {
  const n = system.length;
  for (let i = 0; i < n; i++) {
    const below = system.slice(i).map((row) => Math.abs(row[i]));
    const pivot = i + below.indexOf(Math.max(...below));
    [system[i], system[pivot]] = [system[pivot], system[i]];
    if (Math.abs(system[i][i]) < 1e-12) return false;
    for (let k = i + 1; k < n; k++) {
      const factor = system[k][i] / system[i][i];
      for (let j = i; j <= n; j++) system[k][j] -= factor * system[i][j];
    }
  }
  return true;
}

// Kuadrat terkecil; null bila tidak dapat diselesaikan (data terlalu sedikit
// atau seragam).
function leastSquares(rows, values) {
  const system = normalEquations(rows, values);
  if (!eliminate(system)) return null;
  const n = system.length;
  const solution = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const known = solution.slice(i + 1).reduce((sum, value, k) => sum + system[i][i + 1 + k] * value, 0);
    solution[i] = (system[i][n] - known) / system[i][i];
  }
  return solution;
}

// Periode (jam) komponen pasang surut yang dicocokkan: semidiurnal utama (M2),
// diurnal utama (K1), dan komponen perairan dangkal (M4).
const TIDE_PERIODS_H = [12.4206012, 23.9344696, 6.2103006];
const tideBasis = (hours) => [1, hours / 10, ...TIDE_PERIODS_H.flatMap((period) => [Math.cos((2 * Math.PI * hours) / period), Math.sin((2 * Math.PI * hours) / period)])];
// Data minimal supaya pencocokan berarti: 70% dari satu sampel per menit.
const MIN_COVERAGE = 0.7;

// Pisahkan pasang surut dari muka laut: rata-rata + kecenderungan linear + tiga
// komponen pasang surut dicocokkan ke jendela FIT_HOURS; sisanya (residu) adalah
// bagian yang bukan pasang surut: gelombang pelabuhan, pengaruh cuaca, atau
// tsunami. Diuji pada 3 hari data enam stasiun (8–11 Nov 2026, tanpa tsunami):
// residu rms 0,8–3,5 cm, 99% di bawah 10 cm, paling besar 17 cm.
// Hasil: [[ms, level, pasang surut], …] atau null bila datanya tidak cukup.
export function detide(points, { end = points.at(-1)?.[0], hours = FIT_HOURS } = {}) {
  const window = points.filter(([ms]) => ms > end - hours * HOUR_MS && ms <= end);
  if (window.length < hours * 60 * MIN_COVERAGE) return null;
  const rows = window.map(([ms]) => tideBasis((ms - end) / HOUR_MS));
  const coefficients = leastSquares(rows, window.map((point) => point[1]));
  if (!coefficients) return null;
  return window.map(([ms, level], index) => [ms, level, rows[index].reduce((sum, term, k) => sum + term * coefficients[k], 0)]);
}

const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
// Sensor yang macet mengirim angka yang sama terus; pasang surut di Indonesia
// selalu lebih dari beberapa sentimeter dalam 15 jam.
const MIN_RANGE_M = 0.02;

// Seberapa besar bagian muka laut yang bukan pasang surut: rms residu dibagi
// simpangan baku muka lautnya (0 = seluruhnya pasang surut).
function noiseShare(fitted) {
  const levels = fitted.map((point) => point[1]);
  const mean = levels.reduce((sum, level) => sum + level, 0) / levels.length;
  return rms(fitted.map(([, level, tide]) => level - tide)) / rms(levels.map((level) => level - mean));
}

// Stasiun umumnya punya 2–4 sensor muka laut dengan mutu berbeda: ada yang
// penuh lonjakan (radar Benoa), ada yang hampir tidak bergerak (sensor tekanan
// kedua Semarang hanya ±7 cm saat sensor pertamanya ±48 cm). Yang dipakai:
// sensor yang paling jelas mengikuti pasang surut, yaitu yang bagian residunya
// paling kecil dibanding naik-turunnya. Bila tidak ada yang bisa dicocokkan
// (data kurang dari 70%), sensor dengan data terbanyak.
export function chooseSensor(json) {
  const candidates = [];
  for (const [sensor, raw] of levelSensors(json)) {
    const points = despike(raw);
    const levels = points.map((point) => point[1]);
    if (!points.length || Math.max(...levels) - Math.min(...levels) < MIN_RANGE_M) continue;
    const fitted = detide(points);
    candidates.push({ sensor, points, fitted, spikes: raw.length - points.length, noise: fitted ? noiseShare(fitted) : Infinity });
  }
  candidates.sort((a, b) => a.noise - b.noise || b.points.length - a.points.length);
  return candidates[0] ?? null;
}

const cm = (meters) => Math.round(meters * 1000) / 10;

// Deret satu stasiun untuk ditampilkan: SHOW_HOURS terakhir, muka laut dalam cm
// terhadap rata-rata jendela itu, dan residunya (cm) bila pasang surutnya bisa
// dicocokkan. Ringkasan: nilai terakhir dan residu terbesar dua jam terakhir.
export function buildSeries(json, { now = Date.now() } = {}) {
  const chosen = chooseSensor(json);
  if (!chosen) return { sensor: null, sensor_kind: null, points: 0, spikes_removed: 0, from: null, until: null, minutes: [], level_cm: [], residual_cm: null, latest: null };
  const end = chosen.points.at(-1)[0];
  const shown = chosen.points.filter(([ms]) => ms > end - SHOW_HOURS * HOUR_MS);
  const mean = shown.reduce((sum, point) => sum + point[1], 0) / shown.length;
  const residualAt = chosen.fitted ? new Map(chosen.fitted.map(([ms, level, tide]) => [ms, level - tide])) : null;
  const residuals = residualAt ? shown.map(([ms]) => cm(residualAt.get(ms))) : null;
  const recent = residuals ? residuals.filter((_, index) => shown[index][0] > end - 2 * HOUR_MS) : [];
  return {
    sensor: chosen.sensor,
    sensor_kind: sensorKind(chosen.sensor),
    points: shown.length,
    spikes_removed: chosen.spikes,
    from: new Date(shown[0][0]).toISOString(),
    until: new Date(end).toISOString(),
    // Menit sejak `from`, supaya deretnya ringkas.
    minutes: shown.map(([ms]) => Math.round((ms - shown[0][0]) / MINUTE_MS)),
    level_cm: shown.map(([, level]) => cm(level - mean)),
    residual_cm: residuals,
    latest: {
      at: new Date(end).toISOString(),
      age_min: Math.max(0, Math.round((now - end) / MINUTE_MS)),
      level_cm: cm(shown.at(-1)[1] - mean),
      residual_cm: residuals ? residuals.at(-1) : null,
      // Simpangan terbesar (nilai mutlak) dari pola pasang surut dua jam terakhir.
      residual_peak_cm: recent.length ? Math.max(...recent.map(Math.abs)) : null,
    },
  };
}

export async function fetchSeries(station, { now = Date.now(), getJson = fetchJson } = {}) {
  return buildSeries(await getJson(seriesUrl(station.code, { now }), { timeoutMs: 30_000 }), { now });
}
