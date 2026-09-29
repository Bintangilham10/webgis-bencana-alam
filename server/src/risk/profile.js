import { hazardClass, outlookIndications, rainCategory, RULES_VERSION, slopeClass } from '../lib/warning-rules.js';
import { LEVEL_LABELS } from '../sources/bmkg-cews.js';
import { HAZARDS } from '../sources/inarisk.js';
import { recommendations } from './recommendations.js';

const round1 = (x) => Math.round(x * 10) / 10;

// Bagian tanah longsor & hujan: produk resmi (PVMBG, BMKG CEWS), hujan
// anteseden, peluang ensemble, lereng, dan riwayat kejadian. Tiap bagian yang
// sumbernya gagal hanya berisi `error`, bagian lain tetap tampil.
function landslideSection({ potential, rainWarning, pastDays, ensemble, slope, history }) {
  const knownPast = pastDays.filter((d) => Number.isFinite(d.precipitationMm));
  return {
    potential: potential.error ? { error: potential.error } : potential,
    rain_warning: rainWarning.error
      ? { error: rainWarning.error }
      : {
          dasarian: rainWarning.dasarian,
          published: rainWarning.published,
          level: rainWarning.level,
          label: rainWarning.level === null ? null : LEVEL_LABELS[rainWarning.level],
        },
    antecedent_rain: {
      days: pastDays.map((d) => ({ date: d.date, precipitation_mm: d.precipitationMm, category: rainCategory(d.precipitationMm) })),
      total_mm: knownPast.length ? round1(knownPast.reduce((sum, d) => sum + d.precipitationMm, 0)) : null,
    },
    ensemble: ensemble.error
      ? { error: ensemble.error }
      : {
          model: ensemble.model,
          days: ensemble.days.map((d) => ({
            date: d.date,
            members: d.n,
            median_mm: d.median ?? null,
            p90_mm: d.p90 ?? null,
            prob_50mm: d.p50 ?? null,
            prob_100mm: d.p100 ?? null,
          })),
        },
    slope: slope.error ? { error: slope.error } : { degrees: slope.degrees, step_m: slope.stepM, class: slopeClass(slope.degrees) },
    history,
  };
}

// Menyusun profil risiko dari bahan mentah (identify InaRISK, prakiraan cuaca,
// hasil query kedekatan). Fungsi murni supaya mudah diuji.
export function buildRiskProfile({ lat, lon, place, hazardIndices, forecast, fault, volcanoes, quakes, landslide }) {
  const hazards = HAZARDS.map(({ id, label }) => {
    const { index = null, error = null } = hazardIndices[id] ?? {};
    return { id, label, index, class: hazardClass(index), error };
  });

  const days = forecast.days ?? [];
  // Hujan lebat, banjir, dan longsor 3 hari; aturan yang sama dengan indikasi kab/kota.
  const indications = forecast.error ? [] : outlookIndications(hazardIndices, days, forecast.pastDays ?? []);
  const landslideInfo = landslide && landslideSection({ ...landslide, pastDays: forecast.pastDays ?? [] });

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
    landslide: landslideInfo ?? null,
    nearest_fault: fault,
    nearest_volcanoes: volcanoes,
    recent_quakes: quakes,
    recommendations: recommendations({ hazards, indications, fault, volcanoes, landslide: landslideInfo, place }),
    rules_version: RULES_VERSION,
    generated_at: new Date().toISOString(),
  };
}
