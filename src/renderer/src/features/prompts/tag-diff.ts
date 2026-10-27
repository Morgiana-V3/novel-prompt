/** tag 级差异：用于展示 AI 优化前后改了什么 */

export interface DiffTag {
  key: string
  text: string
  weight: number
}

export interface WordPart {
  kind: 'same' | 'add' | 'remove'
  text: string
}
export interface SentenceDiff {
  before: string
  after: string
  parts: WordPart[]
}

export interface TagDiff {
  sentences?: SentenceDiff[]
  added: DiffTag[]
  removed: DiffTag[]
  changed: { from: DiffTag; to: DiffTag }[]
}

const fmtW = (width: number) => (Math.abs(width - 1) < 0.005 ? '' : ` ×${Number(width.toFixed(2))}`)

export function tagsOf(text: string): DiffTag[] {
  const out: DiffTag[] = []
  let group = 1
  for (const raw of text.split(/[,\n|]/)) {
    let text2 = raw.trim()
    if (!text2) {
      continue
    }
    const match = /^(-?\d+(?:\.\d+)?)::\s*/.exec(text2)
    if (match) {
      group = Number(match[1])
      text2 = text2.slice(match[0].length)
    }
    let width = group
    const closes = /\s*::$/.test(text2)
    if (closes) {
      text2 = text2.replace(/\s*::$/, '')
    }
    // 花括号 / 方括号可能跨多个 tag（{a, b}），开或闭任一侧都算
    const up = Math.max((text2.match(/\{/g) ?? []).length, (text2.match(/\}/g) ?? []).length)
    const down = Math.max((text2.match(/\[/g) ?? []).length, (text2.match(/\]/g) ?? []).length)
    width *= 1.05 ** (up - down)
    const core = text2.replace(/[{}[\]]/g, '').trim()
    if (closes) {
      group = 1
    }
    if (!core) {
      continue
    }
    const key = core.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ')
    out.push({ key, text: core + fmtW(width), weight: width })
  }
  return out
}

export function diffTags(before: string, after: string): TagDiff {
  const beforeTags = tagsOf(before)
  const afterTags = tagsOf(after)
  const mapA = new Map(beforeTags.map((tagDifference) => [tagDifference.key, tagDifference]))
  const mapB = new Map(afterTags.map((tagDifference) => [tagDifference.key, tagDifference]))
  const added: DiffTag[] = []
  const changed: TagDiff['changed'] = []
  for (const tagDifference2 of afterTags) {
    const old = mapA.get(tagDifference2.key)
    if (!old) {
      added.push(tagDifference2)
    } else if (
      Math.abs(old.weight - tagDifference2.weight) > 0.01 &&
      !changed.some((tagChange) => tagChange.to.key === tagDifference2.key)
    ) {
      changed.push({ from: old, to: tagDifference2 })
    }
  }
  const removed = beforeTags.filter((tagDifference) => !mapB.has(tagDifference.key))
  return { added: dedupe(added), removed: dedupe(removed), changed }
}

function dedupe(list: DiffTag[]): DiffTag[] {
  const seen = new Set<string>()
  return list.filter((tagDifference) => !seen.has(tagDifference.key) && seen.add(tagDifference.key))
}

export const diffSize = (difference: TagDiff) =>
  difference.added.length +
  difference.removed.length +
  difference.changed.length +
  (difference.sentences?.length ?? 0)
