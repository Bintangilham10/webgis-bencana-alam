// Kelas kedalaman gempa yang umum dipakai BMKG/USGS.
export function depthClass(depthKm) {
  if (depthKm < 60) return 'dangkal';
  if (depthKm <= 300) return 'menengah';
  return 'dalam';
}

// Teks "Potensi" BMKG, mis. "Tidak berpotensi tsunami" atau "Berpotensi tsunami".
export function hasTsunamiPotential(potensi) {
  if (!potensi) return false;
  return /berpotensi\s+tsunami/i.test(potensi) && !/tidak\s+berpotensi/i.test(potensi);
}

export const VOLCANO_LEVELS = {
  1: 'Normal',
  2: 'Waspada',
  3: 'Siaga',
  4: 'Awas',
};
