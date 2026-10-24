import { diffTags, type DiffTag, type TagDiff } from './tag-diff'

const words = (s: string) => s.match(/\s+|[\p{Script=Han}]|[\p{L}\p{N}_'-]+|[^\s]/gu) ?? []
const prose = (t: DiffTag) => /^Text:/i.test(t.text) || /[.!?。！？]/.test(t.text) || t.text.split(/\s+/).length >= 8

/** Only changed spans of a natural-language sentence; keep tag/weight diffs unchanged. */
export function changedWords(before: string, after: string): { removed: string[]; added: string[] } {
  const a = words(before), b = words(after)
  const removed: string[] = [], added: string[] = []
  let start = 0, endA = a.length, endB = b.length
  while (start < endA && start < endB && a[start] === b[start]) start++
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const rows = endA - start + 1, cols = endB - start + 1
  // Bound memory for the maximum-length imported prompt; fallback is still exact.
  if (rows * cols > 1_000_000) return { removed: [a.slice(start, endA).join('')].filter(Boolean), added: [b.slice(start, endB).join('')].filter(Boolean) }
  const lcs = new Uint16Array(rows * cols)
  for (let i = rows - 2; i >= 0; i--) for (let j = cols - 2; j >= 0; j--)
    lcs[i * cols + j] = a[start + i] === b[start + j] ? 1 + lcs[(i + 1) * cols + j + 1] : Math.max(lcs[(i + 1) * cols + j], lcs[i * cols + j + 1])
  let i = 0, j = 0, del = '', add = ''
  const flush = () => { if (del.trim()) removed.push(del.trim()); if (add.trim()) added.push(add.trim()); del = ''; add = '' }
  while (i < rows - 1 || j < cols - 1) {
    if (i < rows - 1 && j < cols - 1 && a[start + i] === b[start + j]) { flush(); i++; j++ }
    else if (i < rows - 1 && (j === cols - 1 || lcs[(i + 1) * cols + j] >= lcs[i * cols + j + 1])) del += a[start + i++]
    else add += b[start + j++]
  }
  flush()
  return { removed, added }
}

export function diffPrompt(before: string, after: string): TagDiff {
  const diff = diffTags(before, after), additions = [...diff.added]
  const removed: DiffTag[] = [], added: DiffTag[] = []
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
    if (match < 0) { removed.push(old); continue }
    const next = additions.splice(match, 1)[0], spans = changedWords(old.text, next.text)
    spans.removed.forEach((text, i) => removed.push({ key: `${old.key}:word:${i}`, text: `句内：${text}`, weight: 1 }))
    spans.added.forEach((text, i) => added.push({ key: `${next.key}:word:${i}`, text: `句内：${text}`, weight: 1 }))
  }
  return { added: [...additions, ...added], removed, changed: diff.changed }
}
