import { imageMapLayer } from 'esri-leaflet';
import { HAZARD_CLASSES } from '../lib/symbology.js';

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
    (c) => `<div class="legend-row"><span class="swatch" style="background:rgb(${c.rgb.join(',')})"></span>${c.label}</div>`,
  ).join('');
  return `${rows}<p class="legend-note">Indeks bahaya BNPB, resolusi 100 m. Area tanpa warna: indeks 0.</p>`;
}
