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

const HAZARD_NAMES = { hujan: 'hujan lebat', banjir: 'banjir', longsor: 'tanah longsor' };

const NEAR_FAULT_KM = 10;
const NEAR_ACTIVE_VOLCANO_KM = 30;

// Nama PuSGeN berbahasa Inggris: "Lembang Fault" → "Sesar Lembang"
// (sama dengan faultDisplayName di web/src/layers/reference.js).
const faultDisplayName = (nama) => (/\s*fault$/i.test(nama) ? `Sesar ${nama.replace(/\s*fault$/i, '')}` : nama);

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const monthName = (yyyymm) => {
  const [year, month] = yyyymm.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
};

// Saran dari produk resmi longsor dan hujan: potensi gerakan tanah PVMBG bulan
// ini dan peringatan dini curah hujan tinggi BMKG untuk dasarian ini.
function landslideTips(landslide, place) {
  const tips = [];
  const potensi = landslide?.potential?.potensi?.toLowerCase();
  if (potensi === 'tinggi' || potensi === 'menengah') {
    tips.push(
      `Prakiraan PVMBG ${monthName(landslide.potential.month)}: potensi gerakan tanah ${potensi} di lokasi ini. ` +
        'Saat dan setelah hujan lebat, hindari tebing dan lereng terjal, lalu perhatikan retakan tanah dan air keruh dari lereng.',
    );
  }
  const warning = landslide?.rain_warning;
  if (warning?.level >= 1) {
    const where = place ? place.nama : 'wilayah ini';
    tips.push(
      `BMKG: peringatan dini curah hujan tinggi level ${warning.label.toLowerCase()} untuk ${where} ` +
        `(${warning.dasarian.start} s.d. ${warning.dasarian.end}). Hujan tinggi berturut-turut meningkatkan peluang banjir dan longsor.`,
    );
  }
  return tips;
}

export function recommendations({ hazards, indications, fault, volcanoes, landslide = null, place = null, status = 'indonesia' }) {
  if (status === 'luar_indonesia') {
    return ['Lokasi ini di luar wilayah Indonesia. SIGAP hanya menilai risiko di Indonesia; ikuti informasi otoritas setempat.'];
  }
  const tips = [];

  for (const indication of indications.filter((i) => i.level > 0)) {
    tips.push(
      `Indikasi ${indication.label.toLowerCase()} ${HAZARD_NAMES[indication.hazard] ?? indication.hazard} dalam 3 hari: pantau peringatan resmi BMKG dan informasi BPBD setempat.`,
    );
  }

  tips.push(...landslideTips(landslide, place));

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
