import { hazardClassByValue, heavyRainIndication, rainHazardIndications, WARNING_LEVELS } from '../lib/warning-rules.js';

// Indikasi SIGAP 3 hari per kab/kota. Setiap kab/kota punya titik pantau
// (seed-bahaya.js): sampai tiga titik di zona bahaya banjir, sampai tiga di
// zona longsor, dan satu titik acuan. Level kab/kota untuk satu bahaya pada satu
// hari = level tertinggi dari titik-titiknya, dengan aturan yang sama seperti cek
// risiko titik.
export const OUTLOOK_HAZARDS = ['hujan', 'banjir', 'longsor'];
// Jendela yang ditampilkan: hari ini dan dua hari berikutnya (WIB).
export const OUTLOOK_WINDOW_DAYS = 3;
const HAZARD_NAMES = { banjir: 'banjir', longsor: 'tanah longsor' };

// Hujan diambil tepat di tiap titik pantau, pada koordinat 3 desimal yang sama
// dengan cek risiko (routes/risk.js). Model Open-Meteo untuk Indonesia (ECMWF IFS
// 9 km) jauh lebih rapat dari sel 0,25°, jadi hujan di pusat sel bisa berbeda
// dari hujan di titik pantau; dengan koordinat yang sama, indikasi kab/kota dan
// cek risiko di titik itu hanya berbeda bila prakiraannya sudah diperbarui.
export function rainPoint(lat, lon) {
  const [y, x] = [lat.toFixed(3), lon.toFixed(3)];
  return { key: `${y},${x}`, lat: Number(y), lon: Number(x) };
}

// Titik/hari terburuk: level tertinggi (tanpa data paling rendah), lalu hujan
// tertinggi, lalu tanggal paling awal.
const rank = (x) => x.level ?? -1;
const worse = (a, b) =>
  !b || rank(a) > rank(b) || (rank(a) === rank(b) && ((a.rainMm ?? -1) > (b.rainMm ?? -1) || ((a.rainMm ?? -1) === (b.rainMm ?? -1) && a.date < b.date)));

// Indikasi satu titik pada hari ke-k: kategori hujan hari itu, dan untuk longsor
// akumulasi N hari yang berakhir pada hari itu (ikut menghitung hujan sebelumnya).
function pointOnDay(point, rain, k) {
  const day = rain.days[k];
  const indications = [heavyRainIndication([day])];
  if (point.hazard !== 'acuan') {
    const before = [...(rain.pastDays ?? []), ...rain.days.slice(0, k)];
    const cls = hazardClassByValue(point.kelas);
    indications.push(rainHazardIndications({ [point.hazard]: { class: cls } }, [day], before).find((i) => i.hazard === point.hazard));
  }
  return indications.filter(Boolean);
}

// Indikasi kab/kota per hari prakiraan.
// points: [{ hazard: 'banjir'|'longsor'|'acuan', kelas, lat, lon }]
// rainAt(point) → { days, pastDays } atau null bila hujan gagal dimuat.
// dates: tanggal prakiraan run ini (sama untuk semua titik karena satu zona waktu).
// Hasil: [{ date, hazard, level, label, reason, rainMm, lat, lon }] untuk tiap
// tanggal × jenis bahaya; level null = hujan tidak tersedia.
export function regionDailyOutlook(points, rainAt, dates) {
  const best = new Map();
  let withRain = 0;
  for (const point of points) {
    const rain = rainAt(point);
    if (!rain?.days?.length) continue;
    withRain++;
    rain.days.forEach((day, k) => {
      for (const indication of pointOnDay(point, rain, k)) {
        const key = `${day.date}|${indication.hazard}`;
        const candidate = { date: day.date, ...indication, lat: point.lat, lon: point.lon };
        if (worse(candidate, best.get(key))) best.set(key, candidate);
      }
    });
  }

  const hasZone = (hazard) => hazard === 'hujan' || points.some((p) => p.hazard === hazard);
  return dates.flatMap((date) =>
    OUTLOOK_HAZARDS.map((hazard) => {
      const found = best.get(`${date}|${hazard}`);
      if (found) {
        const { level, reason, rainMm, lat, lon } = found;
        return { date, hazard, level, label: WARNING_LEVELS[level], reason, rainMm, lat, lon };
      }
      const empty = { date, hazard, rainMm: null, lat: null, lon: null };
      if (!withRain) return { ...empty, level: null, label: null, reason: 'Data prakiraan hujan untuk kab/kota ini gagal dimuat' };
      if (!hasZone(hazard)) {
        return { ...empty, level: 0, label: WARNING_LEVELS[0], reason: `tidak ada zona bahaya ${HAZARD_NAMES[hazard]} InaRISK seluas ≥ 1 km² di kab/kota ini` };
      }
      return { ...empty, level: null, label: null, reason: 'Data prakiraan hujan hari ini tidak tersedia' };
    }),
  );
}

// Ringkasan beberapa hari: hari terburuk per jenis bahaya (level, hujan, lalu
// tanggal paling awal), dengan tanggalnya sebagai `peakDate`. Dipakai untuk
// jendela 3 hari yang ditampilkan peta dan untuk ringkasan run di database.
export function summarizeDays(daily, dates) {
  const inWindow = new Set(dates);
  return OUTLOOK_HAZARDS.map((hazard) => {
    let worst = null;
    for (const row of daily) {
      if (row.hazard === hazard && inWindow.has(row.date) && worse(row, worst)) worst = row;
    }
    if (!worst) return { hazard, level: null, label: null, reason: 'Tidak ada prakiraan untuk hari-hari ini', peakDate: null, lat: null, lon: null };
    const { level, reason, lat, lon, date } = worst;
    return { hazard, level, label: level === null ? null : WARNING_LEVELS[level], reason, peakDate: level ? date : null, lat, lon };
  });
}

// Ringkasan seluruh hari prakiraan untuk satu kab/kota.
export function regionOutlook(points, rainAt) {
  const dates = points.map(rainAt).find((rain) => rain?.days?.length)?.days.map((d) => d.date);
  if (!dates) {
    return OUTLOOK_HAZARDS.map((hazard) => ({
      hazard, level: null, label: null, reason: 'Data prakiraan hujan untuk kab/kota ini gagal dimuat', peakDate: null, lat: null, lon: null,
    }));
  }
  return summarizeDays(regionDailyOutlook(points, rainAt, dates), dates);
}
