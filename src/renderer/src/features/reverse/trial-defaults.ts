import type { NaiGenParams, NaiVersion } from '@shared/generation/types'

/** Keep artist comparisons repeatable without inheriting unrelated generation edits. */
export function reverseTrialParams(version: NaiVersion): NaiGenParams {
  return {
    width: 832,
    height: 1216,
    steps: 28,
    scale: version === 'v5' ? 4 : 5,
    cfgRescale: 0,
    sampler: 'k_euler_ancestral',
    noiseSchedule: 'native',
    qualityTags: true,
    ucPreset: 'light',
    seed: null,
    count: 1,
  }
}
