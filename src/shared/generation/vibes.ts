import type { NaiVersion } from './types'

export const MAX_VIBES = 16
export const VIBE_ENCODE_FEE = 2
export const VIBE_IMAGE_PATTERN = /^ref-[a-f0-9]{64}\.png$/

export interface VibeReference {
  imageName: string
  information: number
  strength: number
}

export type VibeCacheStatus = 'ready' | 'missing' | 'uncertain'

export function validVibes(value: unknown): value is VibeReference[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_VIBES &&
    new Set(value.map((entry) => entry?.imageName)).size === value.length &&
    value.every(
      (entry) =>
        typeof entry?.imageName === 'string' &&
        VIBE_IMAGE_PATTERN.test(entry.imageName) &&
        [entry.information, entry.strength].every(
          (amount) => Number.isFinite(amount) && amount >= 0 && amount <= 1,
        ),
    )
  )
}

export function checkVibes(
  value: unknown,
  model: NaiVersion,
  hasPreciseReferences: boolean,
): asserts value is VibeReference[] {
  if (!validVibes(value)) {
    throw new Error('Vibe Transfer 配置无效，请选择最多 16 张不同的图片')
  }
  if (value.length && model !== 'v4.5') {
    throw new Error('Vibe Transfer 需要 V4.5 Full')
  }
  if (value.length && hasPreciseReferences) {
    throw new Error('Vibe Transfer 和精确参考不能同时使用，请保留一种')
  }
}

export function vibeGenerationFee(count: number): number {
  return Math.max(0, count - 4) * 2
}

export const VIBE_SCHEMA = {
  type: 'array',
  maxItems: MAX_VIBES,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['imageName', 'information', 'strength'],
    properties: {
      imageName: {
        type: 'string',
        pattern: VIBE_IMAGE_PATTERN.source,
        description: '本机已编码的 Vibe 参考图',
      },
      information: { type: 'number', minimum: 0, maximum: 1 },
      strength: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
}
