import { diffTags, diffSize, tagsOf, type TagDiff, type WordPart } from './tag-diff'

const words = (text: string) => text.match(/\s+|[\p{Script=Han}]|[\p{L}\p{N}_'-]+|[^\s]/gu) ?? []
const prose = (text: string) =>
  /^Text:/i.test(text) || /[.!?。！？](?:\s|$)/.test(text) || text.trim().split(/\s+/).length >= 8

/** Keep unchanged context and exact whitespace around word-level changes. */
export function wordParts(before: string, after: string): WordPart[] {
  const beforeWords = words(before)
  const afterWords = words(after)
  const parts: WordPart[] = []
  const push = (kind: WordPart['kind'], text: string) => {
    if (!text) {
      return
    }
    const last = parts.at(-1)
    if (last?.kind === kind) {
      last.text += text
    } else {
      parts.push({ kind, text })
    }
  }
  let start = 0
  let endA = beforeWords.length
  let endB = afterWords.length
  while (start < endA && start < endB && beforeWords[start] === afterWords[start]) {
    start++
  }
  while (endA > start && endB > start && beforeWords[endA - 1] === afterWords[endB - 1]) {
    endA--
    endB--
  }
  push('same', beforeWords.slice(0, start).join(''))
  const rows = endA - start + 1
  const cols = endB - start + 1
  if (rows * cols > 1_000_000) {
    push('remove', beforeWords.slice(start, endA).join(''))
    push('add', afterWords.slice(start, endB).join(''))
  } else {
    const lcs = new Uint16Array(rows * cols)
    for (let i = rows - 2; i >= 0; i--) {
      for (let j = cols - 2; j >= 0; j--) {
        lcs[i * cols + j] =
          beforeWords[start + i] === afterWords[start + j]
            ? 1 + lcs[(i + 1) * cols + j + 1]
            : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < rows - 1 || j < cols - 1) {
      if (i < rows - 1 && j < cols - 1 && beforeWords[start + i] === afterWords[start + j]) {
        push('same', beforeWords[start + i])
        i++
        j++
      } else if (
        i < rows - 1 &&
        (j === cols - 1 || lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])
      ) {
        push('remove', beforeWords[start + i++])
      } else {
        push('add', afterWords[start + j++])
      }
    }
  }
  push('same', beforeWords.slice(endA).join(''))
  return parts
}
export function changedWords(
  before: string,
  after: string,
): { removed: string[]; added: string[] } {
  const parts = wordParts(before, after)
  return {
    removed: parts
      .filter((wordPart) => wordPart.kind === 'remove')
      .map((wordPart) => wordPart.text.trim())
      .filter(Boolean),
    added: parts
      .filter((wordPart) => wordPart.kind === 'add')
      .map((wordPart) => wordPart.text.trim())
      .filter(Boolean),
  }
}

export function diffPrompt(before: string, after: string): TagDiff {
  if (before === after) {
    return { added: [], removed: [], changed: [] }
  }
  const diff = diffTags(before, after)
  // Compare prose as one field, preserving punctuation, weights and original order.
  if ([...tagsOf(before), ...tagsOf(after)].some((tag) => prose(tag.text)) || !diffSize(diff)) {
    return {
      added: [],
      removed: [],
      changed: [],
      sentences: [{ before, after, parts: changeRanges(wordParts(before, after)) }],
    }
  }
  return diff
}

export interface ContextPart extends WordPart {
  hiddenText?: string
}

/** Highlight phrases rather than isolated words, without changing either side's text. */
function changeRanges(parts: WordPart[]): WordPart[] {
  const result: WordPart[] = []
  let pending: WordPart[] = []
  const flush = () => {
    for (const kind of ['remove', 'add'] as const) {
      const text = pending
        .filter((part) => part.kind === kind || part.kind === 'same')
        .map((part) => part.text)
        .join('')
      if (text) {
        result.push({ kind, text })
      }
    }
    pending = []
  }
  parts.forEach((part, index) => {
    const bridge =
      part.kind === 'same' &&
      pending.length > 0 &&
      part.text.length <= 16 &&
      !/[\n.!?。！？]/.test(part.text) &&
      parts[index + 1]?.kind !== 'same' &&
      index + 1 < parts.length
    if (part.kind !== 'same' || bridge) {
      pending.push(part)
    } else {
      flush()
      result.push(part)
    }
  })
  flush()
  return result
}

/** Collapse only long unchanged runs, keeping context next to every changed token. */
export function foldContext(parts: WordPart[]): ContextPart[] {
  return parts.map((part, index) => {
    const characters = Array.from(part.text)
    if (part.kind !== 'same' || characters.length <= 240) {
      return part
    }
    const prefix = index === 0 ? '' : characters.slice(0, 80).join('')
    const suffix = index === parts.length - 1 ? '' : characters.slice(-80).join('')
    return { ...part, text: `${prefix} … ${suffix}`, hiddenText: part.text }
  })
}
