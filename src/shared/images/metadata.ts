import type { ImportedPrompt } from '../prompts/import'
import { isNaiVersion, isNaiSampler, isNaiNoiseSchedule, isUcPreset } from '../generation/types'
import type { ImageRecipe } from './types'

/** Reject incomplete records instead of silently substituting the current draft. */
export function validRecipe(value: unknown): value is ImageRecipe {
  const r = value as ImageRecipe | undefined
  const q = r?.request
  const p = q?.params
  return !!(
    r?.schema === 1 &&
    Number.isFinite(r.createdAt) &&
    ['generate', 'inpaint', 'legacy'].includes(r.sourceKind) &&
    q &&
    p &&
    isNaiVersion(q.version) &&
    typeof q.base === 'string' &&
    typeof q.negative === 'string' &&
    Array.isArray(q.characters) &&
    q.characters.every(
      (c) =>
        c &&
        typeof c.prompt === 'string' &&
        (c.negative === undefined || typeof c.negative === 'string') &&
        (c.position === undefined || typeof c.position === 'string'),
    ) &&
    [p.width, p.height, p.steps, p.count].every((n) => Number.isInteger(n) && n > 0) &&
    Number.isFinite(p.scale) &&
    p.scale >= 0 &&
    Number.isFinite(p.cfgRescale) &&
    p.cfgRescale >= 0 &&
    p.cfgRescale <= 1 &&
    Number.isInteger(p.seed) &&
    p.seed! >= 0 &&
    p.seed! <= 0xffffffff &&
    isNaiSampler(p.sampler) &&
    isNaiNoiseSchedule(p.noiseSchedule) &&
    typeof p.qualityTags === 'boolean' &&
    isUcPreset(p.ucPreset)
  )
}

/** Native NAI metadata also works for PNGs created outside NovelPrompt. */
export function recipeFromTexts(texts: Record<string, string>, createdAt = 0): ImageRecipe | null {
  if (texts.NovelPrompt !== undefined) {
    const own = JSON.parse(texts.NovelPrompt)
    if (!validRecipe(own)) {
      throw new Error('图片生成记录损坏或版本不受支持')
    }
    return own
  }
  if (!texts.Comment) {
    return null
  }
  let raw
  try {
    raw = JSON.parse(texts.Comment)
  } catch {
    return null
  }
  const prompt = fromMetadata(raw)
  if (!prompt) {
    return null
  }
  const meta =
    raw.parameters && typeof raw.parameters === 'object'
      ? { ...raw.parameters, input: raw.input }
      : raw
  const source = `${meta.model_name ?? ''} ${texts.Source ?? ''}`
  let version: 'v4.5' | 'v5' | null = null
  if (/(?:diffusion[ -]|\b)v?4[.-]5\b/i.test(source)) {
    version = 'v4.5'
  } else if (/(?:diffusion[ -]|\b)v?5\b/i.test(source)) {
    version = 'v5'
  }
  const recipe = {
    schema: 1,
    createdAt,
    sourceKind: /inpaint/i.test(String(meta.request_type ?? source)) ? 'inpaint' : 'generate',
    request: {
      base: prompt.base,
      negative: prompt.negative,
      characters: prompt.characters,
      version,
      params: {
        width: meta.width,
        height: meta.height,
        steps: meta.steps,
        scale: meta.scale,
        cfgRescale: meta.cfg_rescale,
        sampler: meta.sampler,
        noiseSchedule: meta.noise_schedule,
        seed: meta.seed,
        count: 1,
        qualityTags: false,
        ucPreset: 'none',
      },
    },
  }
  return validRecipe(recipe) ? recipe : null
}
interface NaiCaption {
  base_caption?: string
  char_captions?: { char_caption?: string; centers?: { x?: number; y?: number }[] }[]
}
interface NaiMeta {
  input?: string
  prompt?: string
  uc?: string
  negative_prompt?: string
  width?: number
  height?: number
  v4_prompt?: { caption?: NaiCaption; use_coords?: boolean }
  v4_negative_prompt?: { caption?: NaiCaption }
  parameters?: NaiMeta
}

const trimText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const positiveInteger = (value: unknown) =>
  typeof value === 'number' && value > 0 ? Math.round(value) : undefined

/**
 * NAI 角色中心点（0~1）→ 位置写法。正好落在 5×5 网格中心（如 0.3,0.5）时写成网格 B3，
 * 否则保留原坐标「0.231,0.467」，避免有损转换。
 */
function positionOf(position?: { x?: number; y?: number }): string {
  if (typeof position?.x !== 'number' || typeof position?.y !== 'number') {
    return ''
  }
  const cell = (pixelValue: number) => {
    const i = Math.round(pixelValue * 5 - 0.5)
    return i >= 0 && i <= 4 && Math.abs((i + 0.5) / 5 - pixelValue) < 1e-6 ? i : -1
  }
  const cx = cell(position.x)
  const cy = cell(position.y)
  if (cx >= 0 && cy >= 0) {
    return `${'ABCDE'[cx]}${cy + 1}`
  }
  const fmt = (pixelValue: number) =>
    String(Number(Math.min(1, Math.max(0, pixelValue)).toFixed(4)))
  return `${fmt(position.x)},${fmt(position.y)}`
}

export function fromMetadata(raw: unknown): ImportedPrompt | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const metadata = raw as NaiMeta
  const metadata2 =
    metadata.parameters && typeof metadata.parameters === 'object'
      ? { ...metadata.parameters, input: metadata.input }
      : metadata
  const cap = metadata2.v4_prompt?.caption
  const ncap = metadata2.v4_negative_prompt?.caption
  const base =
    trimText(cap?.base_caption) || trimText(metadata2.prompt) || trimText(metadata2.input)
  const negative =
    trimText(ncap?.base_caption) || trimText(metadata2.uc) || trimText(metadata2.negative_prompt)
  const useCoords = metadata2.v4_prompt?.use_coords === true
  const characters = (cap?.char_captions ?? []).map((caption, i) => ({
    prompt: trimText(caption.char_caption),
    negative: trimText(ncap?.char_captions?.[i]?.char_caption),
    position: useCoords ? positionOf(caption.centers?.[0]) : '',
  }))
  if (
    !base &&
    !negative &&
    !characters.some((character) => character.prompt || character.negative)
  ) {
    return null
  }
  return {
    base,
    negative,
    characters,
    width: positiveInteger(metadata2.width),
    height: positiveInteger(metadata2.height),
    fromMetadata: true,
    structured: true,
  }
}
