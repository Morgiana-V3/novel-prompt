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

/** Keep punctuation attached to its tag, and keep weighted/quoted groups indivisible. */
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
    if (!depth && !numeric && /[,\n|]/.test(ch)) {
      const content = text.slice(start, i).trim()
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
  const flush = () => {
    if (!old.length && !next.length) {
      return
    }
    if (old.length === next.length) {
      old.forEach((text, i) => {
        patches.push({ start: offset, before: text, after: next[i] })
        offset += text.length
      })
    } else {
      patches.push({ start: offset, before: old.join(''), after: next.join('') })
      offset += old.join('').length
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
