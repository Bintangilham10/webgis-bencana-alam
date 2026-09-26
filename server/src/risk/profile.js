import { hazardClass, rainCategory, rainHazardIndications, RULES_VERSION } from '../lib/warning-rules.js';
import { HAZARDS } from '../sources/inarisk.js';
import { recommendations } from './recommendations.js';

// Menyusun profil risiko dari bahan mentah (identify InaRISK, prakiraan cuaca,
// hasil query kedekatan). Fungsi murni supaya mudah diuji.
export function buildRiskProfile({ lat, lon, place, hazardIndices, forecast, fault, volcanoes, quakes }) {
  const hazards = HAZARDS.map(({ id, label }) => {
    const { index = null, error = null } = hazardIndices[id] ?? {};
    return { id, label, index, class: hazardClass(index), error };
  });

  const days = forecast.days ?? [];
  const indications = forecast.error ? [] : rainHazardIndications(hazardIndices, days);

  return {
    location: { lat, lon, elevation_m: forecast.elevationM ?? null, wilayah: place },
    hazards,
    rain: {
      days: days.map((d) => ({
        date: d.date,
        precipitation_mm: d.precipitationMm,
        probability_pct: d.probabilityPct,
        category: rainCategory(d.precipitationMm),
      })),
      error: forecast.error ?? null,
    },
    indications,
    nearest_fault: fault,
    nearest_volcanoes: volcanoes,
    recent_quakes: quakes,
    recommendations: recommendations({ hazards, indications, fault, volcanoes }),
    rules_version: RULES_VERSION,
    generated_at: new Date().toISOString(),
  };
}
