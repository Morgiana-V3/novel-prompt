import type { InpaintDraft } from '@shared/prompts/types'

export interface CharacterPair {
  before?: number
  after?: number
}

/** Exact, unique anchors avoid treating a middle insertion as edits to all later roles.
 * Ambiguous structural changes stay atomic: character drafts have no stable identity IDs. */
export function alignCharacters(
  before: InpaintDraft['characters'],
  after: InpaintDraft['characters'],
): CharacterPair[] | null {
  const key = (c: InpaintDraft['characters'][number]) =>
    JSON.stringify([c.prompt, c.negative || '', c.position || ''])
  const a = before.map(key)
  const b = after.map(key)
  const anchors = a.flatMap((value, index) => {
    const target = b.indexOf(value)
    return target >= 0 &&
      a.indexOf(value) === a.lastIndexOf(value) &&
      target === b.lastIndexOf(value)
      ? [{ before: index, after: target }]
      : []
  })
  if (anchors.some((pair, i) => i > 0 && pair.after <= anchors[i - 1].after)) {
    return null
  }
  const pairs: CharacterPair[] = []
  let left = 0
  let right = 0
  for (const anchor of [...anchors, { before: a.length, after: b.length }]) {
    const oldCount = anchor.before - left
    const newCount = anchor.after - right
    if (oldCount && newCount && oldCount !== newCount) {
      return null
    }
    for (let i = 0; i < Math.max(oldCount, newCount); i++) {
      pairs.push({
        before: i < oldCount ? left + i : undefined,
        after: i < newCount ? right + i : undefined,
      })
    }
    if (anchor.before < a.length) {
      pairs.push(anchor)
    }
    left = anchor.before + 1
    right = anchor.after + 1
  }
  return pairs
}
