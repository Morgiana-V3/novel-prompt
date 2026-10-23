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
    light: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
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
 * 角色位置 → 归一化中心点（原点左上）。支持两种写法：
 * - 5×5 网格 A1~E5（列 A→E 左到右，行 1→5 上到下）
 * - 坐标 "0.3,0.5"
 * 其他写法返回 null，生图时会被忽略。
 */
export function parsePosition(position?: string): { x: number; y: number } | null {
  const p = position?.trim() ?? ''
  const grid = /^([A-E])\s*([1-5])$/i.exec(p)
  if (grid) return { x: ('ABCDE'.indexOf(grid[1].toUpperCase()) + 0.5) / 5, y: (Number(grid[2]) - 0.5) / 5 }
  const xy = /^(0?\.\d+|[01](?:\.0+)?)\s*[,，\s]\s*(0?\.\d+|[01](?:\.0+)?)$/.exec(p)
  if (xy) return { x: Number(xy[1]), y: Number(xy[2]) }
  return null
}

export const isGridPosition = (position?: string) => /^[A-E][1-5]$/i.test(position?.trim() ?? '')

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
