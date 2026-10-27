import { diffTags, type DiffTag, type SentenceDiff, type TagDiff, type WordPart } from './tag-diff'

const words = (text: string) => text.match(/\s+|[\p{Script=Han}]|[\p{L}\p{N}_'-]+|[^\s]/gu) ?? []
const prose = (tagDifference: DiffTag) =>
  /^Text:/i.test(tagDifference.text) ||
  /[.!?。！？]/.test(tagDifference.text) ||
  tagDifference.text.split(/\s+/).length >= 8

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
  const diff = diffTags(before, after)
  const additions = [...diff.added]
  const removed: DiffTag[] = []
  const sentences: SentenceDiff[] = []
  for (const old of diff.removed) {
    if (!prose(old)) {
      removed.push(old)
      continue
    }
    const oldWords = new Set(words(old.text).filter((text) => text.trim()))
    let match = -1
    let score = 0.25
    additions.forEach((next, i) => {
      if (!prose(next)) {
        return
      }
      const nextWords = new Set(words(next.text).filter((text) => text.trim()))
      const common = [...nextWords].filter((text) => oldWords.has(text)).length
      const overlap = common / Math.max(oldWords.size, nextWords.size, 1)
      if (overlap > score) {
        match = i
        score = overlap
      }
    })
    if (match < 0) {
      sentences.push({ before: old.text, after: '', parts: wordParts(old.text, '') })
      continue
    }
    const next = additions.splice(match, 1)[0]
    sentences.push({ before: old.text, after: next.text, parts: wordParts(old.text, next.text) })
  }
  const added = additions.filter((tagDifference) => !prose(tagDifference))
  for (const tagDifference2 of additions.filter(prose)) {
    sentences.push({
      before: '',
      after: tagDifference2.text,
      parts: wordParts('', tagDifference2.text),
    })
  }
  return { added, removed, changed: diff.changed, sentences }
}
