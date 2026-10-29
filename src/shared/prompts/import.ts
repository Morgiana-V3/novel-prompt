import { fromMetadata, recipeFromTexts } from '../images/metadata'
import type { NaiGenRequest } from '../generation/types'
import type { AiCharacter } from './types'

export interface ImportedPrompt {
  request?: NaiGenRequest
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
  const out: Record<string, string> = Object.create(null)
  let off = 8
  while (off + 8 <= buf.length) {
    const len = view.getUint32(off)
    if (off + 12 + len > buf.length) {
      throw new Error('PNG 数据不完整')
    }
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
    if (key === 'NovelPrompt' && out[key] !== undefined) {
      throw new Error('图片包含冲突的生成记录')
    }
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
          throw new Error('PNG 文本记录不完整')
        }
        const body = data.subarray(tkey + 1)
        out[key] = decode(compressed ? await inflate(body) : body)
      }
    } catch {
      if (key === 'NovelPrompt') {
        throw new Error('图片生成记录损坏')
      }
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
  const recipe = recipeFromTexts(texts)
  if (recipe) {
    return {
      base: recipe.request.base,
      negative: recipe.request.negative,
      characters: recipe.request.characters,
      request: recipe.request,
      width: recipe.request.params.width,
      height: recipe.request.params.height,
      fromMetadata: true,
      structured: true,
    }
  }
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
