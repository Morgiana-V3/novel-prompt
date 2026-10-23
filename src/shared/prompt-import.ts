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

const BASE_RE = /^(prompt|base|base prompt|base caption|main prompt|positive|positive prompt|正向|正面|正向提示词|正面提示词|主提示词|基础提示词|提示词)$/i
const NEG_RE = /^(undesired content|uc|negative|negative prompt|负面|负向|反向|负面提示词|负向提示词|反向提示词)$/i
const CHAR_RE = /^(?:character|char|角色|人物)\s*(\d{1,2})\s*(.*)$/i
const CHAR_NEG_RE = /^[-·:：]?\s*(undesired content|uc|negative|negative prompt|负面|负向|负面提示词)$/i
const CHAR_POS_RE = /^(?:@|[(（]|位置[:：]?)\s*([^)）]+?)\s*[)）]?$/

/**
 * 分节标题行：[Prompt]、【角色1】、## 负面、UC: xxx。
 * 冒号形式要求标题里不含逗号 / 括号，避免把 artist:xxx、1.2::tag:: 当成标题（它们也会在 classify 中被排除）。
 */
const HEADER_RE = /^\s*(?:\[([^\]\n]+)\]|【([^】\n]+)】|#{1,4}\s*([^\n:：]+?)\s*(?:[:：]|$)|([^\n:：,{}[\]|]{1,30}?)\s*[:：])\s*(.*)$/

function classify(label: string): Section | null {
  const l = label.trim().replace(/\s+/g, ' ')
  if (BASE_RE.test(l)) return { kind: 'base' }
  if (NEG_RE.test(l)) return { kind: 'neg' }
  const m = CHAR_RE.exec(l)
  if (!m) return null
  const index = Number(m[1]) - 1
  const rest = m[2].trim()
  if (index < 0) return null
  if (!rest) return { kind: 'char', index }
  if (CHAR_NEG_RE.test(rest)) return { kind: 'charNeg', index }
  const pos = CHAR_POS_RE.exec(rest)
  return pos ? { kind: 'char', index, position: pos[1].trim() } : null
}

function parseSections(text: string): ImportedPrompt {
  const base: string[] = []
  const negative: string[] = []
  const chars = new Map<number, { prompt: string[]; negative: string[]; position?: string }>()
  const charOf = (i: number) => {
    if (!chars.has(i)) chars.set(i, { prompt: [], negative: [] })
    return chars.get(i)!
  }
  let cur: Section = { kind: 'base' }
  let structured = false
  const push = (line: string) => {
    if (cur.kind === 'base') base.push(line)
    else if (cur.kind === 'neg') negative.push(line)
    else if (cur.kind === 'char') charOf(cur.index).prompt.push(line)
    else charOf(cur.index).negative.push(line)
  }

  for (const line of text.split(/\r?\n/)) {
    const m = HEADER_RE.exec(line)
    const sec = m ? classify(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '') : null
    if (m && sec) {
      structured = true
      cur = sec
      if (sec.kind === 'char') {
        const c = charOf(sec.index)
        if (sec.position) c.position = sec.position
      }
      if (m[5].trim()) push(m[5])
      continue
    }
    push(line)
  }

  const join = (lines: string[]) => lines.join('\n').trim()
  return {
    base: join(base),
    negative: join(negative),
    characters: [...chars.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({ prompt: join(c.prompt), negative: join(c.negative), position: c.position ?? '' })),
    structured
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

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const n = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : undefined)

/**
 * NAI 角色中心点（0~1）→ 位置写法。正好落在 5×5 网格中心（如 0.3,0.5）时写成网格 B3，
 * 否则保留原坐标「0.231,0.467」，避免有损转换。
 */
function positionOf(c?: { x?: number; y?: number }): string {
  if (typeof c?.x !== 'number' || typeof c?.y !== 'number') return ''
  const cell = (v: number) => {
    const i = Math.round(v * 5 - 0.5)
    return i >= 0 && i <= 4 && Math.abs((i + 0.5) / 5 - v) < 1e-6 ? i : -1
  }
  const cx = cell(c.x)
  const cy = cell(c.y)
  if (cx >= 0 && cy >= 0) return `${'ABCDE'[cx]}${cy + 1}`
  const fmt = (v: number) => String(Number(Math.min(1, Math.max(0, v)).toFixed(4)))
  return `${fmt(c.x)},${fmt(c.y)}`
}

function fromMetadata(raw: unknown): ImportedPrompt | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as NaiMeta
  const p = o.parameters && typeof o.parameters === 'object' ? { ...o.parameters, input: o.input } : o
  const cap = p.v4_prompt?.caption
  const ncap = p.v4_negative_prompt?.caption
  const base = s(cap?.base_caption) || s(p.prompt) || s(p.input)
  const negative = s(ncap?.base_caption) || s(p.uc) || s(p.negative_prompt)
  if (!base && !negative) return null
  const useCoords = p.v4_prompt?.use_coords === true
  return {
    base,
    negative,
    characters: (cap?.char_captions ?? []).map((c, i) => ({
      prompt: s(c.char_caption),
      negative: s(ncap?.char_captions?.[i]?.char_caption),
      position: useCoords ? positionOf(c.centers?.[0]) : ''
    })),
    width: n(p.width),
    height: n(p.height),
    fromMetadata: true,
    structured: true
  }
}

/** 解析粘贴的文本：NAI 元数据 JSON → 分节文本 → 整段作为主提示词 */
export function parsePromptText(text: string): ImportedPrompt {
  const t = text.trim()
  if (t.startsWith('{')) {
    try {
      const r = fromMetadata(JSON.parse(t))
      if (r) return r
    } catch {
      /* 不是 JSON，按文本处理 */
    }
  }
  return parseSections(t)
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

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 读取 PNG 的 tEXt / zTXt / iTXt 文本块 */
async function readPngText(buf: Uint8Array): Promise<Record<string, string>> {
  if (!PNG_SIG.every((b, i) => buf[i] === b)) throw new Error('不是 PNG 图片')
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: Record<string, string> = {}
  let off = 8
  while (off + 8 <= buf.length) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(...buf.subarray(off + 4, off + 8))
    const data = buf.subarray(off + 8, off + 8 + len)
    off += 12 + len
    if (type === 'IEND') break
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') continue
    const z = data.indexOf(0)
    if (z < 0) continue
    const key = decode(data.subarray(0, z))
    try {
      if (type === 'tEXt') out[key] = decode(data.subarray(z + 1))
      else if (type === 'zTXt') out[key] = decode(await inflate(data.subarray(z + 2)))
      else {
        const compressed = data[z + 1] === 1
        const lang = data.indexOf(0, z + 3) // 语言标签结束
        const tkey = lang < 0 ? -1 : data.indexOf(0, lang + 1) // 翻译后的关键字结束
        if (tkey < 0) continue
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
export async function readPngPrompt(file: Blob): Promise<ImportedPrompt> {
  const texts = await readPngText(new Uint8Array(await file.arrayBuffer()))
  let badComment = false
  if (texts.Comment) {
    try {
      const r = fromMetadata(JSON.parse(texts.Comment))
      if (r) return r
    } catch {
      badComment = true
    }
  }
  if (texts.Description) return { base: texts.Description.trim(), negative: '', characters: [], fromMetadata: true, structured: true }
  // SD WebUI 格式：参数行（Steps: ...）不属于提示词
  if (texts.parameters) return parsePromptText(texts.parameters.replace(/\n\s*Steps:[\s\S]*$/, ''))
  if (badComment) throw new Error('图片里有 Comment 元数据，但内容不是合法的 JSON（可能已损坏），读不出提示词')
  throw new Error('图片里没有找到提示词信息（可能经过压缩、转存或去除了元数据）')
}
