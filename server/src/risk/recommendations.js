// Saran kesiapsiagaan umum (mengacu panduan BNPB) untuk bahaya yang relevan
// di lokasi. Bukan pengganti arahan resmi BPBD setempat.
const BY_HAZARD = {
  gempa:
    'Gempa bumi: kenali tempat berlindung (di bawah meja kokoh) dan jalur keluar, kencangkan lemari dan rak ke dinding, serta siapkan tas siaga.',
  cuaca:
    'Cuaca ekstrem: pantau peringatan dini cuaca BMKG; saat angin kencang, jauhi pohon besar, baliho, dan bangunan rapuh.',
  banjir:
    'Banjir: simpan dokumen penting dalam wadah kedap air di tempat tinggi, pantau peringatan cuaca BMKG, dan kenali rute ke tempat yang lebih tinggi.',
  longsor:
    'Tanah longsor: saat hujan lebat, waspadai retakan tanah, pohon atau tiang yang miring, dan rembesan air di lereng; segera menjauh bila tanda itu muncul.',
  gunungapi:
    'Gunung api: ikuti status dan rekomendasi PVMBG di MAGMA, siapkan masker untuk hujan abu, dan patuhi radius larangan.',
};

const NEAR_FAULT_KM = 10;
const NEAR_ACTIVE_VOLCANO_KM = 30;

// Nama PuSGeN berbahasa Inggris: "Lembang Fault" → "Sesar Lembang"
// (sama dengan faultDisplayName di web/src/layers/reference.js).
const faultDisplayName = (nama) => (/\s*fault$/i.test(nama) ? `Sesar ${nama.replace(/\s*fault$/i, '')}` : nama);

export function recommendations({ hazards, indications, fault, volcanoes }) {
  const tips = [];

  for (const indication of indications.filter((i) => i.level > 0)) {
    tips.push(
      `Indikasi ${indication.label.toLowerCase()} ${indication.hazard} dalam 3 hari: pantau peringatan resmi BMKG dan informasi BPBD setempat.`,
    );
  }

  const relevant = hazards.filter((h) => h.class && h.class.id !== 'rendah');
  for (const hazard of relevant) tips.push(BY_HAZARD[hazard.id]);

  if (fault && fault.distance_km <= NEAR_FAULT_KM) {
    tips.push(
      `Lokasi sekitar ${String(fault.distance_km).replace('.', ',')} km dari ${faultDisplayName(fault.nama)} (sesar aktif): utamakan bangunan tahan gempa dan latihan evakuasi rutin.`,
    );
  }

  for (const v of volcanoes.filter((v) => v.level >= 2 && v.distance_km <= NEAR_ACTIVE_VOLCANO_KM)) {
    tips.push(`Gunung ${v.nama} berstatus ${v.level_label} (${String(v.distance_km).replace('.', ',')} km): ikuti radius aman yang ditetapkan PVMBG.`);
  }

  tips.push('Simpan nomor darurat: 112 (panggilan darurat), 117 (BNPB), 115 (Basarnas).');
  return [...new Set(tips)];
}
