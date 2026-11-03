import { findTextBlock } from '../../../../shared/generation/presets'

interface TextPatch {
  start: number
  before: string
  after: string
}

interface PromptUnit {
  raw: string
  content: string
}

export interface TextChangeDescription {
  before: string
  after: string
  operation: 'add' | 'remove' | 'replace' | 'format' | 'reorder'
}

/** 句末标点：中文句号类直接断句，英文的 . ! ? 后面要跟空白（避开 1.5、e.g 这类写法） */
function sentenceEnd(text: string, i: number) {
  return '。！？'.includes(text[i]) || ('.!?'.includes(text[i]) && /\s/.test(text[i + 1] ?? ''))
}

/** 以句末标点结尾的单元是一句自然语言 */
const isSentence = (raw: string) => /[.!?。！？]$/.test(raw.trim())

/**
 * Keep punctuation attached to its tag, and keep weighted/quoted groups indivisible.
 * 自然语言段落按句拆开，这样新增、删除或改写的单句也能单独采纳。
 */
function units(text: string): PromptUnit[] {
  const result: PromptUnit[] = []
  const textAt = findTextBlock(text)
  let start = 0
  let depth = 0
  let numeric = false
  let quote = false
  for (let i = 0; i < text.length; i++) {
    if (i === textAt) {
      break
    }
    const ch = text[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '"') {
      quote = !quote
    }
    if (quote) {
      continue
    }
    if ('{[('.includes(ch)) {
      depth++
    }
    if ('}])'.includes(ch)) {
      depth = Math.max(0, depth - 1)
    }
    const opening = /^-?\d+(?:\.\d+)?::/.exec(text.slice(i))
    if (opening) {
      numeric = true
      i += opening[0].length - 1
      continue
    }
    if (text.slice(i, i + 2) === '::') {
      numeric = false
      i++
      continue
    }
    if (!depth && !numeric && (/[,\n|]/.test(ch) || sentenceEnd(text, i))) {
      // 逗号等分隔符不算内容，句末标点属于这句话
      const content = text.slice(start, /[,\n|]/.test(ch) ? i : i + 1).trim()
      while (i + 1 < text.length && /\s/.test(text[i + 1])) {
        i++
      }
      result.push({ raw: text.slice(start, i + 1), content })
      start = i + 1
    }
  }
  if (start < text.length) {
    result.push({ raw: text.slice(start), content: text.slice(start).trim() })
  }
  return result
}

/** Separators belong to the executable patch, not to the meaning of a change.
 * A retained tag whose comma/newline changes must never appear as deleted. */
export function describeTextChange(before: string, after: string): TextChangeDescription {
  const a = units(before)
    .map((unit) => unit.content)
    .filter(Boolean)
  const b = units(after)
    .map((unit) => unit.content)
    .filter(Boolean)
  const retained = new Map<string, number>()
  for (const text of b) {
    retained.set(text, (retained.get(text) ?? 0) + 1)
  }
  const removed: string[] = []
  for (const text of a) {
    const count = retained.get(text) ?? 0
    if (count) {
      retained.set(text, count - 1)
    } else {
      removed.push(text)
    }
  }
  // Keep occurrence counts: removing one of two identical tags is still a deletion.
  const added: string[] = []
  for (const text of b) {
    const count = retained.get(text) ?? 0
    if (count) {
      added.push(text)
      retained.set(text, count - 1)
    }
  }
  let operation: TextChangeDescription['operation'] = 'format'
  if (removed.length && added.length) {
    operation = 'replace'
  } else if (removed.length) {
    operation = 'remove'
  } else if (added.length) {
    operation = 'add'
  }
  if (operation === 'format' && a.join('\n') !== b.join('\n')) {
    return { before: a.join(', '), after: b.join(', '), operation: 'reorder' }
  }
  return { before: removed.join(', '), after: added.join(', '), operation }
}

/** LCS on complete tags; a replacement and its separator are always one reversible action. */
export function adoptionTextPatches(before: string, after: string): TextPatch[] {
  if (before === after) {
    return []
  }
  const a = units(before).map((unit) => unit.raw)
  const b = units(after).map((unit) => unit.raw)
  const cols = b.length + 1
  if ((a.length + 1) * cols > 1_000_000) {
    return [{ start: 0, before, after }]
  }
  const lcs = new Uint32Array((a.length + 1) * cols)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * cols + j] =
        a[i] === b[j]
          ? 1 + lcs[(i + 1) * cols + j + 1]
          : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1])
    }
  }
  const patches: TextPatch[] = []
  let offset = 0
  let old: string[] = []
  let next: string[] = []
  const emit = (from: string[], to: string[]) => {
    if (!from.length && !to.length) {
      return
    }
    // 连续改写多句视为改写一整段，保持为一处修改；单句改写和 tag 替换仍逐条拆开
    const passage = from.length > 1 && [...from, ...to].some(isSentence)
    if (from.length === to.length && !passage) {
      from.forEach((text, i) => {
        patches.push({ start: offset, before: text, after: to[i] })
        offset += text.length
      })
    } else {
      patches.push({ start: offset, before: from.join(''), after: to.join('') })
      offset += from.join('').length
    }
  }
  // 内容没变、只是分隔符变了的单元（如末尾追加一句时上一句补了空格）并入它后面的改动，
  // 它前面的改动仍各自独立
  const bare = (raw: string) => raw.replace(/[\s,|]+$/, '')
  const flush = () => {
    const at = old.findIndex((text) => next.some((other) => bare(other) === bare(text)))
    const to = at < 0 ? -1 : next.findIndex((other) => bare(other) === bare(old[at]))
    if (at > 0 || to > 0) {
      emit(old.slice(0, at), next.slice(0, to))
      emit(old.slice(at), next.slice(to))
    } else {
      emit(old, next)
    }
    old = []
    next = []
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush()
      offset += a[i++].length
      j++
    } else if (
      i < a.length &&
      (j === b.length || lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])
    ) {
      old.push(a[i++])
    } else {
      next.push(b[j++])
    }
  }
  flush()
  return patches
}
