/** tag 级差异：用于展示 AI 优化前后改了什么 */

export interface DiffTag {
  key: string
  text: string
  weight: number
}

export interface WordPart { kind: 'same' | 'add' | 'remove'; text: string }
export interface SentenceDiff { before: string; after: string; parts: WordPart[] }

export interface TagDiff {
  sentences?: SentenceDiff[]
  added: DiffTag[]
  removed: DiffTag[]
  changed: { from: DiffTag; to: DiffTag }[]
}

const fmtW = (w: number) => (Math.abs(w - 1) < 0.005 ? '' : ` ×${Number(w.toFixed(2))}`)

export function tagsOf(s: string): DiffTag[] {
  const out: DiffTag[] = []
  let group = 1
  for (const raw of s.split(/[,\n|]/)) {
    let t = raw.trim()
    if (!t) continue
    const m = /^(-?\d+(?:\.\d+)?)::\s*/.exec(t)
    if (m) {
      group = Number(m[1])
      t = t.slice(m[0].length)
    }
    let w = group
    const closes = /\s*::$/.test(t)
    if (closes) t = t.replace(/\s*::$/, '')
    // 花括号 / 方括号可能跨多个 tag（{a, b}），开或闭任一侧都算
    const up = Math.max((t.match(/\{/g) ?? []).length, (t.match(/\}/g) ?? []).length)
    const down = Math.max((t.match(/\[/g) ?? []).length, (t.match(/\]/g) ?? []).length)
    w *= 1.05 ** (up - down)
    const core = t.replace(/[{}[\]]/g, '').trim()
    if (closes) group = 1
    if (!core) continue
    const key = core.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ')
    out.push({ key, text: core + fmtW(w), weight: w })
  }
  return out
}

export function diffTags(before: string, after: string): TagDiff {
  const a = tagsOf(before)
  const b = tagsOf(after)
  const mapA = new Map(a.map((t) => [t.key, t]))
  const mapB = new Map(b.map((t) => [t.key, t]))
  const added: DiffTag[] = []
  const changed: TagDiff['changed'] = []
  for (const t of b) {
    const old = mapA.get(t.key)
    if (!old) added.push(t)
    else if (Math.abs(old.weight - t.weight) > 0.01 && !changed.some((c) => c.to.key === t.key)) changed.push({ from: old, to: t })
  }
  const removed = a.filter((t) => !mapB.has(t.key))
  return { added: dedupe(added), removed: dedupe(removed), changed }
}

function dedupe(list: DiffTag[]): DiffTag[] {
  const seen = new Set<string>()
  return list.filter((t) => !seen.has(t.key) && seen.add(t.key))
}

export const diffSize = (d: TagDiff) => d.added.length + d.removed.length + d.changed.length + (d.sentences?.length ?? 0)
