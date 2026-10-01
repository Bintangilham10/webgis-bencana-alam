// Satu tempat untuk warna dan ukuran simbol, supaya peta, legenda, dan panel
// selalu cocok. `text` = warna teks di atas warna tersebut: putih atau gelap,
// dipilih supaya kontrasnya memenuhi WCAG AA (≥ 4,5:1).
export const INK = '#111c2a';

export const DEPTH_CLASSES = [
  { id: 'dangkal', label: 'Dangkal (< 60 km)', color: '#d7301f', text: '#fff' },
  { id: 'menengah', label: 'Menengah (60–300 km)', color: '#fc8d59', text: INK },
  { id: 'dalam', label: 'Dalam (> 300 km)', color: '#fdd49e', text: INK },
];
export const depthClass = (id) => DEPTH_CLASSES.find((c) => c.id === id) ?? { color: '#98a2b3', text: INK };
export const depthColor = (id) => depthClass(id).color;

// Luas lingkaran tumbuh seiring magnitudo tanpa membuat gempa besar menutupi peta.
export const magnitudeRadius = (magnitude) => Math.max(4, (magnitude * magnitude) / 2);

// Warna resmi tingkat aktivitas gunung api PVMBG.
export const VOLCANO_LEVELS = {
  1: { label: 'Level I · Normal', roman: 'I', short: 'Normal', color: '#2e7d32', text: '#fff' },
  2: { label: 'Level II · Waspada', roman: 'II', short: 'Waspada', color: '#f9a825', text: INK },
  3: { label: 'Level III · Siaga', roman: 'III', short: 'Siaga', color: '#ef6c00', text: INK },
  4: { label: 'Level IV · Awas', roman: 'IV', short: 'Awas', color: '#c62828', text: '#fff' },
};

// Kelas indeks bahaya BNPB: rendah ≤ 1/3 < sedang ≤ 2/3 < tinggi (batas atas
// inklusif, lihat server/src/config/rules.json). Warna standar InaRISK; kuningnya
// kurang kontras di latar putih, jadi selalu disertai angka dan label kelas.
export const HAZARD_CLASSES = [
  { id: 'rendah', label: 'Rendah', rgb: [56, 168, 0], text: INK },
  { id: 'sedang', label: 'Sedang', rgb: [255, 200, 0], text: INK },
  { id: 'tinggi', label: 'Tinggi', rgb: [230, 0, 0], text: '#fff' },
].map((c) => ({ ...c, color: `rgb(${c.rgb.join(',')})` }));

// Level indikasi peringatan 0–3 memakai konvensi warna yang sama dengan
// tingkat aktivitas gunung api (hijau, kuning, oranye, merah).
export const WARNING_LEVEL_STYLES = [
  { label: 'Normal', color: '#2e7d32', text: '#fff' },
  { label: 'Waspada', color: '#f9a825', text: INK },
  { label: 'Siaga', color: '#ef6c00', text: INK },
  { label: 'Awas', color: '#c62828', text: '#fff' },
];

// Kab/kota tanpa data hujan pada indikasi SIGAP 3 hari (abu-abu, bukan level).
export const NO_DATA_STYLE = { label: 'Tanpa data', color: '#98a2b3', text: INK };

// Variabel CSS untuk pil/lencana berwarna (.level-pill, .class-pill, .mag-badge).
// Warna garis sesar, lempeng, batas wilayah, dan titik analisis mengikuti tema,
// jadi didefinisikan sebagai variabel CSS di styles/base.css.
export const pillStyle = ({ color, text }) => `--pill-bg:${color};--pill-fg:${text}`;

// ---------- Tanah longsor dan hujan ----------

// Kelas potensi gerakan tanah (prakiraan bulanan PVMBG) dan zona kerentanan
// (ZKGT) memakai warna kelas InaRISK, jadi satu arti warna berlaku untuk semua
// peta rawan. "Sangat rendah" dan di luar zona tidak diwarnai.
export const LANDSLIDE_CLASSES = {
  rendah: HAZARD_CLASSES[0],
  menengah: HAZARD_CLASSES[1],
  tinggi: HAZARD_CLASSES[2],
};
export const landslideClass = (label) => LANDSLIDE_CLASSES[String(label ?? '').trim().toLowerCase()] ?? null;
// Zona aliran bahan rombakan (lahar/debris flow) di peta ZKGT: biru kehijauan,
// jauh dari hijau–kuning–merah kelas kerentanan.
export const DEBRIS_FLOW = { label: 'Aliran bahan rombakan', rgb: [0, 139, 179], color: 'rgb(0,139,179)' };

// Peringatan dini curah hujan tinggi BMKG (CEWS): label BMKG, warna level
// peringatan SIGAP. Level 0 (Aman) tidak diwarnai di peta.
export const CEWS_LEVELS = WARNING_LEVEL_STYLES.map((style, level) => ({ ...style, label: ['Aman', 'Waspada', 'Siaga', 'Awas'][level] }));

// Riwayat longsor: segitiga ungu, makin gelap makin baru. Ungu dipilih supaya
// tidak tertukar dengan warna kedalaman gempa (merah–oranye) dan kelas bahaya.
export const LANDSLIDE_AGES = [
  { label: '2024–2025', from: 2024, color: '#6b21a8' },
  { label: '2021–2023', from: 2021, color: '#a855f7' },
  { label: '2020 dan sebelumnya', from: -Infinity, color: '#d8b4fe' },
];
export const landslideAgeColor = (year) => LANDSLIDE_AGES.find((age) => year >= age.from).color;

// Skala warna hujan satelit NASA GPM IMERG (colormap GIBS), mm/jam.
export const IMERG_RAMP = [
  { mm: '0,1', color: '#00764e' },
  { mm: '0,3', color: '#17b000' },
  { mm: '0,9', color: '#b8e100' },
  { mm: '1,3', color: '#f2e600' },
  { mm: '2,7', color: '#ff8814' },
  { mm: '7,5', color: '#ff0707' },
  { mm: '21', color: '#960000' },
];
