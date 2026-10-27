import type { AiCharacter } from './types'

export interface ImportedPrompt {
  base: string
  negative: string
  characters: AiCharacter[]
  width?: number
  height?: number
  /** 来自 NAI 元数据：提示词里已经包含质量词与 UC 预设 */
  fromMetadata?: boolean
  /** 是否识别到结构（分节标记或元数据），未识别时整段视为主提示词 */
  structured: boolean
}

/* ---------- 分节文本 ---------- */

type Section =
  | { kind: 'base' }
  | { kind: 'neg' }
  | { kind: 'char'; index: number; position?: string }
  | { kind: 'charNeg'; index: number }

const BASE_RE =
  /^(prompt|base|base prompt|base caption|main prompt|positive|positive prompt|正向|正面|正向提示词|正面提示词|主提示词|基础提示词|提示词)$/i
const NEG_RE =
  /^(undesired content|uc|negative|negative prompt|负面|负向|反向|负面提示词|负向提示词|反向提示词)$/i
const CHAR_RE = /^(?:character|char|角色|人物)\s*(\d{1,2})\s*(.*)$/i
const CHAR_NEG_RE =
  /^[-·:：]?\s*(undesired content|uc|negative|negative prompt|负面|负向|负面提示词)$/i
const CHAR_POS_RE = /^(?:@|[(（]|位置[:：]?)\s*([^)）]+?)\s*[)）]?$/

/**
 * 分节标题行：[Prompt]、【角色1】、## 负面、UC: xxx。
 * 冒号形式要求标题里不含逗号 / 括号，避免把 artist:xxx、1.2::tag:: 当成标题（它们也会在 classify 中被排除）。
 */
const HEADER_RE =
  /^\s*(?:\[([^\]\n]+)\]|【([^】\n]+)】|#{1,4}\s*([^\n:：]+?)\s*(?:[:：]|$)|([^\n:：,{}[\]|]{1,30}?)\s*[:：])\s*(.*)$/

function classify(label: string): Section | null {
  const text = label.trim().replace(/\s+/g, ' ')
  if (BASE_RE.test(text)) {
    return { kind: 'base' }
  }
  if (NEG_RE.test(text)) {
    return { kind: 'neg' }
  }
  const match = CHAR_RE.exec(text)
  if (!match) {
    return null
  }
  const index = Number(match[1]) - 1
  const rest = match[2].trim()
  if (index < 0) {
    return null
  }
  if (!rest) {
    return { kind: 'char', index }
  }
  if (CHAR_NEG_RE.test(rest)) {
    return { kind: 'charNeg', index }
  }
  const pos = CHAR_POS_RE.exec(rest)
  return pos ? { kind: 'char', index, position: pos[1].trim() } : null
}

function parseSections(text: string): ImportedPrompt {
  const base: string[] = []
  const negative: string[] = []
  const chars = new Map<number, { prompt: string[]; negative: string[]; position?: string }>()
  const charOf = (i: number) => {
    if (!chars.has(i)) {
      chars.set(i, { prompt: [], negative: [] })
    }
    return chars.get(i)!
  }
  let cur: Section = { kind: 'base' }
  let structured = false
  const push = (line: string) => {
    if (cur.kind === 'base') {
      base.push(line)
    } else if (cur.kind === 'neg') {
      negative.push(line)
    } else if (cur.kind === 'char') {
      charOf(cur.index).prompt.push(line)
    } else {
      charOf(cur.index).negative.push(line)
    }
  }

  for (const line of text.split(/\r?\n/)) {
    const match = HEADER_RE.exec(line)
    const sec = match ? classify(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '') : null
    if (match && sec) {
      structured = true
      cur = sec
      if (sec.kind === 'char') {
        const character = charOf(sec.index)
        if (sec.position) {
          character.position = sec.position
        }
      }
      if (match[5].trim()) {
        push(match[5])
      }
      continue
    }
    push(line)
  }

  const join = (lines: string[]) => lines.join('\n').trim()
  return {
    base: join(base),
    negative: join(negative),
    characters: [...chars.entries()]
      .sort((character, character2) => character[0] - character2[0])
      .map(([, c]) => ({
        prompt: join(c.prompt),
        negative: join(c.negative),
        position: c.position ?? '',
      })),
    structured,
  }
}

/* ---------- NAI 元数据 JSON ---------- */

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

function fromMetadata(raw: unknown): ImportedPrompt | null {
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

/** 解析粘贴的文本：NAI 元数据 JSON → 分节文本 → 整段作为主提示词 */
export function parsePromptText(text: string): ImportedPrompt {
  const text2 = text.trim()
  if (text2.startsWith('{')) {
    try {
      const importedPrompt = fromMetadata(JSON.parse(text2))
      if (importedPrompt) {
        return importedPrompt
      }
    } catch {
      /* 不是 JSON，按文本处理 */
    }
  }
  return parseSections(text2)
}

/* ---------- PNG 元数据 ---------- */

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10]

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

export type InflateText = (bytes: Uint8Array) => Promise<Uint8Array>

/** 读取 PNG 的 tEXt / zTXt / iTXt 文本块 */
async function readPngText(buf: Uint8Array, inflate: InflateText): Promise<Record<string, string>> {
  if (!PNG_SIG.every((b, i) => buf[i] === b)) {
    throw new Error('不是 PNG 图片')
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: Record<string, string> = {}
  let off = 8
  while (off + 8 <= buf.length) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(...buf.subarray(off + 4, off + 8))
    const data = buf.subarray(off + 8, off + 8 + len)
    off += 12 + len
    if (type === 'IEND') {
      break
    }
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') {
      continue
    }
    const z = data.indexOf(0)
    if (z < 0) {
      continue
    }
    const key = decode(data.subarray(0, z))
    try {
      if (type === 'tEXt') {
        out[key] = decode(data.subarray(z + 1))
      } else if (type === 'zTXt') {
        out[key] = decode(await inflate(data.subarray(z + 2)))
      } else {
        const compressed = data[z + 1] === 1
        const lang = data.indexOf(0, z + 3) // 语言标签结束
        const tkey = lang < 0 ? -1 : data.indexOf(0, lang + 1) // 翻译后的关键字结束
        if (tkey < 0) {
          continue
        }
        const body = data.subarray(tkey + 1)
        out[key] = decode(compressed ? await inflate(body) : body)
      }
    } catch {
      /* 单个文本块损坏时跳过 */
    }
  }
  return out
}

/** 从 NovelAI 生成的原图中读取提示词 */
export async function parsePngPrompt(
  bytes: Uint8Array,
  inflate: InflateText,
): Promise<ImportedPrompt> {
  const texts = await readPngText(bytes, inflate)
  let badComment = false
  if (texts.Comment) {
    try {
      const importedPrompt = fromMetadata(JSON.parse(texts.Comment))
      if (importedPrompt) {
        return importedPrompt
      }
    } catch {
      badComment = true
    }
  }
  if (texts.Description) {
    return {
      base: texts.Description.trim(),
      negative: '',
      characters: [],
      fromMetadata: true,
      structured: true,
    }
  }
  // SD WebUI 格式：参数行（Steps: ...）不属于提示词
  if (texts.parameters) {
    return parsePromptText(texts.parameters.replace(/\n\s*Steps:[\s\S]*$/, ''))
  }
  if (badComment) {
    throw new Error('图片里有 Comment 元数据，但内容不是合法的 JSON（可能已损坏），读不出提示词')
  }
  throw new Error('图片里没有找到提示词信息（可能经过压缩、转存或去除了元数据）')
}
