import { diffTags, type DiffTag, type TagDiff, type WordPart, type SentenceDiff } from './tag-diff'

const words = (s: string) => s.match(/\s+|[\p{Script=Han}]|[\p{L}\p{N}_'-]+|[^\s]/gu) ?? []
const prose = (t: DiffTag) => /^Text:/i.test(t.text) || /[.!?。！？]/.test(t.text) || t.text.split(/\s+/).length >= 8

/** Keep unchanged context and exact whitespace around word-level changes. */
export function wordParts(before: string, after: string): WordPart[] {
  const a = words(before), b = words(after), parts: WordPart[] = []
  const push = (kind: WordPart['kind'], text: string) => {
    if (!text) return
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  let start = 0, endA = a.length, endB = b.length
  while (start < endA && start < endB && a[start] === b[start]) start++
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  push('same', a.slice(0, start).join(''))
  const rows = endA - start + 1, cols = endB - start + 1
  if (rows * cols > 1_000_000) {
    push('remove', a.slice(start, endA).join('')); push('add', b.slice(start, endB).join(''))
  } else {
    const lcs = new Uint16Array(rows * cols)
    for (let i = rows - 2; i >= 0; i--) for (let j = cols - 2; j >= 0; j--)
      lcs[i * cols + j] = a[start + i] === b[start + j] ? 1 + lcs[(i + 1) * cols + j + 1] : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1])
    let i = 0, j = 0
    while (i < rows - 1 || j < cols - 1) {
      if (i < rows - 1 && j < cols - 1 && a[start + i] === b[start + j]) { push('same', a[start + i]); i++; j++ }
      else if (i < rows - 1 && (j === cols - 1 || lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])) push('remove', a[start + i++])
      else push('add', b[start + j++])
    }
  }
  push('same', a.slice(endA).join(''))
  return parts
}
export function changedWords(before: string, after: string): { removed: string[]; added: string[] } {
  const parts = wordParts(before, after)
  return { removed: parts.filter(p=>p.kind==='remove').map(p=>p.text.trim()).filter(Boolean), added: parts.filter(p=>p.kind==='add').map(p=>p.text.trim()).filter(Boolean) }
}

export function diffPrompt(before: string, after: string): TagDiff {
  const diff = diffTags(before, after), additions = [...diff.added]
  const removed: DiffTag[] = [], sentences: SentenceDiff[] = []
  for (const old of diff.removed) {
    if (!prose(old)) { removed.push(old); continue }
    const oldWords = new Set(words(old.text).filter(w => w.trim()))
    let match = -1, score = .25
    additions.forEach((next, i) => {
      if (!prose(next)) return
      const nextWords = new Set(words(next.text).filter(w => w.trim()))
      const common = [...nextWords].filter(w => oldWords.has(w)).length
      const overlap = common / Math.max(oldWords.size, nextWords.size, 1)
      if (overlap > score) { match = i; score = overlap }
    })
    if (match < 0) { sentences.push({before:old.text,after:'',parts:wordParts(old.text,'')}); continue }
    const next = additions.splice(match, 1)[0]
    sentences.push({ before: old.text, after: next.text, parts: wordParts(old.text, next.text) })
  }
  const added = additions.filter(t=>!prose(t))
  for (const t of additions.filter(prose)) sentences.push({ before:'', after:t.text, parts:wordParts('',t.text) })
  return { added, removed, changed: diff.changed, sentences }
}
