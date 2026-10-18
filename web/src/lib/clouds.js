// Petak inframerah Himawari-9 dari NASA GIBS (Band 13 Clean Infrared) berupa
// gambar penuh yang diwarnai menurut suhu puncak awan (palet Worldview
// "Clean_Longwave_Infrared_Window_Band"):
//   ≥ −19 °C  abu-abu, makin gelap makin hangat (#c5c5c5 di −19 °C, #939393 di 0 °C)
//   −19..−70  sian, biru, hijau, kuning, jingga, merah, merah gelap
//   −70..−80  abu-abu lagi, dari #050505 (−70) sampai #e6e6e6 (−80)
//   < −80     ungu-merah muda, lalu putih di bawah −91 °C
// cloudsOnly() mengubahnya menjadi lapisan awan saja: permukaan dan awan rendah
// yang hangat transparan, awan makin pekat makin dingin, dan warna puncak awan
// dingin tetap.
//
// Abu-abu −70..−80 °C (inti badai) tidak bisa dibedakan dari abu-abu hangat
// lewat warnanya, jadi dinilai per wilayah abu-abu yang bersambung: inti badai
// hanya bertetangga dengan merah gelap (−60..−70 °C) atau ungu/putih (< −80 °C),
// sedangkan abu-abu hangat bertetangga dengan sian (−19 °C) dan warna lain.

// Abu-abu hangat: ≤ 112 (±+14 °C, laut dan darat tanpa awan) transparan, makin
// terang sampai 197 (−19 °C) makin pekat.
const WARM_CLEAR = 112;
const WARM_TOP = 197;
const WARM_ALPHA = 170;
const COLD_ALPHA = 225;
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

function classify(r, g, b) {
  if (Math.max(r, g, b) - Math.min(r, g, b) <= 24) return r >= COLD_GRAY_MIN ? COLD : GRAY;
  const darkRed = r > g + 20 && g < 60 && b < 40;
  const purple = r > g + 40 && b > g + 40;
  return darkRed || purple ? COLD : COLOR;
}

// data = RGBA dari getImageData (diubah di tempat), width = lebar petak.
export function cloudsOnly(data, width) {
  const count = data.length / 4;
  const height = count / width;
  const kind = new Uint8Array(count);
  for (let i = 0; i < count; i++) kind[i] = classify(data[4 * i], data[4 * i + 1], data[4 * i + 2]);

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
          if (kind[j] === COLD) coldBorder++;
          else if (kind[j] === COLOR) colorBorder++;
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

  for (let i = 0; i < count; i++) {
    const a = 4 * i + 3;
    if (data[a] === 0) continue; // di luar cakram Himawari
    if (kind[i] !== GRAY || core[i]) {
      data[a] = COLD_ALPHA;
      continue;
    }
    const value = Math.min(data[4 * i], WARM_TOP);
    data[a] = value <= WARM_CLEAR ? 0 : Math.round(((value - WARM_CLEAR) / (WARM_TOP - WARM_CLEAR)) * WARM_ALPHA);
  }
  return data;
}
