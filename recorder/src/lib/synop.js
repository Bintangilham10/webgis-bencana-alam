// Pembaca laporan sinoptik (SYNOP, sandi WMO FM 12) stasiun cuaca darat.
//
// Stasiun meteorologi BMKG mengirim laporan ini tiap 3 jam ke jaringan
// pertukaran data WMO (GTS). Isinya hasil ukur alat di stasiun: hujan dari
// penakar, suhu, dan cuaca saat pengamatan. Yang dibaca di sini hanya yang
// dipakai SIGAP; kelompok lain (tekanan, awan, radiasi) dilewati.
//
// Susunan satu buletin:
//   SMID02 WIIX 110000            kepala buletin: jenis+negara, pusat pengirim, tanggal+jam UTC
//   AAXX 11004                    tanggal 11, jam 00 UTC, satuan angin
//   97014 12560 41002 10287 20249 30027 40139 53012 60214 82231
//     333 20236 50600 55041 56000 59001 82820=
// Kelompok pertama = nomor stasiun WMO; "333" membuka seksi 3; "=" menutup laporan.

// tR pada kelompok 6RRRtR: lama periode hujan (jam) yang berakhir pada jam pengamatan.
export const RAIN_PERIOD_HOURS = { 1: 6, 2: 12, 3: 18, 4: 24, 5: 1, 6: 2, 7: 3, 8: 9, 9: 15 };

// Jam utama 00 UTC melaporkan hujan 24 jam (07.00 WIB kemarin–07.00 WIB hari ini),
// jam utama lain 6 jam, jam antara 3 jam. Dipakai bila stasiun menyatakan tidak
// ada hujan (iR = 3), sehingga kelompok hujannya tidak dikirim.
export function standardRainHours(hourUtc) {
  if (hourUtc === 0) return 24;
  return hourUtc % 6 === 0 ? 6 : 3;
}

const SEPARATOR = /####\d+####/;
const HEADER = /^([A-Z]{4}\d{2}) ([A-Z]{4}) (\d{2})(\d{2})(\d{2})(?: ([A-Z]{3}))?$/;
const GROUP = /^[\d/]{5}$/;
const pad = (n) => String(n).padStart(2, '0');

// Berkas gerbang NOAA berisi banyak buletin yang dipisah baris "####018002183####".
// Hasil: [{ ttaaii, center, day, hour, minute, bbb, body }]; bbb = RRA/CCA dst.
// untuk buletin susulan atau koreksi.
export function splitBulletins(text) {
  const bulletins = [];
  for (const chunk of String(text).split(SEPARATOR)) {
    const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const match = HEADER.exec(lines[0] ?? '');
    if (!match) continue;
    const [, ttaaii, center, day, hour, minute, bbb] = match;
    bulletins.push({
      ttaaii,
      center,
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      bbb: bbb ?? null,
      body: lines.slice(1).join(' '),
    });
  }
  return bulletins;
}

// Buletin SYNOP dari Indonesia: SM (jam utama), SI (jam antara), SN (jam lain),
// kode negara ID.
export const isIndonesianSynop = (bulletin) => /^S[MIN]ID\d\d$/.test(bulletin.ttaaii);

// Laporan mentah dalam satu buletin: [{ wmo, day, hour, raw }].
// "AAXX YYGGi" bisa muncul lebih dari sekali; laporan NIL (tidak ada data) dilewati.
export function splitReports(body) {
  const reports = [];
  let context = null;
  for (const chunk of String(body).split('=')) {
    let tokens = chunk.trim().split(/\s+/).filter(Boolean);
    const at = tokens.indexOf('AAXX');
    if (at !== -1) {
      const group = tokens[at + 1] ?? '';
      context = /^\d{4}[\d/]$/.test(group) ? { day: Number(group.slice(0, 2)), hour: Number(group.slice(2, 4)) } : null;
      tokens = tokens.slice(at + 2);
    }
    if (!context || !/^\d{5}$/.test(tokens[0] ?? '') || tokens.includes('NIL') || tokens.length < 3) continue;
    reports.push({ wmo: tokens[0], ...context, raw: tokens.join(' ') });
  }
  return reports;
}

// RRR: 001–988 = mm, 989 = 989 mm atau lebih, 990 = ada hujan tetapi tak terukur
// (< 0,1 mm), 991–999 = 0,1–0,9 mm.
export function decodeRainGroup(group) {
  const rrr = Number(group.slice(1, 4));
  const hours = RAIN_PERIOD_HOURS[group[4]];
  if (!Number.isInteger(rrr) || !hours) return null;
  if (rrr === 990) return { mm: 0, hours, trace: true };
  return { mm: rrr > 990 ? (rrr - 990) / 10 : rrr, hours, trace: false };
}

// snTTT: sn 0 = positif, 1 = negatif; TTT persepuluh °C.
function decodeTemperature(group) {
  const value = Number(group.slice(2, 5));
  if ((group[1] !== '0' && group[1] !== '1') || !Number.isInteger(value)) return null;
  return (group[1] === '1' ? -value : value) / 10;
}

// 7R24R24R24R24 di seksi 3: hujan 24 jam persepuluh mm; 9999 = tak terukur.
function decodeRain24(group) {
  if (!/^\d{4}$/.test(group.slice(1))) return null;
  const tenths = Number(group.slice(1));
  return tenths === 9999 ? 0 : tenths / 10;
}

// Cara membaca kelompok bernomor: seksi → digit pertama kelompok → field laporan.
// Nilai pertama yang terbaca dipakai (kelompok tidak diulang dalam laporan yang benar).
const READERS = {
  1: {
    1: (report, group) => (report.tempC ??= decodeTemperature(group)),
    6: (report, group) => (report.rain ??= decodeRainGroup(group)),
    7: (report, group) => {
      if (/^\d\d$/.test(group.slice(1, 3))) report.weather ??= Number(group.slice(1, 3));
    },
  },
  3: {
    1: (report, group) => (report.tempMaxC ??= decodeTemperature(group)),
    2: (report, group) => (report.tempMinC ??= decodeTemperature(group)),
    6: (report, group) => (report.rain3 ??= decodeRainGroup(group)),
    7: (report, group) => (report.rain24Mm ??= decodeRain24(group)),
  },
};

// Penanda seksi: "333", "444", "555", atau "222Dv" (seksi laut stasiun pantai).
function sectionMark(group) {
  if (group === '333') return 3;
  if (group === '444') return 4;
  if (group === '555') return 5;
  return /^222[\d/]{2}$/.test(group) ? 2 : null;
}

// Kelompok radiasi di seksi 3 didahului penanda 55407/55408/55507/55508 dan
// angkanya bisa menyerupai kelompok lain, jadi kelompok sesudah penanda dilewati.
const RADIATION_MARK = /^55[45]0[78]$/;

// Seksi 1 diawali iRixhVV dan Nddff; bila kecepatan angin ≥ 99 satuan ada
// kelompok tambahan 00fff sebelum kelompok bernomor.
const firstNumberedGroup = (tokens) => (tokens[2]?.slice(3) === '99' && /^00\d{3}$/.test(tokens[3] ?? '') ? 4 : 3);

// Satu laporan → hujan, cuaca, dan suhu. Field yang tidak dikirim stasiun = null.
//   precipIndicator (iR): 0 = hujan di seksi 1 dan 3, 1 = seksi 1, 2 = seksi 3,
//     3 = tidak ada hujan (kelompok tidak dikirim), 4 = hujan tidak diukur.
//   rain  = kelompok 6RRRtR seksi 1 (di Indonesia: 24 jam pada 00 UTC, 6 jam pada 06/12/18 UTC)
//   rain3 = kelompok 6RRRtR seksi 3 (biasanya 3 jam)
//   rain24Mm = kelompok 7R24 seksi 3 (jarang dipakai di Indonesia)
//   weather = sandi cuaca saat pengamatan (ww, 00–99); noSignificantWeather =
//     pengamat menyatakan tidak ada cuaca bermakna (ix = 2 atau 5), jadi ww tidak dikirim
export function decodeReport(raw) {
  const tokens = String(raw).trim().split(/\s+/);
  const [wmo, first] = tokens;
  if (!/^\d{5}$/.test(wmo ?? '') || !GROUP.test(first ?? '')) return null;
  const report = {
    wmo,
    precipIndicator: /\d/.test(first[0]) ? Number(first[0]) : null,
    rain: null,
    rain3: null,
    rain24Mm: null,
    weather: null,
    noSignificantWeather: first[1] === '2' || first[1] === '5',
    tempC: null,
    tempMaxC: null,
    tempMinC: null,
  };

  let section = 1;
  for (let index = firstNumberedGroup(tokens); index < tokens.length; index++) {
    const group = tokens[index];
    const mark = sectionMark(group);
    if (mark) section = mark;
    else if (section === 3 && RADIATION_MARK.test(group)) index++;
    else if (GROUP.test(group)) READERS[section]?.[group[0]]?.(report, group);
  }
  return report;
}

// Hujan yang dilaporkan pada jam itu: { mm, hours, trace } atau null bila stasiun
// tidak melaporkannya. Stasiun yang menyatakan tidak ada hujan (iR = 3) dihitung
// 0 mm untuk periode baku jam tersebut.
export function reportedRain(report, hourUtc) {
  if (report.rain) return report.rain;
  if (report.precipIndicator === 3) return { mm: 0, hours: standardRainHours(hourUtc), trace: false };
  if (report.rain24Mm !== null) return { mm: report.rain24Mm, hours: 24, trace: false };
  return null;
}

// Laporan boleh terlambat paling lama dua hari, dan jam pengamatannya paling
// jauh sejam sesudah waktu berkas (jam laporan dibulatkan ke atas).
const MAX_LATE_MS = 48 * 3_600_000;
const MAX_AHEAD_MS = 3_600_000;

// Laporan hanya memuat tanggal (1–31) dan jam. Bulan dan tahunnya diambil dari
// waktu berkas (`now`): bulan itu atau bulan sebelumnya, selama masih di dalam
// batas di atas. Di luar itu (tanggal salah ketik) hasilnya null.
export function observationTime(day, hour, now) {
  const reference = new Date(now);
  if (Number.isNaN(reference.getTime()) || !(day >= 1 && day <= 31) || !(hour >= 0 && hour <= 23)) return null;
  for (let back = 0; back < 2; back++) {
    const candidate = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - back, day, hour));
    // Tanggal 31 di bulan 30 hari melompat ke bulan berikutnya; lewati.
    if (candidate.getUTCDate() !== day) continue;
    const age = reference.getTime() - candidate.getTime();
    if (age <= MAX_LATE_MS && age >= -MAX_AHEAD_MS) return candidate.toISOString();
  }
  return null;
}

// Semua laporan SYNOP Indonesia dalam satu berkas gerbang NOAA:
// [{ wmo, observed_at, bulletin, raw }]. `now` = waktu berkas diubah.
export function indonesianReports(text, now) {
  const reports = [];
  for (const bulletin of splitBulletins(text).filter(isIndonesianSynop)) {
    const stamp = `${pad(bulletin.day)}${pad(bulletin.hour)}${pad(bulletin.minute)}`;
    const label = [bulletin.ttaaii, bulletin.center, stamp, bulletin.bbb].filter(Boolean).join(' ');
    for (const report of splitReports(bulletin.body)) {
      const observedAt = observationTime(report.day, report.hour, now);
      if (observedAt) reports.push({ wmo: report.wmo, observed_at: observedAt, bulletin: label, raw: report.raw });
    }
  }
  return reports;
}

// Sandi cuaca saat pengamatan (ww) → teks singkat: [dari, sampai, teks]. Hanya
// yang berkaitan dengan hujan, badai, dan jarak pandang; sandi lain (keadaan
// awan, salju) tanpa teks.
const WEATHER_LABELS = [
  [5, 5, 'Udara kabur (asap atau debu)'],
  [10, 10, 'Kabut tipis'],
  [13, 13, 'Kilat terlihat'],
  [14, 16, 'Hujan terlihat di sekitar stasiun'],
  [17, 17, 'Guntur tanpa hujan'],
  [18, 18, 'Angin kencang mendadak'],
  [21, 21, 'Hujan sejam terakhir'],
  [25, 25, 'Hujan sejam terakhir'],
  [29, 29, 'Badai petir sejam terakhir'],
  [40, 49, 'Kabut'],
  [50, 59, 'Gerimis'],
  [60, 61, 'Hujan ringan'],
  [62, 63, 'Hujan sedang'],
  [64, 65, 'Hujan lebat'],
  [80, 80, 'Hujan lokal ringan'],
  [81, 81, 'Hujan lokal sedang atau lebat'],
  [82, 82, 'Hujan lokal sangat lebat'],
  [91, 94, 'Hujan setelah badai petir'],
  [95, 96, 'Badai petir'],
  [97, 99, 'Badai petir lebat'],
];

export const weatherLabel = (ww) => WEATHER_LABELS.find(([from, to]) => ww >= from && ww <= to)?.[2] ?? null;
