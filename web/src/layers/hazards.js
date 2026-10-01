import { dynamicMapLayer, imageMapLayer } from 'esri-leaflet';
import { DEBRIS_FLOW, HAZARD_CLASSES, LANDSLIDE_CLASSES } from '../lib/symbology.js';

const INARISK_URL = 'https://gis.bnpb.go.id/server/rest/services/inarisk/';

// Lima bahaya yang menjadi fokus sistem. "Curah hujan tinggi" diwakili
// indeks bahaya cuaca ekstrem.
export const HAZARDS = [
  { id: 'gempa', label: 'Gempa bumi', service: 'INDEKS_BAHAYA_GEMPABUMI' },
  { id: 'cuaca', label: 'Cuaca ekstrem (hujan lebat)', service: 'INDEKS_BAHAYA_CUACAEKSTRIM' },
  { id: 'banjir', label: 'Banjir', service: 'INDEKS_BAHAYA_BANJIR' },
  { id: 'longsor', label: 'Tanah longsor', service: 'INDEKS_BAHAYA_TANAHLONGSOR' },
  { id: 'gunungapi', label: 'Gunung api', service: 'INDEKS_BAHAYA_GUNUNGAPI' },
];

// Server BNPB mengubah indeks 0–1 menjadi 3 kelas warna (Remap lalu Colormap).
// Nilai 0 dijadikan NoData sehingga area tanpa bahaya tampil transparan.
// Batas kelas = sepertiga dengan batas atas inklusif (sama dengan
// recorder/src/lib/rules.json): 2/3 (zona menengah pada indeks longsor) = sedang.
const RENDERING_RULE = {
  rasterFunction: 'Colormap',
  rasterFunctionArguments: {
    Colormap: HAZARD_CLASSES.map((c, i) => [i + 1, ...c.rgb]),
    Raster: {
      rasterFunction: 'Remap',
      rasterFunctionArguments: {
        InputRanges: [0, 0.3334, 0.3334, 0.6667, 0.6667, 1.01],
        OutputValues: [1, 2, 3],
        NoDataRanges: [-1, 0.0001],
      },
      outputPixelType: 'U8',
    },
  },
};

export function createHazardLayer(hazard, opacity) {
  return imageMapLayer({
    url: `${INARISK_URL}${hazard.service}/ImageServer`,
    renderingRule: RENDERING_RULE,
    format: 'png32',
    f: 'image',
    pane: 'hazard',
    opacity,
    attribution: 'Indeks bahaya &copy; <a href="https://inarisk.bnpb.go.id/">InaRISK BNPB</a>',
  });
}

export function hazardLegend() {
  const rows = HAZARD_CLASSES.map(
    (c) => `<div class="legend-row"><span class="swatch" style="background:${c.color}"></span>${c.label}</div>`,
  ).join('');
  return `${rows}<p class="legend-note">Indeks 0–1: rendah ≤ 1/3, sedang ≤ 2/3, tinggi &gt; 2/3. Resolusi 100 m. Tanpa warna: di luar zona bahaya.</p>`;
}

// ---------- Zona kerentanan gerakan tanah (ZKGT) PVMBG ----------

// 207.120 poligon nasional di server peta BNPB. Warna diatur lewat dynamicLayers
// (dirender server) supaya sama dengan kelas InaRISK: hijau, kuning, merah.
// Sangat rendah tidak diwarnai. Ini juga peta dasar prakiraan bulanan PVMBG.
const ZKGT_URL = 'https://gis.bnpb.go.id/server/rest/services/thematic/Peta_ZKGT_ESDM/MapServer';

const solidFill = (rgb) => ({
  type: 'esriSFS',
  style: 'esriSFSSolid',
  color: [...rgb, 255],
  outline: { type: 'esriSLS', style: 'esriSLSNull', color: [0, 0, 0, 0], width: 0 },
});

// Dikirim sebagai string JSON, karena esri-leaflet menempelkannya apa adanya ke URL gambar.
const ZKGT_RENDERER = JSON.stringify([
  {
    id: 0,
    source: { type: 'mapLayer', mapLayerId: 0 },
    drawingInfo: {
      renderer: {
        type: 'uniqueValue',
        field1: 'NAMOBJ',
        uniqueValueInfos: [
          ...['Tinggi', 'Menengah', 'Rendah'].map((kelas) => ({
            value: `Zona Kerentanan Gerakan Tanah ${kelas}`,
            label: kelas,
            symbol: solidFill(LANDSLIDE_CLASSES[kelas.toLowerCase()].rgb),
          })),
          { value: 'Aliran Bahan Rombakan', label: DEBRIS_FLOW.label, symbol: solidFill(DEBRIS_FLOW.rgb) },
        ],
      },
    },
  },
]);

export function createZkgtLayer(opacity) {
  return dynamicMapLayer({
    url: ZKGT_URL,
    dynamicLayers: ZKGT_RENDERER,
    f: 'image',
    format: 'png32',
    transparent: true,
    pane: 'hazard',
    opacity,
    attribution: 'Zona kerentanan gerakan tanah &copy; PVMBG, via <a href="https://gis.bnpb.go.id/">BNPB</a>',
  });
}

export function zkgtLegend() {
  const rows = ['tinggi', 'menengah', 'rendah'].map((id) => {
    const c = LANDSLIDE_CLASSES[id];
    return `<div class="legend-row"><span class="swatch" style="background:${c.color}"></span>${c.id === 'sedang' ? 'Menengah' : c.label}</div>`;
  });
  rows.push(`<div class="legend-row"><span class="swatch" style="background:${DEBRIS_FLOW.color}"></span>${DEBRIS_FLOW.label}</div>`);
  return `${rows.join('')}<p class="legend-note">Sangat rendah tidak diwarnai. Dasar prakiraan bulanan PVMBG.</p>`;
}
