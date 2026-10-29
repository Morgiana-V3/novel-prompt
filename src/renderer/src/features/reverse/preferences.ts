import { reverseModels, type ReverseModel } from '@shared/reverse/types'

export interface ReversePreferences {
  models: ReverseModel[]
  tagThreshold: number
  characterThreshold: number
  pixaiCharacterThreshold: number
  artistThreshold: number
}
const key = 'np-reverse-options-v1'
export function loadReversePreferences(): ReversePreferences {
  const defaults: ReversePreferences = {
    models: ['k2', 'k3', 'wd'],
    tagThreshold: 0.5296,
    characterThreshold: 0.85,
    pixaiCharacterThreshold: 0.27,
    artistThreshold: 0,
  }
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
    const threshold = (value: unknown, min: number, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) && value >= min && value <= 1
        ? value
        : fallback
    return {
      models: reverseModels(saved.models),
      tagThreshold: threshold(saved.tagThreshold, 0.05, defaults.tagThreshold),
      characterThreshold: threshold(saved.characterThreshold, 0.05, defaults.characterThreshold),
      pixaiCharacterThreshold: threshold(
        saved.pixaiCharacterThreshold,
        0.05,
        defaults.pixaiCharacterThreshold,
      ),
      artistThreshold: threshold(saved.artistThreshold, 0, defaults.artistThreshold),
    }
  } catch {
    return defaults
  }
}
export function saveReversePreferences(preferences: ReversePreferences): void {
  localStorage.setItem(key, JSON.stringify(preferences))
}
