import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { HttpError } from '../src/lib/http.js';
import { categoryOf, extractFacilities, fetchFacilities } from '../src/sources/overpass.js';
import { decodePolyline6, osrmRoutes, valhallaRoutes } from '../src/sources/routing.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// Fixture = sembilan objek asli dari query Overpass nasional (23 Okt 2026).
describe('titik evakuasi dan fasilitas OSM (Overpass)', () => {
  test('kategori: tanda evakuasi didahulukan, penampungan tunawisma tidak dihitung', () => {
    const facilities = extractFacilities(JSON.parse(fixture('overpass-fasilitas.json')));
    assert.deepEqual(
      facilities.map((f) => [f.id, f.category]),
      [
        ['way/28969780', 'evakuasi'],
        ['node/4794550846', 'titik_kumpul'],
        ['node/6986428642', 'evakuasi'],
        // Rumah sakit yang juga ditandai evacuation_center=yes.
        ['way/156917856', 'evakuasi'],
        ['way/30818753', 'rumah_sakit'],
        ['node/298741226', 'klinik'],
        ['node/32527727', 'polisi'],
        ['node/702191760', 'pemadam'],
      ],
    );
    const [lapangan] = facilities;
    assert.equal(lapangan.name, 'Lapangan UMS');
    // Gedung/area diwakili titik tengahnya (out center).
    assert.ok(Number.isFinite(lapangan.lat) && Number.isFinite(lapangan.lon));
    assert.deepEqual(Object.keys(lapangan.tags).sort(), ['addr:full', 'evacuation_center', 'leisure', 'name']);
    assert.equal(categoryOf({ social_facility: 'shelter' }), 'evakuasi');
    assert.equal(categoryOf({ social_facility: 'shelter', 'social_facility:for': 'homeless' }), null);
    assert.equal(categoryOf({ amenity: 'shelter', shelter_type: 'gazebo' }), null);
  });

  test('galat waktu proses Overpass ditolak; server berikutnya dicoba bila yang pertama penuh', async () => {
    assert.throws(() => extractFacilities({ elements: [], remark: 'runtime error: Query timed out' }), /Overpass: runtime error/);
    const hosts = [];
    const getText = async (url) => {
      hosts.push(new URL(url).host);
      if (hosts.length === 1) throw new HttpError(url, 504);
      return fixture('overpass-fasilitas.json');
    };
    const facilities = await fetchFacilities({ getText, endpoints: ['https://satu.contoh/api/interpreter', 'https://dua.contoh/api/interpreter'] });
    assert.deepEqual(hosts, ['satu.contoh', 'dua.contoh']);
    assert.equal(facilities.length, 8);
    await assert.rejects(
      fetchFacilities({ getText: async (url) => Promise.reject(new HttpError(url, 504)), endpoints: ['https://satu.contoh/x'] }),
      /Semua server Overpass gagal \(satu\.contoh: HTTP 504/,
    );
  });
});

// Fixture = jawaban Valhalla FOSSGIS asli, alun-alun Bandung → Gasibu jalan kaki.
describe('layanan rute', () => {
  test('polyline6 Valhalla menjadi [lon, lat] dalam batas ringkasan rute', async () => {
    const json = JSON.parse(fixture('valhalla-bandung-jalan-kaki.json'));
    const coordinates = decodePolyline6(json.trip.legs[0].shape);
    const { min_lat: s, max_lat: n, min_lon: w, max_lon: e } = json.trip.summary;
    assert.ok(coordinates.length > 100);
    assert.ok(coordinates.every(([lon, lat]) => lon >= w - 1e-6 && lon <= e + 1e-6 && lat >= s - 1e-6 && lat <= n + 1e-6));
    // Contoh dokumentasi algoritma polyline Google (38,5 −120,2 …) dibaca dengan presisi 6.
    assert.deepEqual(decodePolyline6('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[-12.02, 3.85], [-12.095, 4.07], [-12.6453, 4.3252]]);

    const sent = [];
    const routes = await valhallaRoutes(
      { from: { lat: -6.9218, lon: 107.6073 }, to: { lat: -6.9005, lon: 107.6186 }, mode: 'jalan_kaki', exclude: [[[107.61, -6.91], [107.62, -6.91], [107.61, -6.92], [107.61, -6.91]]] },
      { post: async (url, payload) => (sent.push(payload), json) },
    );
    assert.equal(sent[0].costing, 'pedestrian');
    assert.equal(sent[0].exclude_polygons.length, 1);
    assert.deepEqual(routes.map((r) => [r.distance_m, r.duration_s]), [[3352, 2482], [3315, 2502]]);
    assert.equal(routes[0].geometry.type, 'LineString');
  });

  test('tidak ada rute (HTTP 400) = null, bukan galat; OSRM sebagai cadangan', async () => {
    const reject400 = async (url) => {
      throw new HttpError(url, 400);
    };
    assert.equal(await valhallaRoutes({ from: { lat: 0, lon: 0 }, to: { lat: 0, lon: 0 }, mode: 'motor' }, { post: reject400 }), null);
    assert.equal(await osrmRoutes({ from: { lat: 0, lon: 0 }, to: { lat: 0, lon: 0 }, mode: 'mobil' }, { getJson: reject400 }), null);
    const urls = [];
    const routes = await osrmRoutes(
      { from: { lat: -6.9, lon: 107.6 }, to: { lat: -6.8, lon: 107.7 }, mode: 'jalan_kaki' },
      {
        getJson: async (url) => {
          urls.push(url);
          return { code: 'Ok', routes: [{ distance: 1234.4, duration: 900.6, geometry: { type: 'LineString', coordinates: [[107.6, -6.9], [107.7, -6.8]] } }] };
        },
      },
    );
    assert.match(urls[0], /routed-foot\/route\/v1\/foot\/107\.6,-6\.9;107\.7,-6\.8\?alternatives=2/);
    assert.deepEqual(routes.map((r) => [r.distance_m, r.duration_s]), [[1234, 901]]);
  });
});
