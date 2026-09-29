import { hazardClassByValue, heavyRainIndication, rainHazardIndications, WARNING_LEVELS } from '../lib/warning-rules.js';

// Indikasi SIGAP 3 hari per kab/kota. Setiap kab/kota punya titik pantau
// (seed-bahaya.js): sampai tiga titik di zona bahaya banjir, sampai tiga di
// zona longsor, dan satu titik acuan. Level kab/kota untuk satu bahaya = level
// tertinggi dari titik-titiknya, dengan aturan yang sama seperti cek risiko titik.
export const OUTLOOK_HAZARDS = ['hujan', 'banjir', 'longsor'];
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

// Titik terburuk: level tertinggi, lalu hujan tertinggi.
const worse = (a, b) => !b || a.level > b.level || (a.level === b.level && a.rainMm > b.rainMm);

// points: [{ hazard: 'banjir'|'longsor'|'acuan', kelas, lat, lon }]
// rainAt(point) → { days, pastDays } atau null bila hujan gagal dimuat.
export function regionOutlook(points, rainAt) {
  const best = {};
  let withRain = 0;
  for (const point of points) {
    const rain = rainAt(point);
    if (!rain?.days?.length) continue;
    withRain++;
    const candidates = [heavyRainIndication(rain.days)];
    if (point.hazard !== 'acuan') {
      const indication = rainHazardIndications({ [point.hazard]: { class: hazardClassByValue(point.kelas) } }, rain.days, rain.pastDays ?? []).find(
        (i) => i.hazard === point.hazard,
      );
      candidates.push(indication);
    }
    for (const indication of candidates.filter(Boolean)) {
      const candidate = { ...indication, lat: point.lat, lon: point.lon };
      if (worse(candidate, best[indication.hazard])) best[indication.hazard] = candidate;
    }
  }

  return OUTLOOK_HAZARDS.map((hazard) => {
    if (best[hazard]) {
      const { level, reason, peakDate, lat, lon } = best[hazard];
      return { hazard, level, label: WARNING_LEVELS[level], reason, peakDate, lat, lon };
    }
    if (!withRain) return { hazard, level: null, label: null, reason: 'Data prakiraan hujan untuk kab/kota ini gagal dimuat', peakDate: null };
    // Ada hujan, tetapi tidak ada titik di zona bahaya jenis ini.
    return {
      hazard,
      level: 0,
      label: WARNING_LEVELS[0],
      reason: `tidak ada zona bahaya ${HAZARD_NAMES[hazard]} InaRISK seluas ≥ 1 km² di kab/kota ini`,
      peakDate: null,
    };
  });
}
