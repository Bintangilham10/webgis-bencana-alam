import { Router } from 'express';
import { query } from '../db.js';
import { memoize } from '../lib/cache.js';
import { hasTsunamiPotential } from '../lib/classify.js';
import { wibDate } from '../lib/recorder.js';
import {
  agreement,
  capLevel,
  combine,
  countKey,
  QUAKE_RULES,
  quakeRule,
  RULES_VERSION,
  STALE_AFTER_MS,
  VOLCANO_RADIUS_KM,
  volcanoLevel,
} from '../risk/sintesis.js';
import { levelFor } from '../sources/bmkg-cews.js';
import { fetchGdacsEvents } from '../sources/gdacs.js';
import { sourceStatuses } from '../sync-logs.js';
import { buildOutlook } from './outlook.js';
import { measuredRain } from './weather.js';

// Dashboard Sintesis: status tiap kab/kota dari CEWS, CAP, gempa, dan gunung api
// (aturan di risk/sintesis.js), Indikasi SIGAP di sampingnya, beserta bukti tiap
// komponen supaya panel "cara hitung" bisa menunjukkan asal angkanya.

const ATTRIBUTION =
  'Status sintesis SIGAP dari data resmi BMKG (CEWS, peringatan dini cuaca CAP, gempa) dan PVMBG (MAGMA); indikasi SIGAP ditampilkan terpisah. Bukan peringatan resmi.';
// CEWS diambil langsung dari BMKG (4 permintaan) bila belum ada di cache; dashboard
// tidak menunggu lebih dari ini dan menandai CEWS belum termuat.
const CEWS_WAIT_MS = 12_000;
const round = (x, digits = 1) => (x == null ? null : Math.round(Number(x) * 10 ** digits) / 10 ** digits);

const REGIONS = `
  SELECT k.kode, k.nama, k.induk_kode AS induk, p.nama AS provinsi,
         ST_YMin(k.geom) AS s, ST_XMin(k.geom) AS w, ST_YMax(k.geom) AS n, ST_XMax(k.geom) AS e,
         ST_Area(k.geom::geography) / 1e6 AS luas_km2
  FROM wilayah k JOIN wilayah p ON p.kode = k.induk_kode
  WHERE k.tingkat <> 'provinsi'
  ORDER BY k.kode`;

// Peringatan CAP yang sedang berlaku, per kab/kota (sama dengan notifikasi).
const CAP = `
  SELECT aw.kode, a.identifier, a.event, a.severity, a.headline, a.expires, a.utc_offset
  FROM cap_alerts a JOIN cap_alert_wilayah aw USING (identifier)
  WHERE a.expires > now() AND a.superseded_at IS NULL
  ORDER BY a.expires`;

// Gunung api Waspada ke atas: kab/kota lokasinya, atau yang batasnya dalam radius.
const VOLCANOES = `
  SELECT k.kode, v.kode AS id, v.nama, v.level, v.erupsi, v.vona, v.level_changed_at,
         ST_Contains(k.geom, v.geom) AS lokasi,
         ST_Distance(k.geom::geography, v.geom::geography) / 1000 AS jarak_km
  FROM volcanoes v
  JOIN wilayah k ON k.tingkat <> 'provinsi'
   AND k.geom && ST_Expand(v.geom, 0.1)
   AND (ST_Contains(k.geom, v.geom)
        OR ST_DWithin(k.geom::geography, v.geom::geography,
                      (CASE v.level WHEN 2 THEN $1::float8 WHEN 3 THEN $2::float8 ELSE $3::float8 END) * 1000))
  WHERE v.level >= 2`;

const QUAKES = `
  SELECT id, magnitude, depth_km, occurred_at, props->>'potensi' AS potensi, props->>'dirasakan' AS dirasakan,
         props->>'wilayah' AS wilayah, ST_X(geom) AS lon, ST_Y(geom) AS lat
  FROM events
  WHERE source = 'bmkg' AND hazard = 'gempa' AND occurred_at > now() - interval '24 hours'`;

// Kab/kota yang batasnya dalam radius tiap gempa (radius per gempa dari aturan).
const QUAKE_REGIONS = `
  SELECT k.kode, q.i::int AS i, ST_Distance(k.geom::geography, q.g::geography) / 1000 AS jarak_km
  FROM (SELECT i, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS g, radius_km
        FROM unnest($1::float8[], $2::float8[], $3::float8[]) WITH ORDINALITY AS u(lon, lat, radius_km, i)) q
  JOIN wilayah k ON k.tingkat <> 'provinsi'
   AND k.geom && ST_Expand(q.g, q.radius_km / 100.0 + 0.1)
   AND ST_DWithin(k.geom::geography, q.g::geography, q.radius_km * 1000)`;

const EXPOSURE = `
  SELECT kode,
         max(tinggi_km2) FILTER (WHERE hazard = 'banjir') AS banjir_km2,
         max(tinggi_km2) FILTER (WHERE hazard = 'longsor') AS longsor_km2
  FROM wilayah_bahaya GROUP BY kode`;

// Gempa BMKG M ≥ 5 berumur 2–9 hari (katalog luar sering baru merevisi setelah
// sehari) dan pasangannya di tiap katalog pembanding: selisih ≤ 60 detik, ≤ 100 km
// (sama dengan routes/earthquakes.js).
const QUAKE_MATCH = `
  SELECT e.id, e.magnitude, src.source,
         m.magnitude AS m_magnitude, m.dt AS m_dt,
         -- Gempa sebelum data pertama katalog itu di SIGAP tidak bisa dicocokkan.
         e.occurred_at >= (SELECT min(c.occurred_at) FROM events c WHERE c.hazard = 'gempa' AND c.source = src.source) AS tercakup
  FROM events e
  CROSS JOIN (VALUES ('usgs'), ('emsc'), ('gfz')) AS src(source)
  LEFT JOIN LATERAL (
    SELECT o.magnitude, abs(extract(epoch FROM o.occurred_at - e.occurred_at)) AS dt
    FROM events o
    WHERE o.hazard = 'gempa' AND o.source = src.source
      AND o.occurred_at BETWEEN e.occurred_at - interval '60 seconds' AND e.occurred_at + interval '60 seconds'
      AND ST_DWithin(o.geom::geography, e.geom::geography, 100000)
    ORDER BY abs(extract(epoch FROM o.occurred_at - e.occurred_at))
    LIMIT 1
  ) m ON true
  WHERE e.source = 'bmkg' AND e.hazard = 'gempa' AND e.magnitude >= 5
    AND e.occurred_at BETWEEN now() - interval '9 days' AND now() - interval '2 days'`;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function quakeAgreement(rows) {
  const bmkg = new Set(rows.map((r) => r.id));
  const confirmed = new Set(rows.filter((r) => r.m_magnitude !== null).map((r) => r.id));
  return {
    n: bmkg.size,
    // Gempa BMKG yang juga tercatat di paling sedikit satu katalog luar.
    terverifikasi: confirmed.size,
    catalogs: ['usgs', 'emsc', 'gfz'].map((source) => {
      const covered = rows.filter((r) => r.source === source && r.tercakup);
      const pairs = covered.filter((r) => r.m_magnitude !== null);
      return {
        source,
        // Pembagi per katalog: gempa BMKG dalam rentang data katalog itu.
        n: covered.length,
        matched: pairs.length,
        median_dm: round(median(pairs.map((r) => Math.abs(r.magnitude - r.m_magnitude))), 2),
        median_dt_s: round(median(pairs.map((r) => Number(r.m_dt))), 1),
      };
    }),
  };
}

const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
};

function freshness(statuses, id, now) {
  const s = statuses.find((x) => x.source === id);
  const lastOk = s?.last_ok_at ? new Date(s.last_ok_at) : null;
  const stale = !lastOk || now - lastOk.getTime() > STALE_AFTER_MS[id];
  return {
    id,
    last_ok_at: lastOk?.toISOString() ?? null,
    ok: s ? s.ok : null,
    runs_24h: s?.runs_24h ?? 0,
    failures_24h: s?.failures_24h ?? 0,
    stale,
  };
}

function withTimeout(promise, message = 'CEWS BMKG belum termuat') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), CEWS_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

// BMKG baru menerbitkan daftar CEWS beberapa saat (kadang 1–2 hari) setelah
// dasarian baru mulai. Selama itu dipakai daftar dasarian sebelumnya, ditandai
// `sebelumnya` supaya dashboard menyebutnya terus terang.
// Daftar dasarian sebelumnya hanya dipakai pada hari-hari pertama dasarian baru;
// lewat dari itu CEWS dianggap tanpa data (kab/kota Normal menjadi belum pasti).
const PREVIOUS_CEWS_DAYS = 5;

async function loadCews(rainWarnings, now) {
  const load = async () => {
    const current = await rainWarnings(now);
    if (current.published) return current;
    const start = Date.parse(`${current.dasarian.start}T00:00:00+07:00`);
    if (now - start > PREVIOUS_CEWS_DAYS * 86_400_000) return current;
    const previous = await rainWarnings(new Date(start - 12 * 3_600_000));
    if (!previous.published) return current;
    return { ...previous, sebelumnya: true, dasarian_berjalan: current.dasarian };
  };
  try {
    // Satu tenggat untuk kedua permintaan, bukan tenggat masing-masing.
    return await withTimeout(load());
  } catch (err) {
    return { error: err.message };
  }
}

// Kab/kota terdekat untuk titik-titik (lon, lat): yang memuatnya, atau yang
// terdekat dalam maxKm (titik di laut dekat pantai). Hasil: indeks titik → wilayah.
const NEAREST_REGION = `
  SELECT u.i::int AS i, w.kode, ST_Distance(w.geom::geography, u.g::geography) / 1000 AS jarak_km
  FROM (SELECT i, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS g
        FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS u(lon, lat, i)) u
  CROSS JOIN LATERAL (
    SELECT kode, geom FROM wilayah
    WHERE tingkat <> 'provinsi' AND geom && ST_Expand(u.g, 1)
    ORDER BY ST_Distance(geom, u.g) LIMIT 1
  ) w`;

async function nearestRegions(points, maxKm) {
  if (!points.length) return new Map();
  const { rows } = await query(NEAREST_REGION, [points.map((p) => p.lon), points.map((p) => p.lat)]);
  return new Map(rows.filter((r) => r.jarak_km <= maxKm).map((r) => [r.i - 1, { kode: r.kode, jarak_km: round(r.jarak_km) }]));
}

// Peringatan GDACS (Komisi Eropa–PBB) yang masih berlangsung atau mulai 7 hari
// terakhir, dibandingkan dengan komponen SIGAP yang setara di kab/kota terdekat.
const GDACS_RECENT_MS = 7 * 24 * 60 * 60_000;
const GDACS_LEVEL = { green: 'Hijau', orange: 'Oranye', red: 'Merah' };
const GDACS_COMPONENT = { FL: 'hidromet', TC: 'hidromet', VO: 'gunungapi', EQ: 'gempa', TS: 'gempa' };
const GDACS_MAX_KM = 50;

// Gempa/tsunami GDACS dicocokkan dengan gempa BMKG yang sama (selisih ≤ 120 detik,
// ≤ 100 km), bukan dengan komponen gempa SIGAP yang hanya 24 jam terakhir.
const BMKG_QUAKE_FOR = `
  SELECT u.i::int AS i, e.magnitude
  FROM (SELECT i, t, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS g
        FROM unnest($1::float8[], $2::float8[], $3::timestamptz[]) WITH ORDINALITY AS u(lon, lat, t, i)) u
  JOIN LATERAL (
    SELECT magnitude FROM events
    WHERE source = 'bmkg' AND hazard = 'gempa'
      AND occurred_at BETWEEN u.t - interval '120 seconds' AND u.t + interval '120 seconds'
      AND ST_DWithin(geom::geography, u.g::geography, 100000)
    LIMIT 1
  ) e ON true`;

// Hasil perbandingan satu kejadian GDACS:
// - sejalan: Oranye/Merah dan SIGAP menyala, atau Hijau (dampak kecil) apa pun status SIGAP;
// - berbeda: Oranye/Merah tetapi SIGAP Normal;
// - tidak_dibandingkan: di laut, jenis tanpa komponen SIGAP setara, atau tanpa data.
function gdacsVerdict(e, region, component, sigap, bmkgQuake) {
  if (e.type === 'EQ' || e.type === 'TS') return bmkgQuake ? 'sejalan' : 'berbeda';
  if (!region || !component || sigap === null || sigap === undefined) return 'tidak_dibandingkan';
  if (e.level === 'green') return 'sejalan';
  return sigap > 0 ? 'sejalan' : 'berbeda';
}

async function gdacsComparison(gdacsEvents, byKode, now) {
  let events;
  try {
    events = await gdacsEvents;
  } catch (err) {
    return { error: err.message, events: [] };
  }
  const recent = events.filter((e) => e.current || (e.from && now - new Date(e.from) <= GDACS_RECENT_MS));
  const places = await nearestRegions(recent, GDACS_MAX_KM);
  const quakes = recent.map((e, i) => [e, i]).filter(([e]) => (e.type === 'EQ' || e.type === 'TS') && e.from);
  const { rows: quakeRows } = quakes.length
    ? await query(BMKG_QUAKE_FOR, [quakes.map(([e]) => e.lon), quakes.map(([e]) => e.lat), quakes.map(([e]) => e.from)])
    : { rows: [] };
  const bmkgQuake = new Map(quakeRows.map((r) => [quakes[r.i - 1][1], r.magnitude]));
  return {
    events: recent.map((e, i) => {
      const place = places.get(i);
      const region = place && byKode.get(place.kode);
      // Komponen SIGAP setara: hujan untuk banjir/siklon, gunung api untuk erupsi.
      // Kekeringan dan kebakaran hutan tidak punya komponen setara.
      const component = GDACS_COMPONENT[e.type] ?? null;
      const sigap = !region || !component ? null : component === 'hidromet' ? region.hidromet : component === 'gempa' ? null : region.c[component];
      return {
        jenis: e.type_label,
        tipe: e.type,
        level: e.level,
        level_label: GDACS_LEVEL[e.level],
        nama: e.name,
        mulai: e.from,
        berlangsung: e.current,
        keterangan: e.severity,
        laporan: e.report_url,
        kode: region?.kode ?? null,
        wilayah: region?.nama ?? null,
        jarak_km: place?.jarak_km ?? null,
        komponen: component,
        sigap_level: sigap ?? null,
        gempa_bmkg: bmkgQuake.get(i) ?? null,
        hasil: gdacsVerdict(e, region, component, sigap, bmkgQuake.has(i)),
      };
    }),
  };
}

// Hujan terukur 24 jam di stasiun BMKG dibandingkan dengan peringatan hujan
// (CEWS dan CAP) di kab/kota stasiunnya: pemeriksaan lapangan, bukan verifikasi resmi.
const HEAVY_RAIN = new Set(['lebat', 'sangat_lebat', 'ekstrem']);
const STATION_MAX_KM = 10;

async function rainComparison(byKode, now) {
  const { until, stations } = await measuredRain(now);
  const places = await nearestRegions(stations, STATION_MAX_KM);
  const rows = stations
    .map((st, i) => {
      const region = byKode.get(places.get(i)?.kode);
      return region && {
        stasiun: st.nama,
        mm: st.mm,
        kategori: st.category,
        kategori_label: st.category_label,
        kode: region.kode,
        wilayah: region.nama,
        cews: region.c.cews,
        cap: region.c.cap,
        hidromet: region.hidromet,
      };
    })
    .filter(Boolean);
  const heavy = rows.filter((r) => HEAVY_RAIN.has(r.kategori)).sort((a, b) => b.mm - a.mm);
  return {
    sampai: until,
    stasiun: rows.length,
    hujan: rows.filter((r) => r.kategori).length,
    lebat: heavy,
    lebat_berperingatan: heavy.filter((r) => r.hidromet > 0).length,
    // Arah sebaliknya: stasiun di kab/kota yang sedang ada peringatan hujan,
    // dan berapa yang benar-benar mencatat hujan sedang ke atas (≥ 20 mm).
    berperingatan: rows.filter((r) => r.hidromet > 0).length,
    berperingatan_hujan: rows.filter((r) => r.hidromet > 0 && (r.kategori === 'sedang' || HEAVY_RAIN.has(r.kategori))).length,
  };
}

export async function buildSintesis({ rainWarnings, today, now = new Date(), loadGdacs = fetchGdacsEvents }) {
  // GDACS dimuat bersamaan dengan sumber lain supaya tenggatnya tidak berurutan.
  const gdacsEvents = withTimeout(loadGdacs(), 'GDACS belum termuat');
  gdacsEvents.catch(() => {});
  const [{ rows: regionRows }, { rows: capRows }, { rows: volcanoRows }, { rows: quakeRows }, { rows: exposureRows }, { rows: matchRows }, { rows: runRows }, statuses, cews] =
    await Promise.all([
      query(REGIONS),
      query(CAP),
      query(VOLCANOES, [VOLCANO_RADIUS_KM[2], VOLCANO_RADIUS_KM[3], VOLCANO_RADIUS_KM[4]]),
      query(QUAKES),
      query(EXPOSURE),
      query(QUAKE_MATCH),
      query('SELECT max(id) AS id FROM indikasi_run'),
      sourceStatuses(),
      loadCews(rainWarnings, now),
    ]);

  // Gempa → aturan level dan radius, lalu kab/kota dalam radiusnya.
  const quakes = quakeRows.map((q) => ({ ...q, rule: quakeRule(q) })).filter((q) => q.rule);
  const { rows: quakeRegionRows } = quakes.length
    ? await query(QUAKE_REGIONS, [quakes.map((q) => q.lon), quakes.map((q) => q.lat), quakes.map((q) => q.rule.radiusKm)])
    : { rows: [] };

  const outlook = runRows[0].id === null ? null : await buildOutlook(runRows[0].id, today);
  const outlookByKode = new Map((outlook?.regions ?? []).map((r) => [r.kode, r]));

  const sources = {
    cap: freshness(statuses, 'bmkg-cap', now),
    gempa: freshness(statuses, 'bmkg-gempa', now),
    gunungapi: freshness(statuses, 'magma', now),
  };
  const capByKode = groupBy(capRows, 'kode');
  const volcanoByKode = groupBy(volcanoRows, 'kode');
  const quakeByKode = groupBy(quakeRegionRows, 'kode');
  const exposureByKode = new Map(exposureRows.map((r) => [r.kode, r]));
  const cewsOk = cews && !cews.error && cews.published;

  const regions = regionRows.map((r) => {
    const caps = capByKode.get(r.kode) ?? [];
    const volcanoes = volcanoByKode.get(r.kode) ?? [];
    const nearQuakes = (quakeByKode.get(r.kode) ?? []).map((m) => ({ ...quakes[m.i - 1], jarak_km: m.jarak_km }));
    const c = {
      cews: cewsOk ? levelFor(cews, r.kode) : null,
      cap: sources.cap.stale ? null : Math.max(0, ...caps.map((a) => capLevel(a.severity))),
      gempa: sources.gempa.stale ? null : Math.max(0, ...nearQuakes.map((q) => q.rule.level)),
      gunungapi: sources.gunungapi.stale ? null : Math.max(0, ...volcanoes.map((v) => volcanoLevel(v.level))),
    };
    const ol = outlookByKode.get(r.kode);
    const ind = {
      hujan: ol?.hazards.hujan?.level ?? null,
      banjir: ol?.hazards.banjir?.level ?? null,
      longsor: ol?.hazards.longsor?.level ?? null,
    };
    const result = combine(c, ind);
    const exposure = exposureByKode.get(r.kode);
    const pct = (km2) => (km2 == null || !r.luas_km2 ? null : round((100 * km2) / r.luas_km2, 1));
    return {
      kode: r.kode,
      nama: r.nama,
      provinsi: r.provinsi,
      induk: r.induk,
      bounds: [[round(r.s, 3), round(r.w, 3)], [round(r.n, 3), round(r.e, 3)]],
      c,
      ind,
      ...result,
      bukti: {
        cap: caps
          .map((a) => ({ event: a.event, severity: a.severity, level: capLevel(a.severity), headline: a.headline, expires: a.expires, utc_offset: a.utc_offset }))
          // Peringatan yang menentukan level CAP dulu, lalu yang paling lama berlaku.
          .sort((a, b) => b.level - a.level || new Date(b.expires) - new Date(a.expires)),
        gunungapi: volcanoes
          .sort((a, b) => b.level - a.level)
          .map((v) => ({ nama: v.nama, level_magma: v.level, level: volcanoLevel(v.level), lokasi: v.lokasi, jarak_km: round(v.jarak_km), erupsi: v.erupsi, vona: v.vona })),
        gempa: nearQuakes
          .sort((a, b) => b.rule.level - a.rule.level || a.jarak_km - b.jarak_km)
          .slice(0, 3)
          .map((q) => ({
            magnitude: q.magnitude,
            kedalaman_km: q.depth_km,
            occurred_at: q.occurred_at,
            wilayah: q.wilayah,
            tsunami: hasTsunamiPotential(q.potensi),
            jarak_km: round(q.jarak_km),
            level: q.rule.level,
            aturan: q.rule.label,
            radius_km: q.rule.radiusKm,
          })),
        indikasi: ol ? Object.fromEntries(['hujan', 'banjir', 'longsor'].map((h) => [h, ol.hazards[h] ? { level: ol.hazards[h].level, reason: ol.hazards[h].reason, peak_date: ol.hazards[h].peak_date } : null])) : null,
      },
      kerentanan: exposure ? { banjir_tinggi_pct: pct(exposure.banjir_km2), longsor_tinggi_pct: pct(exposure.longsor_km2) } : null,
    };
  });

  const byKode = new Map(regions.map((r) => [r.kode, r]));
  const [gdacs, hujanTerukur] = await Promise.all([
    gdacsComparison(gdacsEvents, byKode, now),
    rainComparison(byKode, now).catch((err) => ({ error: err.message })),
  ]);

  const counts = { awas: 0, siaga: 0, waspada: 0, normal: 0, belum_pasti: 0 };
  for (const r of regions) counts[countKey(r)]++;
  const naik = regions.filter((r) => r.indikasi !== null && r.indikasi > (r.status ?? 0)).length;

  const drivers = { cews: 0, cap: 0, gempa: 0, gunungapi: 0 };
  // Semua komponen yang sama tinggi dengan status ikut dihitung (bisa lebih dari satu per kab/kota).
  for (const r of regions) for (const d of r.drivers) drivers[d]++;

  return {
    attribution: ATTRIBUTION,
    rules_version: RULES_VERSION,
    computed_at: now.toISOString(),
    rules: {
      cap: 'Minor/Moderate → Waspada, Severe → Siaga, Extreme → Awas',
      gempa: QUAKE_RULES.map((q) => `${q.label}: ${['', 'Waspada', 'Siaga', 'Awas'][q.level]} dalam ${q.radiusKm} km`),
      gunungapi: `Level MAGMA − 1, untuk kab/kota lokasi gunung atau dalam ${VOLCANO_RADIUS_KM[2]}/${VOLCANO_RADIUS_KM[3]}/${VOLCANO_RADIUS_KM[4]} km (Waspada/Siaga/Awas)`,
    },
    counts: { ...counts, naik_karena_indikasi: naik },
    sources: {
      ...sources,
      cews: cews.error
        ? { id: 'bmkg-cews', error: cews.error }
        : {
            id: 'bmkg-cews',
            fetched_at: cews.fetched_at,
            published: cews.published,
            dasarian: cews.dasarian,
            sebelumnya: Boolean(cews.sebelumnya),
            dasarian_berjalan: cews.dasarian_berjalan ?? null,
            unmatched: cews.unmatched ?? [],
          },
      indikasi: outlook
        ? { id: 'indikasi-sigap', finished_at: outlook.run.finished_at, rules_version: outlook.run.rules_version, window: outlook.window }
        : { id: 'indikasi-sigap', error: 'Indikasi SIGAP belum tersedia' },
    },
    analisis: {
      indikasi_vs_cews: agreement(regions.map((r) => [r.ind.hujan, r.c.cews])),
      gempa: quakeAgreement(matchRows),
      penentu: drivers,
      gdacs,
      hujan_terukur: hujanTerukur,
    },
    regions,
  };
}

// today() dapat diganti saat test supaya jendela indikasi tidak bergantung jam.
export function createSintesisRouter({ rainWarnings, today = () => wibDate(new Date()) }) {
  const router = Router();
  // GDACS dihubungi paling sering tiap 15 menit (sama dengan /api/gdacs).
  const loadGdacs = memoize(() => fetchGdacsEvents(), 15 * 60_000);
  const load = memoize(() => buildSintesis({ rainWarnings, today: today(), loadGdacs }), 60_000);
  router.get('/sintesis', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60').json(await load());
  });
  return router;
}
