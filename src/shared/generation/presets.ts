import type { NaiVersion, UcPreset } from './types'

/** NAI 前端「Add Quality Tags」自动追加在主提示词末尾的内容（Full 模型） */
export const QUALITY_TAGS: Record<NaiVersion, string> = {
  'v4.5': 'location, very aesthetic, masterpiece, no text',
  v5: 'very aesthetic, masterpiece, no text',
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
    none: '',
  },
  v5: {
    heavy: UC_HEAVY,
    light:
      'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
    human: `${UC_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
    none: '',
  },
}

export const UC_LABEL: Record<UcPreset, string> = {
  heavy: 'Heavy',
  light: 'Light',
  human: 'Human Focus',
  none: '无',
}

/** 把逗号分隔的两段提示词拼在一起 */
export function joinPrompt(leftText: string, rightText: string): string {
  const text = leftText.trim().replace(/[\s,]+$/, '')
  const text2 = rightText.trim().replace(/^[\s,]+/, '')
  return text && text2 ? `${text}, ${text2}` : text || text2
}

/**
 * 角色位置 → 归一化中心点（原点左上）。支持两种写法：
 * - 5×5 网格 A1~E5（列 A→E 左到右，行 1→5 上到下）
 * - 坐标 "0.3,0.5"
 * 其他写法返回 null，生图时会被忽略。
 */
export function parsePosition(position?: string): { x: number; y: number } | null {
  const path = position?.trim() ?? ''
  const grid = /^([A-E])\s*([1-5])$/i.exec(path)
  if (grid) {
    return { x: ('ABCDE'.indexOf(grid[1].toUpperCase()) + 0.5) / 5, y: (Number(grid[2]) - 0.5) / 5 }
  }
  const xy = /^(0?\.\d+|[01](?:\.0+)?)\s*[,，\s]\s*(0?\.\d+|[01](?:\.0+)?)$/.exec(path)
  if (xy) {
    return { x: Number(xy[1]), y: Number(xy[2]) }
  }
  return null
}

export const isGridPosition = (position?: string) => /^[A-E][1-5]$/i.test(position?.trim() ?? '')

/** 各版本角色提示词数量上限 */
export const MAX_CHARACTERS: Record<NaiVersion, number> = { 'v4.5': 6, v5: 22 }

/** Text: 块文字长度上限（含空格和换行，Full 模型） */
export const TEXT_MAX_CHARS: Record<NaiVersion, number> = { 'v4.5': 118, v5: 750 }

/**
 * 找到 Text: 块的起始位置（"T" 的下标），没有返回 -1。
 * `Text:` 前面（跳过空白）必须是开头、逗号、`|`、换行或句末标点，
 * 这样 `hands. Text: Stop, please.` 也能识别，而 `english text: xx`、`context:`、引号内的内容不会被误认。
 */
export function findTextBlock(input: string): number {
  let inQuote = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }
    if (inQuote || (ch !== 't' && ch !== 'T')) {
      continue
    }
    if (!/^text:(?!:)/i.test(input.slice(i, i + 6))) {
      continue
    }
    let j = i - 1
    let newline = false
    while (j >= 0 && /\s/.test(input[j])) {
      if (input[j] === '\n' || input[j] === '\r') {
        newline = true
      }
      j--
    }
    if (j < 0 || newline || /[,|.!?;。！？；，]/.test(input[j])) {
      return i
    }
  }
  return -1
}

/** Text: 块里的文字（原样，只去掉首尾空白），没有 Text: 块返回 null */
export function textBlockOf(input: string): string | null {
  const at = findTextBlock(input)
  return at < 0 ? null : input.slice(at + 5).trim()
}

/**
 * 把 Add Quality Tags 追加到主提示词：NAI 要求 Text: 块在最末尾，
 * 有 Text: 块时插到它前面。
 */
export function withQualityTags(base: string, version: NaiVersion): string {
  const at = findTextBlock(base)
  if (at < 0) {
    return joinPrompt(base, QUALITY_TAGS[version])
  }
  return `${joinPrompt(base.slice(0, at), QUALITY_TAGS[version])}, ${base.slice(at).trim()}`
}
