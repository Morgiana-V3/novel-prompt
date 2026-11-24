export const REFERENCE_MODES = ['character', 'style', 'character&style'] as const
export const REFERENCE_LABELS = {
  character: '角色',
  style: '画风',
  'character&style': '角色与画风',
}
export const MAX_REFERENCES = 4
export const REFERENCE_FEE = 5

export interface PreciseReference {
  imageName: string
  mode: (typeof REFERENCE_MODES)[number]
  strength: number
  fidelity: number
}

export function validReferences(value: unknown): value is PreciseReference[] {
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
        [ref.strength, ref.fidelity].every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
    )
  )
}

export function checkReferences(
  value: unknown,
  version: string,
): asserts value is PreciseReference[] {
  if (!validReferences(value)) {
    throw new Error('参考图配置无效，每次最多 4 张，强度与还原度范围为 0～1')
  }
  if (value.length && version !== 'v4.5') {
    throw new Error('精确参考需要 V4.5 Full，请切换模型或移除参考图')
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
    required: ['imageName', 'mode', 'strength', 'fidelity'],
    properties: {
      imageName: { type: 'string', description: '本机图库 PNG 文件名' },
      mode: { type: 'string', enum: REFERENCE_MODES },
      strength: { type: 'number', minimum: 0, maximum: 1 },
      fidelity: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
}
