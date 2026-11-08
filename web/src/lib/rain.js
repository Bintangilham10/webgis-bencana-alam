// Hujan satelit NASA GPM IMERG dari petak GIBS, diwarnai ulang di browser.
//
// Petak GIBS (layer IMERG_Precipitation_Rate_30min, colormap
// GPM_Precipitation_Rate) berupa PNG berpalet: tiap warna mewakili tepat satu
// selang laju hujan, tanpa penghalusan, jadi warna bisa dibaca balik menjadi
// mm/jam secara pasti. Ada 110 selang logaritmik mulai 0,1 mm/jam, tiap selang
// ×10^(1/40); selang terakhir ≥ 53,09 mm/jam. Di bawah 0,1 mm/jam transparan.
// Salju memakai selang yang sama dengan warna lain (tidak muncul di Indonesia).
//
// Warna baru mengikuti kategori intensitas hujan per jam BMKG (ringan 1–5,
// sedang 5–10, lebat 10–20, sangat lebat > 20 mm/jam): biru muda transparan
// untuk gerimis, makin pekat dan makin ungu untuk hujan makin lebat, supaya
// peta dasar tetap terbaca dan yang menonjol hanya hujan lebat.

const RAIN_HEX =
  '00764e 00784b 007b48 007e45 008142 00833e 00863a 008936 008c32 008e2e 009129 ' +
  '009424 00971f 00991a 009c14 009f0f 00a209 00a503 03a700 09aa00 10ad00 17b000 ' +
  '1eb200 26b500 2db800 35bb00 3dbd00 45c000 4ec300 56c600 5fc800 68cb00 72ce00 ' +
  '7bd100 85d400 8fd600 99d900 a3dc00 aedf00 b8e100 c3e400 cfe700 daea00 e6ec00 ' +
  'efed00 f2e600 f5e000 f7d900 fad200 fdca00 ffc201 ffb904 ffb006 ffa809 ffa00c ' +
  'ff980f ff9011 ff8814 ff8117 ff7a1a ff731c ff6c1f ff6522 ff5f25 ff5927 ff532a ' +
  'ff4d2d ff4730 ff4233 ff342c ff2626 ff2020 ff1a1a ff1313 ff0d0d ff0707 ff0101 ' +
  'fa0000 f30000 ed0000 e70000 e10000 da0000 d40000 ce0000 c80000 c20000 bb0000 ' +
  'b50000 af0000 a90000 a20000 9c0000 960000 900000 8a0000 830000 7d0000 770000 ' +
  '710000 6a0000 640000 5e0000 580000 520000 4b0000 450000 3f0000 390000 330000';
const SNOW_HEX =
  'b1faee aefaef aaf9ef a7f8f0 a4f8f1 a1f7f2 9ef6f3 9bf5f4 98f4f4 95f1f3 92eef2 ' +
  '8febf1 8ce7f0 89e4ef 86e0ee 84dded 81d9ec 7ed5ea 7cd1e9 79cde8 76c9e6 74c5e5 ' +
  '71c1e4 6fbde2 6db8e1 6ab4df 68b0dd 66abdc 63a7da 61a2d8 5f9ed7 5d99d5 5b95d3 ' +
  '5990d1 578ccf 5587cd 5383cb 517ec9 4f7ac7 4d75c5 4f73c4 4d70c5 4c6dc6 4b6ac7 ' +
  '4a66c9 4963ca 485fcb 465ccc 4558cd 4454ce 4350d0 424cd1 4048d2 3f44d3 3e40d4 ' +
  '3f3dd5 413cd7 433bd8 4539d9 4838da 4a37db 4d36dc 5035de 5334df 5632e0 5931e1 ' +
  '5c30e2 5f2fe4 632ee5 662de6 6a2be7 6a25e8 6a1fe8 6b19e9 6d14e9 6f12e5 7010e1 ' +
  '720fdd 740dd9 750cd5 770bd1 780acc 790ac7 7a0ac1 7a09bc 7b09b7 7b09b2 7b09ac ' +
  '7a08a7 7a08a2 79089d 780898 770792 76078d 740788 720683 70067d 6e0678 6c0673 ' +
  '69056e 660569 630563 5e045d 590456 54044f 4f0448 490342 44033c 3f0336 3a0330';

const MIN_MM = 0.1;
const BIN = 10 ** (1 / 40);

// RGB (r<<16|g<<8|b) → mm/jam, memakai nilai tengah (geometrik) tiap selang.
const MM_BY_RGB = new Map();
for (const hexes of [RAIN_HEX, SNOW_HEX]) {
  hexes.split(' ').forEach((hex, k) => MM_BY_RGB.set(parseInt(hex, 16), MIN_MM * BIN ** (k + 0.5)));
}

// data = RGBA dari getImageData. Hasil: mm/jam per piksel, 0 = tanpa hujan.
// Warna di luar palet (tidak pernah terlihat di petak GIBS) dianggap tanpa hujan.
export function decodeRain(data) {
  const values = new Float32Array(data.length / 4);
  for (let i = 0; i < values.length; i++) {
    if (data[4 * i + 3] === 0) continue;
    values[i] = MM_BY_RGB.get((data[4 * i] << 16) | (data[4 * i + 1] << 8) | data[4 * i + 2]) ?? 0;
  }
  return values;
}

// Titik warna skala baru (mm/jam). Di antaranya warna dan transparansi
// diinterpolasi pada skala logaritmik, jadi gradasinya halus.
export const RAIN_STOPS = [
  { mm: 0.1, rgb: [120, 175, 250], alpha: 0.32 },
  { mm: 1, rgb: [70, 140, 245], alpha: 0.58 },
  { mm: 5, rgb: [37, 99, 235], alpha: 0.72 },
  { mm: 10, rgb: [79, 70, 229], alpha: 0.8 },
  { mm: 20, rgb: [147, 51, 234], alpha: 0.88 },
  { mm: 50, rgb: [192, 38, 211], alpha: 0.92 },
];

// Kelas untuk legenda, sama dengan kategori intensitas hujan per jam BMKG.
export const RAIN_CLASSES = [
  { label: 'Sangat ringan', range: '< 1', mm: 0.4 },
  { label: 'Ringan', range: '1–5', mm: 2.2 },
  { label: 'Sedang', range: '5–10', mm: 7 },
  { label: 'Lebat', range: '10–20', mm: 14 },
  { label: 'Sangat lebat', range: '> 20', mm: 35 },
];

// Tabel warna 256 langkah dari 0,1 sampai 100 mm/jam (log10: −1 … 2).
const LUT_SIZE = 256;
const LOG_MIN = -1;
const LOG_SPAN = 3;
const LUT = new Uint8ClampedArray(LUT_SIZE * 4);
for (let i = 0; i < LUT_SIZE; i++) {
  const mm = 10 ** (LOG_MIN + (i / (LUT_SIZE - 1)) * LOG_SPAN);
  const [r, g, b, a] = rainColor(mm);
  LUT.set([r, g, b, Math.round(a * 255)], 4 * i);
}

export function rainColor(mm) {
  const stops = RAIN_STOPS;
  if (mm <= stops[0].mm) return [...stops[0].rgb, stops[0].alpha];
  for (let s = 1; s < stops.length; s++) {
    const hi = stops[s];
    if (mm > hi.mm) continue;
    const lo = stops[s - 1];
    const t = Math.log(mm / lo.mm) / Math.log(hi.mm / lo.mm);
    const mix = (a, b) => a + (b - a) * t;
    return [...lo.rgb.map((v, k) => Math.round(mix(v, hi.rgb[k]))), mix(lo.alpha, hi.alpha)];
  }
  const last = stops.at(-1);
  return [...last.rgb, last.alpha];
}

export const rainCss = (mm) => {
  const [r, g, b, a] = rainColor(mm);
  return `rgb(${r} ${g} ${b} / ${a.toFixed(2)})`;
};

// Tulis warna baru ke `out` (RGBA) dari mm/jam. Di bawah 0,1 mm/jam transparan;
// hasil interpolasi yang sedikit di bawah 0,1 memudar supaya tepi hujan lembut.
export function paintRain(values, out) {
  for (let i = 0; i < values.length; i++) {
    const mm = values[i];
    const o = 4 * i;
    if (!(mm > MIN_MM * 0.5)) {
      out[o + 3] = 0;
      continue;
    }
    const index = Math.max(0, Math.min(LUT_SIZE - 1, Math.round(((Math.log10(mm) - LOG_MIN) / LOG_SPAN) * (LUT_SIZE - 1))));
    out[o] = LUT[4 * index];
    out[o + 1] = LUT[4 * index + 1];
    out[o + 2] = LUT[4 * index + 2];
    // 0,05–0,1 mm/jam: memudar ke transparan.
    const fade = mm >= MIN_MM ? 1 : (mm - MIN_MM * 0.5) / (MIN_MM * 0.5);
    out[o + 3] = LUT[4 * index + 3] * fade;
  }
  return out;
}
