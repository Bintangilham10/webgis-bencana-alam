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

// Kelas indeks bahaya BNPB (nilai dibulatkan 3 desimal):
// rendah ≤ 0,333 < sedang ≤ 0,666 < tinggi. Warna standar InaRISK; kuningnya
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

// Variabel CSS untuk pil/lencana berwarna (.level-pill, .class-pill, .mag-badge).
export const pillStyle = ({ color, text }) => `--pill-bg:${color};--pill-fg:${text}`;

export const ANALYSIS_COLOR = '#0f5e96';
export const FAULT_COLOR = '#b3001b';
export const PLATE_COLOR = '#3d4451';
export const BOUNDARY_COLOR = '#56606e';
