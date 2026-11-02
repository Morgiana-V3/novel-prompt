import type { AiChange } from '@shared/prompts/types'
import type { ReviewGroup } from './prompt-review'

export function reviewExplanations(groups: ReviewGroup[], changes: AiChange[]) {
  const fields = groups.flatMap((group) =>
    group.fields.map((field) => ({ group, field, key: `${group.key}/${field.key}` })),
  )
  const byField = new Map<string, AiChange[]>()
  const remaining: AiChange[] = []
  for (const change of changes) {
    let matches = fields.filter(
      ({ group, field }) =>
        group.key === 'global' && field.key === (change.scope === 'positive' ? 'base' : 'negative'),
    )
    if (change.scope === 'optional') {
      matches = []
    } else if (change.scope === 'character') {
      matches = fields.filter(({ group, field }) => {
        if (group.key === 'global') {
          return false
        }
        if (change.characterIndex === undefined) {
          return true
        }
        const fieldName = change.characterField ?? 'prompt'
        if (group.key === 'characters') {
          return field.key === `role-${change.characterIndex}-${fieldName}`
        }
        const index = change.characterSide === 'before' ? group.beforeIndex : group.afterIndex
        return index === change.characterIndex && field.key === fieldName
      })
    }
    // Never guess which role an old, unaddressed explanation belongs to.
    if (matches.length === 1) {
      const key = matches[0].key
      byField.set(key, [...(byField.get(key) ?? []), change])
    } else {
      remaining.push(change)
    }
  }
  return { byField, remaining }
}
