import type { InpaintChange, InpaintDraft } from '@shared/prompts/types'

export interface ReviewField {
  key: string
  label: string
  before: string
  after: string
  reason: string
  kind: 'prompt' | 'position'
  sourceIndex?: number
}
export interface ReviewGroup {
  key: string
  label: string
  status: 'changed' | 'added' | 'removed'
  fields: ReviewField[]
}

/** Source indexes continue to address the original selectable plan changes. */
export function reviewChanges(
  changes: InpaintChange[],
  before?: InpaintDraft,
  after?: InpaintDraft,
): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  function groupFor(characterIndex?: number) {
    const key = characterIndex == null ? 'global' : `character-${characterIndex}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        label: characterIndex == null ? '全局提示词' : `角色 ${characterIndex + 1}`,
        status: 'changed',
        fields: [],
      }
      if (characterIndex != null && before && after) {
        if (!before.characters[characterIndex]) {
          group.status = 'added'
        } else if (!after.characters[characterIndex]) {
          group.status = 'removed'
        }
      }
      groups.set(key, group)
    }
    return group
  }
  changes.forEach((change, sourceIndex) => {
    const position =
      change.before === '' && change.after === '' && change.reason.startsWith('位置：')
    if (position && before && after) {
      return // Snapshot positions take precedence over human-readable change reasons.
    }
    if (change.before === change.after && !position) {
      return
    }
    const group = groupFor(
      change.field === 'base' || change.field === 'negative' ? undefined : change.characterIndex,
    )
    if (!before || !after) {
      if (change.reason === '新增角色') {
        group.status = 'added'
      } else if (change.reason === '移除角色') {
        group.status = 'removed'
      }
    }
    const positionValues = position ? change.reason.slice(3).split(' → ') : []
    group.fields.push({
      key: `${change.field}-${sourceIndex}`,
      label: position ? '位置' : fieldLabel(change.field),
      before: position ? positionValues[0] : change.before,
      after: position ? (positionValues[1] ?? '自动') : change.after,
      reason: position || ['新增角色', '移除角色'].includes(change.reason) ? '' : change.reason,
      kind: position ? 'position' : 'prompt',
      sourceIndex,
    })
  })
  if (before && after) {
    for (
      let index = 0;
      index < Math.max(before.characters.length, after.characters.length);
      index++
    ) {
      const previous = before.characters[index]
      const next = after.characters[index]
      if (!previous || !next || (previous.position || '') !== (next.position || '')) {
        const group = groupFor(index)
        if ((previous?.position || '') !== (next?.position || '')) {
          group.fields.push({
            key: 'position',
            label: '位置',
            before: previous ? previous.position || '自动' : '无',
            after: next ? next.position || '自动' : '无',
            reason: '',
            kind: 'position',
          })
        }
      }
    }
  }
  return [...groups.values()].sort((left, right) => {
    const order = (group: ReviewGroup) =>
      group.key === 'global' ? -1 : Number(group.key.slice('character-'.length))
    return order(left) - order(right)
  })
}

function fieldLabel(field: InpaintChange['field']) {
  if (field === 'base') {
    return '主提示词'
  }
  if (field === 'negative') {
    return '全局负面词'
  }
  return field === 'character' ? '提示词' : '负面词'
}

export function reviewDrafts(before: InpaintDraft, after: InpaintDraft): ReviewGroup[] {
  const changes: InpaintChange[] = []
  for (const field of ['base', 'negative'] as const) {
    changes.push({ field, before: before[field], after: after[field], reason: '' })
  }
  for (
    let index = 0;
    index < Math.max(before.characters.length, after.characters.length);
    index++
  ) {
    for (const [key, field] of [
      ['prompt', 'character'],
      ['negative', 'characterNegative'],
    ] as const) {
      changes.push({
        field,
        characterIndex: index,
        before: before.characters[index]?.[key] ?? '',
        after: after.characters[index]?.[key] ?? '',
        reason: '',
      })
    }
  }
  return reviewChanges(changes, before, after)
}
