import type { Observation, TelescopeCode } from "../types";

interface SpectrumLink {
  observation_id: string;
  telescope: TelescopeCode;
  url: string;
  label: string;
}

export function buildSpectrumLinksByTarget(
  observations: readonly Observation[],
): Map<string, SpectrumLink[]> {
  const byTarget = new Map<string, SpectrumLink[]>();
  for (const observation of observations) {
    if (observation.status !== "observed" || !observation.spectrum_url) {
      continue;
    }
    const spectra = byTarget.get(observation.target_id) ?? [];
    spectra.push({
      observation_id: observation.observation_id,
      telescope: observation.telescope,
      url: observation.spectrum_url,
      label: observation.telescope,
    });
    byTarget.set(observation.target_id, spectra);
  }

  for (const spectra of byTarget.values()) {
    const totals = new Map<TelescopeCode, number>();
    const counts = new Map<TelescopeCode, number>();
    for (const spectrum of spectra) {
      totals.set(spectrum.telescope, (totals.get(spectrum.telescope) ?? 0) + 1);
    }
    for (const spectrum of spectra) {
      const count = (counts.get(spectrum.telescope) ?? 0) + 1;
      counts.set(spectrum.telescope, count);
      if ((totals.get(spectrum.telescope) ?? 0) > 1) {
        spectrum.label = `${spectrum.telescope} (${count})`;
      }
    }
  }

  return byTarget;
}
