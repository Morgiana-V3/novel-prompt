import type { NaiVersion, UcPreset } from './types'

/** NAI 前端「Add Quality Tags」自动追加在主提示词末尾的内容（Full 模型） */
export const QUALITY_TAGS: Record<NaiVersion, string> = {
  'v4.5': 'location, very aesthetic, masterpiece, no text',
  v5: 'very aesthetic, masterpiece, no text'
}

const UC_HEAVY =
  'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'

/** NAI 前端自动注入的 UC 预设内容 */
export const UC_PRESETS: Record<NaiVersion, Record<UcPreset, string>> = {
  'v4.5': {
    heavy: UC_HEAVY,
    light:
      'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    human: `${UC_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
    none: ''
  },
  v5: {
    heavy: UC_HEAVY,
    light: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts',
    human: `${UC_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
    none: ''
  }
}

export const UC_LABEL: Record<UcPreset, string> = { heavy: 'Heavy', light: 'Light', human: 'Human Focus', none: '无' }

/** 把逗号分隔的两段提示词拼在一起 */
export function joinPrompt(a: string, b: string): string {
  const x = a.trim().replace(/[\s,]+$/, '')
  const y = b.trim().replace(/^[\s,]+/, '')
  return x && y ? `${x}, ${y}` : x || y
}

/**
 * 把 Add Quality Tags 追加到主提示词：NAI 要求 Text: 块在最末尾，
 * 有 Text: 块时插到它前面。
 */
export function withQualityTags(base: string, version: NaiVersion): string {
  const m = /(^|[,\n|])\s*text:/i.exec(base)
  if (!m) return joinPrompt(base, QUALITY_TAGS[version])
  const at = m.index + m[1].length
  return `${joinPrompt(base.slice(0, at), QUALITY_TAGS[version])}, ${base.slice(at).trim()}`
}
