// Satu tempat untuk warna dan ukuran simbol, supaya peta dan legenda selalu cocok.

export const DEPTH_CLASSES = [
  { id: 'dangkal', label: 'Dangkal (< 60 km)', color: '#d7301f' },
  { id: 'menengah', label: 'Menengah (60–300 km)', color: '#fc8d59' },
  { id: 'dalam', label: 'Dalam (> 300 km)', color: '#fdd49e' },
];
export const depthColor = (depthClass) => DEPTH_CLASSES.find((c) => c.id === depthClass)?.color ?? '#999';

// Luas lingkaran tumbuh seiring magnitudo tanpa membuat gempa besar menutupi peta.
export const magnitudeRadius = (magnitude) => Math.max(4, (magnitude * magnitude) / 2);

// Warna resmi tingkat aktivitas gunung api PVMBG.
export const VOLCANO_LEVELS = {
  1: { label: 'Level I · Normal', color: '#2e7d32' },
  2: { label: 'Level II · Waspada', color: '#f9a825' },
  3: { label: 'Level III · Siaga', color: '#ef6c00' },
  4: { label: 'Level IV · Awas', color: '#c62828' },
};

// Kelas indeks bahaya BNPB: rendah < 0,333 ≤ sedang < 0,666 ≤ tinggi.
export const HAZARD_CLASSES = [
  { label: 'Rendah', rgb: [56, 168, 0] },
  { label: 'Sedang', rgb: [255, 200, 0] },
  { label: 'Tinggi', rgb: [230, 0, 0] },
];

export const FAULT_COLOR = '#b3001b';
export const PLATE_COLOR = '#3d4451';
export const BOUNDARY_COLOR = '#56606e';
