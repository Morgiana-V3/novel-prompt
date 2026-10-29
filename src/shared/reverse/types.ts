export const REVERSE_MODELS = ['k2', 'k3', 'wd', 'pixai'] as const
export type ReverseModel = (typeof REVERSE_MODELS)[number]

export function reverseModels(value: unknown = ['k2', 'k3', 'wd']): ReverseModel[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > REVERSE_MODELS.length ||
    value.some((v) => !REVERSE_MODELS.includes(v))
  ) {
    throw new Error('请选择有效的识别模型')
  }
  return REVERSE_MODELS.filter((model) => value.includes(model))
}

export interface ReverseTag {
  name: string
  score: number
}

export interface ReverseResult {
  tags: ReverseTag[]
  characters: ReverseTag[]
  characterModel?: 'wd' | 'pixai'
  artists: { model: 'Kaloscope 2' | 'Kaloscope 3'; tags: ReverseTag[] }[]
  seconds: number
  warnings: string[]
  /** K3 pixel style embedding; never a prompt weight or percentage. */
  style?: number[]
}

export interface ReverseStatus {
  phase: 'idle' | 'downloading' | 'verifying' | 'running' | 'error'
  ready: boolean
  completedBytes: number
  totalBytes: number
  message: string
  directory: string
  models: {
    model: ReverseModel
    name: string
    ready: boolean
    bytes: number
    source: string
    license: string
  }[]
}
