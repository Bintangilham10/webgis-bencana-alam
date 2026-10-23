import express, { Router } from 'express';
import { exclusionRings, highZonesAt, routeExposure } from '../risk/route-exposure.js';
import { ATTRIBUTION, MAX_EXCLUDE_PERIMETER_M, MODES, osrmRoutes, valhallaRoutes } from '../sources/routing.js';
import { inRegion } from './risk.js';

// Jarak lurus maksimum asal–tujuan: rute evakuasi, bukan rute perjalanan.
const MAX_DISTANCE_KM = { jalan_kaki: 25, motor: 100, mobil: 100 };
// Rute teraman boleh lebih lama dari yang tercepat, tetapi tidak lebih dari ini.
const MAX_DETOUR_RATIO = 1.75;
const DETOUR_GRACE_S = 120;
// Sisa batas keliling Valhalla untuk pembulatan geometri.
const EXCLUDE_BUDGET_M = MAX_EXCLUDE_PERIMETER_M - 500;

const distanceKm = (a, b) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const point = (value) => ({ lat: Number(value?.lat), lon: Number(value?.lon) });
const round5 = (geometry) => ({ ...geometry, coordinates: geometry.coordinates.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]) });
// Alternatif Valhalla kadang hampir sama; yang jarak dan waktunya sama dibuang.
const sameRoute = (a, b) => Math.abs(a.distance_m - b.distance_m) < 25 && Math.abs(a.duration_s - b.duration_s) < 15;

// Rute aman (M4): rute utama dan alternatif dinilai paparannya terhadap zona bahaya
// banjir dan longsor kelas tinggi; bila semua melewatinya, satu rute lagi diminta
// dengan blok zona yang dilewati sebagai area terlarang. Yang dipilih: paparan
// terkecil, lalu tercepat. Layanan dapat diganti saat test.
export function createRouteRouter({
  valhalla = valhallaRoutes,
  osrm = osrmRoutes,
  exposure = routeExposure,
  exclusions = exclusionRings,
  zones = highZonesAt,
} = {}) {
  const router = Router();

  router.post('/route', express.json({ limit: '2kb' }), async (req, res) => {
    const from = point(req.body?.from);
    const to = point(req.body?.to);
    const mode = req.body?.mode ?? 'jalan_kaki';
    if (!Object.hasOwn(MODES, mode)) return res.status(400).json({ error: 'Moda harus jalan_kaki, motor, atau mobil' });
    if (!inRegion(from.lat, from.lon) || !inRegion(to.lat, to.lon)) {
      return res.status(400).json({ error: 'Titik asal dan tujuan harus berupa koordinat di kawasan Indonesia' });
    }
    if (distanceKm(from, to) > MAX_DISTANCE_KM[mode]) {
      return res.status(400).json({ error: `Tujuan terlalu jauh untuk rute evakuasi (maks. ${MAX_DISTANCE_KM[mode]} km garis lurus)` });
    }

    // Asal atau tujuan di zona tinggi: ruas merah di ujung rute tidak bisa dihindari.
    const endZones = zones([from, to]).catch(() => [[], []]);
    let engine = 'Valhalla (FOSSGIS)';
    let routes = null;
    try {
      routes = await valhalla({ from, to, mode });
    } catch {
      routes = null;
    }
    if (!routes?.length) {
      engine = 'OSRM (FOSSGIS)';
      try {
        routes = await osrm({ from, to, mode });
      } catch (err) {
        return res.status(502).json({ error: `Layanan rute tidak dapat dihubungi: ${err.message}` });
      }
    }
    if (!routes?.length) return res.status(404).json({ error: 'Tidak ada rute jalan yang menghubungkan kedua titik.' });

    const candidates = [];
    for (const [i, route] of routes.entries()) {
      if (candidates.some((c) => sameRoute(c, route))) continue;
      candidates.push({ ...route, source: i === 0 ? 'utama' : 'alternatif', exposure: await exposure(route.geometry) });
    }

    // Semua kandidat melewati zona tinggi: minta rute yang menghindari blok zonanya.
    let avoidance = 'tidak_perlu';
    const least = candidates.reduce((a, b) => (b.exposure.tinggi_m < a.exposure.tinggi_m ? b : a));
    if (least.exposure.tinggi_m > 0) {
      avoidance = 'tidak_bisa';
      const rings = engine.startsWith('Valhalla') ? await exclusions(least.geometry, from, to, EXCLUDE_BUDGET_M) : [];
      if (rings.length) {
        const avoided = await valhalla({ from, to, mode, alternates: 0, exclude: rings }).catch(() => null);
        const [route] = avoided ?? [];
        if (route && !candidates.some((c) => sameRoute(c, route))) {
          candidates.push({ ...route, source: 'menghindari_zona', exposure: await exposure(route.geometry) });
          avoidance = 'dicoba';
        }
      }
    }

    const fastest = candidates.reduce((a, b) => (b.duration_s < a.duration_s ? b : a));
    const limit = fastest.duration_s * MAX_DETOUR_RATIO + DETOUR_GRACE_S;
    const safest = candidates
      .filter((c) => c.duration_s <= limit)
      .reduce((a, b) => (b.exposure.tinggi_m < a.exposure.tinggi_m || (b.exposure.tinggi_m === a.exposure.tinggi_m && b.duration_s < a.duration_s) ? b : a));
    const [fromZones, toZones] = await endZones;

    res.json({
      mode,
      engine,
      attribution: ATTRIBUTION,
      from,
      to,
      routes: candidates.map((c, id) => ({ id, ...c, geometry: round5(c.geometry) })),
      fastest: candidates.indexOf(fastest),
      safest: candidates.indexOf(safest),
      avoidance,
      zona_tinggi: { from: fromZones, to: toZones },
      max_detour_ratio: MAX_DETOUR_RATIO,
    });
  });

  return router;
}
