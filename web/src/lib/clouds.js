// Petak inframerah Himawari-9 dari NASA GIBS (Band 13 Clean Infrared) berupa
// gambar penuh yang diwarnai menurut suhu puncak awan (palet Worldview
// "Clean_Longwave_Infrared_Window_Band"):
//   ≥ −19 °C  abu-abu, makin gelap makin hangat (#c5c5c5 di −19 °C, #939393 di 0 °C)
//   −19..−70  sian, biru, hijau, kuning, jingga, merah, merah gelap
//   −70..−80  abu-abu lagi, dari #050505 (−70) sampai #e6e6e6 (−80)
//   < −80     ungu-merah muda, lalu putih di bawah −91 °C
// cloudsOnly() membaca balik tiap piksel menjadi suhu puncak awan, lalu
// menggambarnya ulang dengan skala "awan putih" (CLOUD_STOPS di bawah):
// permukaan dan awan rendah yang hangat transparan, awan makin pekat makin
// dingin, dan hanya puncak awan hujan (≤ −40 °C) yang berwarna.
//
// Abu-abu −70..−80 °C (inti badai) tidak bisa dibedakan dari abu-abu hangat
// lewat warnanya, jadi dinilai per wilayah abu-abu yang bersambung: inti badai
// hanya bertetangga dengan merah gelap (−60..−70 °C) atau ungu/putih (< −80 °C),
// sedangkan abu-abu hangat bertetangga dengan sian (−19 °C) dan warna lain.

// Abu-abu hangat paling terang: 197 = −19 °C.
const WARM_TOP = 197;
// Abu-abu ≥ 216 hanya ada di dekat −80 °C atau di bawah −91 °C (putih); abu-abu
// hangat paling terang ±207 karena penghalusan petak di tepi awan bersian.
const COLD_GRAY_MIN = 216;
// Inti badai boleh berbatasan sedikit dengan warna lain akibat penghalusan petak.
const OTHER_PER_CORE_BORDER = 0.1;
// Wilayah sebesar ini bukan inti badai (inti terbesar ±80 px di zoom 6).
const MAX_CORE_SHARE = 0.25;

const GRAY = 0; // abu-abu yang belum pasti hangat atau dingin
const COLD = 1; // merah gelap, ungu, atau abu-abu ≥ COLD_GRAY_MIN: tetangga inti badai
const COLOR = 2; // sian sampai jingga (−19..−60 °C)

// Abu-abu ≥ 240 hanya ada di puncak < −80 °C (putih −91 °C dan campurannya);
// abu-abu hangat paling terang 197, jadi tidak mungkin berasal dari permukaan.
const WHITE_MIN = 240;

// Abu-abu kemerahan (mis. 50,24,24) adalah campuran merah tua −60..−70 °C dengan
// abu-abu inti badai. Abu-abu permukaan selalu netral, atau kebiruan bila
// bercampur sian di tepi awan, jadi rona merah menandai puncak awan dingin.
const isRedTint = (data, o) => data[o] - data[o + 2] >= 6 && data[o] >= data[o + 1];

const isBrightGray = (data, o) => {
  const r = data[o];
  return r >= COLD_GRAY_MIN && Math.max(r, data[o + 1], data[o + 2]) - Math.min(r, data[o + 1], data[o + 2]) <= 24;
};

function classify(r, g, b) {
  if (Math.max(r, g, b) - Math.min(r, g, b) <= 24) return r >= COLD_GRAY_MIN ? COLD : GRAY;
  const darkRed = r > g + 20 && g < 60 && b < 40;
  const purple = r > g + 40 && b > g + 40;
  return darkRed || purple ? COLD : COLOR;
}

// data = RGBA dari getImageData (diubah di tempat), width = lebar petak.
// light: peta dasar terang (awan abu-abu kebiruan, bukan putih).
export function cloudsOnly(data, width, { light = false } = {}) {
  const lut = light ? LUT_LIGHT : LUT_DARK;
  const count = data.length / 4;
  const height = count / width;
  const kind = new Uint8Array(count);
  for (let i = 0; i < count; i++) kind[i] = classify(data[4 * i], data[4 * i + 1], data[4 * i + 2]);

  // Abu-abu terang (≥ 216) bisa −80 °C, putih < −91 °C, atau sisa resampling
  // di tepi awan hangat. Dianggap dingin hanya bila ≥ 2 tetangganya puncak awan
  // dingin (≤ −55 °C, termasuk abu-abu inti badai).
  const nearCold = (i) => {
    const x = i % width;
    const y = (i - x) / width;
    let cold = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        const o = 4 * j;
        if (isBrightGray(data, o)) {
          if (data[o] >= WHITE_MIN) cold++;
        } else if (kind[j] === GRAY) {
          if (core[j] || isRedTint(data, o)) cold++;
        } else if (colorCelsius(data[o], data[o + 1], data[o + 2]) <= -55) cold++;
      }
    }
    return cold >= 2;
  };

  // Telusuri tiap wilayah abu-abu bersambung (8 arah) sambil menghitung warna
  // di sekelilingnya; wilayah yang dikelilingi warna inti badai ditandai dingin.
  const core = new Uint8Array(count);
  const seen = new Uint8Array(count);
  const stack = new Int32Array(count);
  const members = new Int32Array(count);
  for (let start = 0; start < count; start++) {
    if (kind[start] !== GRAY || seen[start]) continue;
    let size = 0;
    let top = 0;
    let coldBorder = 0;
    let colorBorder = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      members[size++] = i;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((!dx && !dy) || nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          // Abu-abu terang 216–239 juga muncul di tepi awan hangat akibat
          // resampling, jadi tidak dihitung sebagai tetangga dingin.
          if (kind[j] === COLD) {
            if (!isBrightGray(data, 4 * j) || data[4 * j] >= WHITE_MIN) coldBorder++;
          } else if (kind[j] === COLOR) colorBorder++;
          else if (!seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    const isCore = coldBorder > 0 && colorBorder <= coldBorder * OTHER_PER_CORE_BORDER && size <= count * MAX_CORE_SHARE;
    if (isCore) for (let k = 0; k < size; k++) core[members[k]] = 1;
  }

  // Suhu semua piksel dihitung dulu dari warna asli; baru setelah itu `data`
  // ditimpa, karena aturan tetangga membaca warna asli piksel sekitarnya.
  const celsius = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = 4 * i;
    if (data[o + 3] === 0) continue; // di luar cakram Himawari
    const r = data[o];
    if (isBrightGray(data, o)) celsius[i] = r >= WHITE_MIN || nearCold(i) ? coldGrayCelsius(r) : warmGrayCelsius(r);
    else if (kind[i] !== GRAY) celsius[i] = colorCelsius(r, data[o + 1], data[o + 2]);
    // Abu-abu yang wilayahnya tidak lolos uji inti badai tetapi dikelilingi
    // puncak awan dingin tetap inti badai (bukan lubang transparan).
    else if (core[i] || isRedTint(data, o) || nearCold(i)) celsius[i] = coreGrayCelsius(r);
    else celsius[i] = warmGrayCelsius(r);
  }
  for (let i = 0; i < count; i++) {
    const o = 4 * i;
    if (data[o + 3] === 0) continue;
    const t = 4 * Math.max(0, Math.min(TEMP_STEPS - 1, Math.round((celsius[i] - TEMP_MIN) / TEMP_STEP)));
    data[o] = lut[t];
    data[o + 1] = lut[t + 1];
    data[o + 2] = lut[t + 2];
    data[o + 3] = lut[t + 3];
  }
  return data;
}

// ---------- Warna baca balik ke suhu (colormap GIBS) ----------
// Palet resmi: https://gibs.earthdata.nasa.gov/colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml
// Abu-abu hangat turun ±1,29 tingkat tiap 0,5 °C (197 di −18,85 °C). Abu-abu inti
// badai 5..230 untuk −70,6..−79,6 °C. Warna lain dicocokkan ke entri terdekat,
// karena ±20% piksel petak GIBS adalah campuran hasil resampling.
const warmGrayCelsius = (gray) => -18.85 + ((WARM_TOP - Math.min(gray, WARM_TOP)) * 0.5) / 1.29;
const coreGrayCelsius = (gray) => -70.6 - ((gray - 5) * 9) / 225;
// ≥ 216: dekat −80 °C (230) atau putih di bawah −91 °C (255).
const coldGrayCelsius = (gray) => (gray <= 230 ? -79.6 : -79.6 - ((gray - 230) * 12) / 25);

// Warna resmi untuk −92..−19 °C selain abu-abu inti badai: RGB hex → °C (tengah selang).
const COLOR_ENTRIES = (
  'ffffff:-91.6 7f007f:-90.6 8c0d87:-89.6 99198e:-88.6 a52696:-87.6 b2339d:-86.6 bf40a5:-85.6 cc4cad:-84.6 ' +
  'd959b4:-83.6 e566bc:-82.6 f272c3:-81.6 ff7fcb:-80.6 1a0000:-69.6 330000:-68.6 4d0000:-67.6 660000:-66.6 ' +
  '800000:-65.6 990000:-64.6 b30000:-63.6 cc0000:-62.6 e60000:-61.6 ff0000:-60.6 ff1a00:-59.6 ff3300:-58.6 ' +
  'ff4d00:-57.6 ff6600:-56.6 ff8000:-55.6 ff9900:-54.6 ffb300:-53.6 ffcc00:-52.6 ffe600:-51.6 ffff00:-50.6 ' +
  'e6ff00:-49.6 ccff00:-48.6 b3ff00:-47.6 99ff00:-46.6 80ff00:-45.6 66ff00:-44.6 4dff00:-43.6 33ff00:-42.6 ' +
  '1aff00:-41.6 00ff00:-40.6 00ea0a:-39.6 00d413:-38.6 00bf1d:-37.6 00aa26:-36.6 009530:-35.6 00803a:-34.6 ' +
  '006a43:-33.6 00554d:-32.6 004056:-31.6 002a60:-30.85 001569:-30.35 000073:-29.85 00007d:-29.35 000d7a:-28.85 ' +
  '001a81:-28.35 002688:-27.85 00338f:-27.35 004096:-26.85 004c9d:-26.35 0059a4:-25.85 0066ab:-25.35 0073b2:-24.85 ' +
  '0080b9:-24.35 008cc0:-23.85 0099c7:-23.35 00a6ce:-22.85 00b2d5:-22.35 00bfdc:-21.85 00cce3:-21.35 00d9ea:-20.85 ' +
  '00e6f1:-20.35 00f2f8:-19.85 00ffff:-19.35'
)
  .split(' ')
  .map((entry) => {
    const [hex, celsius] = entry.split(':');
    const value = parseInt(hex, 16);
    return { r: value >> 16, g: (value >> 8) & 255, b: value & 255, celsius: Number(celsius) };
  });
// Untuk warna biasa, deret abu-abu hangat ikut dicocokkan: campuran abu-abu dan
// sian di tepi awan (mis. 150,195,200) paling dekat ke abu-abu, bukan ke ungu
// −80 °C. Warna yang sudah dikenali dingin (merah tua, ungu) tidak, supaya
// campuran merah tua dan abu-abu inti badai (mis. 50,24,24) tidak terbaca panas.
const WITH_WARM_GRAYS = COLOR_ENTRIES.concat(
  Array.from({ length: WARM_TOP }, (_, k) => ({ r: k + 1, g: k + 1, b: k + 1, celsius: warmGrayCelsius(k + 1) })),
);

// Warna petak sangat berulang, jadi hasil pencocokan disimpan.
const celsiusByRgb = [new Map(), new Map()];
function colorCelsius(r, g, b, cold = classify(r, g, b) === COLD) {
  const cache = celsiusByRgb[cold ? 1 : 0];
  const key = (r << 16) | (g << 8) | b;
  let celsius = cache.get(key);
  if (celsius === undefined) {
    let best = Infinity;
    for (const e of cold ? COLOR_ENTRIES : WITH_WARM_GRAYS) {
      const d = (e.r - r) ** 2 + (e.g - g) ** 2 + (e.b - b) ** 2;
      if (d < best) {
        best = d;
        celsius = e.celsius;
      }
    }
    if (cache.size < 50_000) cache.set(key, celsius);
  }
  return celsius;
}

// ---------- Skala tampilan "awan putih" ----------
// Awan tampil putih kebiruan yang makin pekat makin dingin (makin tinggi).
// Hanya puncak awan hujan konvektif (≤ −40 °C) yang berwarna, dari kuning
// pucat lewat jingga dan merah sampai ungu untuk inti badai. Permukaan dan
// awan rendah yang hangat transparan.
// Puncak awan hujan, sama di kedua nada peta dasar.
const STORM_STOPS = [
  { c: -50, rgb: [253, 224, 140], alpha: 0.75 },
  { c: -60, rgb: [251, 146, 60], alpha: 0.82 },
  { c: -70, rgb: [239, 68, 68], alpha: 0.87 },
  { c: -80, rgb: [190, 24, 93], alpha: 0.9 },
  { c: -90, rgb: [112, 26, 117], alpha: 0.92 },
];

// Peta dasar gelap (dan citra satelit): awan putih.
export const CLOUD_STOPS = [
  { c: 5, rgb: [226, 232, 240], alpha: 0 },
  { c: -10, rgb: [226, 232, 240], alpha: 0.22 },
  { c: -30, rgb: [236, 241, 247], alpha: 0.5 },
  { c: -40, rgb: [244, 247, 251], alpha: 0.62 },
  ...STORM_STOPS,
];

// Peta dasar terang: awan putih tidak terlihat, jadi abu-abu kebiruan.
export const CLOUD_STOPS_LIGHT = [
  { c: 5, rgb: [100, 116, 139], alpha: 0 },
  { c: -10, rgb: [100, 116, 139], alpha: 0.2 },
  { c: -30, rgb: [90, 105, 128], alpha: 0.38 },
  { c: -40, rgb: [80, 94, 117], alpha: 0.48 },
  ...STORM_STOPS,
];

export function cloudColor(celsius, { light = false } = {}) {
  const stops = light ? CLOUD_STOPS_LIGHT : CLOUD_STOPS;
  if (celsius >= stops[0].c) return [...stops[0].rgb, stops[0].alpha];
  for (let s = 1; s < stops.length; s++) {
    const lo = stops[s];
    if (celsius < lo.c) continue;
    const hi = stops[s - 1];
    const t = (hi.c - celsius) / (hi.c - lo.c);
    const mix = (a, b) => a + (b - a) * t;
    return [...hi.rgb.map((v, k) => Math.round(mix(v, lo.rgb[k]))), mix(hi.alpha, lo.alpha)];
  }
  const last = stops.at(-1);
  return [...last.rgb, last.alpha];
}

export const cloudCss = (celsius, options) => {
  const [r, g, b, a] = cloudColor(celsius, options);
  return `rgb(${r} ${g} ${b} / ${a.toFixed(2)})`;
};

// Tabel warna per 0,25 °C untuk kedua nada peta dasar.
const TEMP_MIN = -95;
const TEMP_STEP = 0.25;
const TEMP_STEPS = Math.round((60 - TEMP_MIN) / TEMP_STEP) + 1;
function buildLut(light) {
  const lut = new Uint8ClampedArray(TEMP_STEPS * 4);
  for (let t = 0; t < TEMP_STEPS; t++) {
    const [r, g, b, a] = cloudColor(TEMP_MIN + t * TEMP_STEP, { light });
    lut.set([r, g, b, Math.round(a * 255)], 4 * t);
  }
  return lut;
}
const LUT_DARK = buildLut(false);
const LUT_LIGHT = buildLut(true);
