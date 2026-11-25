export const REFERENCE_MODES = ['character', 'style', 'character&style', 'costume'] as const
export const REFERENCE_LABELS = {
  character: '角色',
  style: '画风',
  costume: '服装',
  'character&style': '角色与画风',
}
export const MAX_REFERENCES = 16
export const REFERENCE_FEE = 5

export interface PreciseReference {
  imageName: string
  mode: (typeof REFERENCE_MODES)[number]
  strength: number
  fidelity?: number
  preferSameOutfit?: boolean
}

export function referenceModes(model: string) {
  return REFERENCE_MODES.filter((mode) => model === 'v5' || mode !== 'costume')
}

export function hasOutfitPreference(mode: PreciseReference['mode']) {
  return mode === 'character' || mode === 'character&style'
}

export function referenceCaption(ref: PreciseReference, version: string) {
  if (version === 'v5') {
    if (ref.mode === 'character' && ref.preferSameOutfit) {
      return 'character_mainoutfit'
    }
    if (ref.mode === 'character&style' && ref.preferSameOutfit === false) {
      return 'character&style_anyoutfit'
    }
  }
  return ref.mode
}

export const V5_INPAINT_REFERENCE_NOTICE =
  'V5 局部重绘和扩图暂不支持精确参考。请移除参考图后再执行，或使用整图生成。'

export function validReferences(value: unknown, version?: string): value is PreciseReference[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_REFERENCES &&
    value.every(
      (ref) =>
        ref &&
        typeof ref.imageName === 'string' &&
        /^[\w.-]{1,230}\.png$/i.test(ref.imageName) &&
        !ref.imageName.includes('..') &&
        REFERENCE_MODES.includes(ref.mode) &&
        (version !== 'v4.5' || ref.mode !== 'costume') &&
        Number.isFinite(ref.strength) &&
        ref.strength >= 0 &&
        ref.strength <= (version === 'v4.5' ? 1 : 5) &&
        (ref.fidelity === undefined
          ? version !== 'v4.5'
          : Number.isFinite(ref.fidelity) && ref.fidelity >= 0 && ref.fidelity <= 1) &&
        (ref.preferSameOutfit === undefined ||
          (version !== 'v4.5' &&
            hasOutfitPreference(ref.mode) &&
            typeof ref.preferSameOutfit === 'boolean')),
    )
  )
}

export function checkReferences(
  value: unknown,
  version: string,
): asserts value is PreciseReference[] {
  if (!validReferences(value, version)) {
    throw new Error(
      version === 'v5'
        ? 'V5 精确参考配置无效，请检查图片用途、服装偏好和强度（0～5）'
        : 'V4.5 仅支持角色、画风及角色与画风，强度和还原度须为 0～1；请调整参考图或切回 V5',
    )
  }
}

/** Resolve selected gallery sources to owned snapshots before committing an editor change. */
export async function snapshotReferences(
  images: PreciseReference[],
  resolveName: (name: string) => Promise<string>,
) {
  const snapshots: PreciseReference[] = []
  for (const image of images) {
    snapshots.push({ ...image, imageName: await resolveName(image.imageName) })
  }
  return snapshots
}

export const REFERENCE_SCHEMA = {
  type: 'array',
  maxItems: MAX_REFERENCES,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['imageName', 'mode', 'strength'],
    properties: {
      imageName: { type: 'string', description: '本机图库 PNG 文件名' },
      mode: { type: 'string', enum: REFERENCE_MODES },
      strength: { type: 'number', minimum: 0, maximum: 5, description: 'V4.5 最大 1，V5 最大 5' },
      fidelity: { type: 'number', minimum: 0, maximum: 1, description: 'V4.5 必填，V5 无需提供' },
      preferSameOutfit: {
        type: 'boolean',
        description: '仅 V5 角色或角色与画风使用；角色默认关闭，角色与画风默认开启',
      },
    },
  },
}
