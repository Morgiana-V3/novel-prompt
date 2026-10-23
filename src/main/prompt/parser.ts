import type { PromptToken } from '../../shared/types'
import { findTextBlock } from '../../shared/nai-presets'

/**
 * NovelAI V4.5 / V5 提示词解析
 * - 分隔：逗号、换行、| （| 视为分段，常用于多角色）
 * - 权重：{tag} ×1.05、[tag] ÷1.05、数值权重 1.5::tag:: / -1::tag::（可包含多个 tag）；
 *   不带数字的 :: 结束该段，同时闭合前面所有未闭合的 { [
 * - 前缀：artist:xxx，动作 tag：source#/target#/mutual#
 * - 文字：Text: 块（到结尾，可跟在逗号、换行或句末标点之后）、"引号内文字"（V5 自动转 Text 块）
 */
const BRACE_W = 1.05
const NUM_WEIGHT_RE = /^(-?\d+(?:\.\d+)?)::/
const ACTION_RE = /^(source|target|mutual)#\s*/i
const ARTIST_RE = /^artist:\s*/i

interface Buf {
  text: string
  start: number
  end: number
  weight: number
}

export function parsePrompt(input: string): PromptToken[] {
  const tokens: PromptToken[] = []
  const stack: { kind: 'brace' | 'bracket' | 'num'; w: number }[] = []
  let section = 0
  let inQuote = false
  let buf = null as Buf | null
  const textAt = findTextBlock(input)

  const curWeight = () => stack.reduce((acc, s) => acc * s.w, 1)

  const flush = () => {
    if (!buf) return
    const b = buf
    buf = null
    const core = b.text.trim()
    if (!core) return
    for (const piece of splitSentences(input, b, core)) tokens.push(makeToken(input, piece, piece.text, section))
  }

  const push = (ch: string, i: number, width = 1) => {
    if (!buf) {
      if (/\s/.test(ch)) return
      buf = { text: '', start: i, end: i + width, weight: curWeight() }
    }
    buf.text += ch
    if (!/\s/.test(ch)) buf.end = i + width
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (inQuote) {
      push(ch, i)
      if (ch === '"') inQuote = false
      continue
    }

    // Text: 块，到结尾都视为文字（其中的逗号、括号、权重符号都是要画的字）
    if (i === textAt) {
      flush()
      const rest = input.slice(i)
      tokens.push({
        start: i,
        end: input.length,
        raw: rest,
        core: rest.slice(5).trim(),
        kind: 'text',
        weight: curWeight(),
        prefix: 'Text:',
        section
      })
      break
    }

    if (ch === '"') {
      inQuote = true
      push(ch, i)
      continue
    }

    if (ch === ',' || ch === '\n' || ch === '\r') {
      flush()
      continue
    }
    if (ch === '|') {
      flush()
      section++
      continue
    }

    // 数值权重开头
    if (!buf || !buf.text.trim()) {
      const m = NUM_WEIGHT_RE.exec(input.slice(i))
      if (m) {
        flush()
        stack.push({ kind: 'num', w: parseFloat(m[1]) })
        i += m[0].length - 1
        continue
      }
    }
    // 结束符 ::：结束数值权重段，同时闭合前面所有未闭合的 { [
    if (ch === ':' && input[i + 1] === ':') {
      flush()
      stack.length = 0
      i++
      continue
    }

    if (ch === '\\' && /[()[\]{}]/.test(input[i + 1] ?? '')) {
      push(input[i + 1], i, 2)
      i++
      continue
    }
    if (ch === '{' || ch === '[') {
      flush()
      stack.push({ kind: ch === '{' ? 'brace' : 'bracket', w: ch === '{' ? BRACE_W : 1 / BRACE_W })
      continue
    }
    if (ch === '}' || ch === ']') {
      flush()
      const idx = findLast(stack, ch === '}' ? 'brace' : 'bracket')
      if (idx >= 0) stack.splice(idx, 1)
      continue
    }

    push(ch, i)
  }
  flush()
  return tokens
}

function findLast(stack: { kind: string }[], kind: string): number {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === kind) return i
  return -1
}

/**
 * 把「句子. tag」这类用句号连接的片段拆开。
 * 只有句号前至少 3 个单词时才拆分，避免误拆 `st. louis (azur lane)` 这类 tag。
 */
function splitSentences(input: string, b: Buf, core: string): Buf[] {
  const raw = input.slice(b.start, b.end)
  if (raw !== core || !/[.!?。！？]\s/.test(core)) return [{ ...b, text: core }]
  const out: Buf[] = []
  const re = /[.!?。！？]\s+/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(core))) {
    const seg = core.slice(last, m.index + 1)
    if (seg.trim().split(/\s+/).length < 3) continue
    out.push({ ...b, text: seg.trim(), start: b.start + last, end: b.start + m.index + 1 })
    last = m.index + m[0].length
  }
  if (last < core.length) out.push({ ...b, text: core.slice(last), start: b.start + last, end: b.end })
  return out.length ? out : [{ ...b, text: core }]
}

function makeToken(input: string, buf: Buf, core: string, section: number): PromptToken {
  const base = {
    start: buf.start,
    end: buf.end,
    raw: input.slice(buf.start, buf.end),
    weight: Math.round(buf.weight * 1000) / 1000,
    section
  }
  const action = ACTION_RE.exec(core)
  if (action) {
    return { ...base, core: core.slice(action[0].length), kind: 'action', prefix: `${action[1].toLowerCase()}#` }
  }
  const artist = ARTIST_RE.exec(core)
  if (artist) {
    return { ...base, core: core.slice(artist[0].length), kind: 'tag', prefix: 'artist:' }
  }
  if (core.startsWith('"') && core.endsWith('"') && core.length >= 2) {
    return { ...base, core: core.slice(1, -1), kind: 'text' }
  }
  if (core.includes('"')) return { ...base, core, kind: 'natural' }
  return { ...base, core, kind: 'tag' }
}
