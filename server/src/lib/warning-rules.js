import rules from '../config/rules.json' with { type: 'json' };

// Logika peringatan dini berbasis aturan (plan §8). Semua ambang ada di
// config/rules.json supaya bisa dikalibrasi (RQ1) tanpa mengubah kode.
// Fungsi di sini dipakai bersama oleh cek risiko titik dan indikasi SIGAP
// 3 hari per kab/kota, jadi keduanya selalu memakai aturan yang sama.
export const RULES_VERSION = rules.version;
export const WARNING_LEVELS = rules.warningLevels;

const CLASS_IDS = rules.hazardClasses.map((c) => c.id);
const RAIN_IDS = rules.rainCategories.map((c) => c.id);

// Kelas BNPB dari indeks 0–1, sepertiga dengan batas atas inklusif: rendah ≤ 1/3,
// sedang ≤ 2/3, tinggi > 2/3. Batas di rules.json (0,3334 dan 0,6667) sedikit di
// atas 1/3 dan 2/3 karena indeks tanah longsor InaRISK menyandikan zona kerentanan
// PVMBG tepat sebagai 1/3, 2/3, dan 1, yang dibaca dari server sebagai 0,333333 dan
// 0,666667. Batasnya sama dengan Remap peta (web/src/layers/hazards.js) dan raster
// seed-bahaya.js. NoData/0 berarti di luar zona bahaya (null).
export function hazardClass(index) {
  if (!Number.isFinite(index) || index <= 0) return null;
  return rules.hazardClasses.find((c) => c.below === undefined || index < c.below);
}

// Kelas BNPB dari nilai raster kelas (1 rendah, 2 sedang, 3 tinggi; 0 di luar zona),
// dan sebaliknya nilai kelas dari indeks 0–1.
export const hazardClassByValue = (value) => rules.hazardClasses[value - 1] ?? null;
export const hazardClassValue = (index) => rules.hazardClasses.indexOf(hazardClass(index)) + 1;

// Kategori hujan harian BMKG; di bawah 0,5 mm dianggap tidak hujan (null).
export function rainCategory(mm) {
  if (!Number.isFinite(mm)) return null;
  return rules.rainCategories.findLast((c) => mm >= c.min) ?? null;
}

// Kelas lereng Van Zuidam dari derajat kemiringan.
export function slopeClass(degrees) {
  if (!Number.isFinite(degrees)) return null;
  return rules.slopeClasses.classes.findLast((c) => degrees >= c.min) ?? null;
}

const rainCategoryById = (id) => rules.rainCategories.find((c) => c.id === id);
const rainRank = (category) => (category ? RAIN_IDS.indexOf(category.id) : -1);

export function warningLevel(rainCategoryId, hazardClassId) {
  const row = rules.rainHazardMatrix.levels[rainCategoryId];
  const column = CLASS_IDS.indexOf(hazardClassId);
  return row && column !== -1 ? row[column] : 0;
}

const formatMm = (mm) => `${Math.round(mm * 10) / 10} mm`.replace('.', ',');
// 3 desimal cukup untuk membedakan kelas di sekitar batasnya (mis. 0,6664 tidak
// tampil "0,67"); 2/3 tampil 0,667 dan berkelas sedang (lihat hazardClass).
const indexFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
const formatIndex = (index) => indexFormat.format(index);

const known = (days) => days.filter((d) => Number.isFinite(d.precipitationMm));
const peakDay = (days) => days.reduce((max, d) => (d.precipitationMm > max.precipitationMm ? d : max));

// Hari prakiraan dengan akumulasi hujan N hari bergulir terbesar. Jendela untuk
// hari-hari pertama ikut menghitung hujan beberapa hari terakhir (pastDays),
// karena tanah yang sudah basah lebih mudah longsor.
function wettestWindow(pastDays, days, windowDays) {
  const series = [...pastDays, ...days];
  let best = null;
  days.forEach((day, k) => {
    const end = pastDays.length + k;
    const total = known(series.slice(Math.max(0, end - windowDays + 1), end + 1)).reduce((sum, d) => sum + d.precipitationMm, 0);
    if (!best || total > best.total) best = { date: day.date, total };
  });
  return best;
}

// "hujan tertinggi 72 mm/hari" untuk beberapa hari, "hujan 72 mm/hari" untuk satu hari.
const rainText = (rainy, peak) =>
  `hujan ${rainy.length > 1 ? 'tertinggi ' : ''}${formatMm(peak.precipitationMm)}/hari (${rainCategory(peak.precipitationMm)?.label.toLowerCase() ?? 'tidak hujan'})`;

// Indikasi hujan lebat: kategori hujan harian tertinggi dalam prakiraan → level.
export function heavyRainIndication(days) {
  const rainy = known(days);
  if (!rainy.length) return null;
  const peak = peakDay(rainy);
  const rain = rainCategory(peak.precipitationMm);
  const level = rules.rainLevels.levels[rain?.id] ?? 0;
  return {
    hazard: 'hujan',
    level,
    label: WARNING_LEVELS[level],
    reason: rainText(rainy, peak),
    peakDate: peak.date,
    rainMm: peak.precipitationMm,
  };
}

// Indikasi banjir dan longsor per titik: hujan tertinggi × kelas bahaya.
// hazards: { banjir: { index } | { class }, longsor: ... } — index dari identify
// InaRISK (cek risiko) atau class dari raster kelas (indikasi kab/kota).
// days: prakiraan [{ date, precipitationMm }]; pastDays: hujan hari-hari terakhir.
export function rainHazardIndications(hazards, days, pastDays = []) {
  const rainy = known(days);
  if (!rainy.length) return [];
  const peak = peakDay(rainy);
  const { days: windowDays, minTotalMm } = rules.landslideAntecedentRain;
  const wettest = wettestWindow(pastDays, days, windowDays);

  return rules.rainHazardMatrix.hazards.map((hazard) => {
    const index = hazards[hazard]?.index ?? null;
    const cls = hazards[hazard]?.class ?? hazardClass(index);
    let rain = rainCategory(peak.precipitationMm);
    let why = rainText(rainy, peak);
    let peakDate = peak.date;

    if (hazard === 'longsor' && wettest.total >= minTotalMm && rainRank(rain) < RAIN_IDS.indexOf('lebat')) {
      rain = rainCategoryById('lebat');
      why = `akumulasi hujan ${windowDays} hari ${formatMm(wettest.total)} (setara hujan lebat untuk longsor)`;
      peakDate = wettest.date;
    }

    const level = cls ? warningLevel(rain?.id, cls.id) : 0;
    let hazardText = 'lokasi di luar zona bahaya InaRISK';
    if (cls) hazardText = index == null ? `zona bahaya ${cls.label.toLowerCase()} (InaRISK)` : `indeks bahaya ${cls.label.toLowerCase()} (${formatIndex(index)})`;
    return { hazard, level, label: WARNING_LEVELS[level], reason: `${why}; ${hazardText}`, peakDate, rainMm: peak.precipitationMm };
  });
}

// Ketiga indikasi 3 hari (hujan lebat, banjir, tanah longsor) untuk satu titik.
export function outlookIndications(hazards, days, pastDays = []) {
  const rain = heavyRainIndication(days);
  return rain ? [rain, ...rainHazardIndications(hazards, days, pastDays)] : [];
}
