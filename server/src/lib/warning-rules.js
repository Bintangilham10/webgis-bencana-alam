import rules from '../config/rules.json' with { type: 'json' };

// Logika peringatan dini berbasis aturan (plan §8). Semua ambang ada di
// config/rules.json supaya bisa dikalibrasi (RQ1) tanpa mengubah kode.
export const RULES_VERSION = rules.version;
export const WARNING_LEVELS = rules.warningLevels;

const CLASS_IDS = rules.hazardClasses.map((c) => c.id);
const RAIN_IDS = rules.rainCategories.map((c) => c.id);

// Kelas BNPB dari indeks 0–1. NoData/0 berarti di luar zona bahaya (null).
export function hazardClass(index) {
  if (!Number.isFinite(index) || index <= 0) return null;
  const rounded = Math.round(index * 1000) / 1000;
  return rules.hazardClasses.find((c) => rounded <= c.max) ?? rules.hazardClasses.at(-1);
}

// Kategori hujan harian BMKG; di bawah 0,5 mm dianggap tidak hujan (null).
export function rainCategory(mm) {
  if (!Number.isFinite(mm)) return null;
  return rules.rainCategories.findLast((c) => mm >= c.min) ?? null;
}

const rainCategoryById = (id) => rules.rainCategories.find((c) => c.id === id);
const rainRank = (category) => (category ? RAIN_IDS.indexOf(category.id) : -1);

export function warningLevel(rainCategoryId, hazardClassId) {
  const row = rules.rainHazardMatrix.levels[rainCategoryId];
  const column = CLASS_IDS.indexOf(hazardClassId);
  return row && column !== -1 ? row[column] : 0;
}

const formatMm = (mm) => `${Math.round(mm * 10) / 10} mm`.replace('.', ',');
// 3 desimal = presisi yang dipakai aturan kelas BNPB, supaya angka dan label kelas
// tidak tampak bertentangan (mis. 0,6664 tidak tampil "0,67 sedang").
const indexFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
const formatIndex = (index) => indexFormat.format(index);

// Indikasi per titik untuk hari-hari prakiraan: hujan tertinggi × kelas bahaya.
// hazards: { banjir: { index }, longsor: { index } }; days: [{ date, precipitationMm }]
export function rainHazardIndications(hazards, days) {
  const rainyDays = days.filter((d) => Number.isFinite(d.precipitationMm));
  if (!rainyDays.length) return [];
  const peak = rainyDays.reduce((max, d) => (d.precipitationMm > max.precipitationMm ? d : max));
  const { days: windowDays, minTotalMm } = rules.landslideAntecedentRain;
  const total = rainyDays.slice(0, windowDays).reduce((sum, d) => sum + d.precipitationMm, 0);

  return rules.rainHazardMatrix.hazards.map((hazard) => {
    const index = hazards[hazard]?.index ?? null;
    const cls = hazardClass(index);
    let rain = rainCategory(peak.precipitationMm);
    let rainText = `hujan tertinggi ${formatMm(peak.precipitationMm)}/hari (${rain?.label.toLowerCase() ?? 'tidak hujan'})`;

    if (hazard === 'longsor' && total >= minTotalMm && rainRank(rain) < RAIN_IDS.indexOf('lebat')) {
      rain = rainCategoryById('lebat');
      rainText = `akumulasi hujan ${windowDays} hari ${formatMm(total)} (setara hujan lebat untuk longsor)`;
    }

    const level = cls ? warningLevel(rain?.id, cls.id) : 0;
    const hazardText = cls
      ? `indeks bahaya ${cls.label.toLowerCase()} (${formatIndex(index)})`
      : 'lokasi di luar zona bahaya InaRISK';
    return { hazard, level, label: WARNING_LEVELS[level], reason: `${rainText}; ${hazardText}` };
  });
}
