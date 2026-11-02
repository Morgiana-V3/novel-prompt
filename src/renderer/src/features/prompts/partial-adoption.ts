import type { InpaintDraft } from '@shared/prompts/types'
import {
  adoptionTextPatches,
  describeTextChange,
  type TextChangeDescription,
} from './adoption-text'
import { alignCharacters } from './character-alignment'
import type { ReviewGroup } from './prompt-review'

export interface AdoptionChange {
  id: string
  group: string
  label: string
  bucket: 'base' | 'negative' | 'characters'
  index?: number
  pairKey?: string
  field?: 'prompt' | 'negative' | 'position'
  kind: 'text' | 'add' | 'remove' | 'structure'
  before: string
  after: string
  start: number
  end: number
  context: string
  description?: TextChangeDescription
}

const clone = (draft: InpaintDraft): InpaintDraft => ({
  base: draft.base,
  negative: draft.negative,
  characters: draft.characters.map((c) => ({
    prompt: c.prompt,
    negative: c.negative ?? '',
    position: c.position ?? '',
  })),
})
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Exact text patches are replayed from the request snapshot, never searched by tag spelling. */
/**
 * 可以单独采纳的小改动：tag 级的替换 / 增删。整句改写保持整段采纳，
 * 拆开反而会拼出不通顺的句子。
 */
export function granularChanges(changes: AdoptionChange[]): AdoptionChange[] {
  return changes.filter(
    (change) =>
      change.kind === 'text' &&
      change.field !== 'position' &&
      change.before.length + change.after.length <= 180 &&
      !/[.!?。！？]\s/.test(change.before + change.after),
  )
}

export function adoptionPlan(original: InpaintDraft, proposal: InpaintDraft) {
  const before = clone(original)
  const after = clone(proposal)
  const changes: AdoptionChange[] = []
  function textChanges(
    old: string,
    next: string,
    meta: Pick<AdoptionChange, 'bucket' | 'group' | 'label' | 'index' | 'field' | 'pairKey'>,
  ) {
    let patches = adoptionTextPatches(old, next)
    if (meta.field === 'position') {
      patches = old === next ? [] : [{ start: 0, before: old, after: next }]
    }
    for (const patch of patches) {
      changes.push({
        ...meta,
        ...patch,
        id: String(changes.length),
        kind: 'text',
        end: patch.start + patch.before.length,
        context: '',
        description:
          meta.field === 'position'
            ? { before: patch.before, after: patch.after, operation: 'replace' }
            : describeTextChange(patch.before, patch.after),
      })
    }
  }

  textChanges(before.base, after.base, { bucket: 'base', group: '全局', label: '主提示词' })
  textChanges(before.negative, after.negative, {
    bucket: 'negative',
    group: '全局',
    label: '负面提示词',
  })
  const pairs = alignCharacters(before.characters, after.characters)
  const review: ReviewGroup[] = []
  for (const [field, label] of [
    ['base', '主提示词'],
    ['negative', '全局负面词'],
  ] as const) {
    if (before[field] !== after[field]) {
      let group = review.find((g) => g.key === 'global')
      if (!group) {
        group = { key: 'global', label: '全局提示词', status: 'changed', fields: [] }
        review.push(group)
      }
      group.fields.push({
        key: field,
        label,
        before: before[field],
        after: after[field],
        kind: 'prompt',
        reason: '',
      })
    }
  }
  const describe = (c: InpaintDraft['characters'][number]) =>
    [c.prompt, c.negative && `负面：${c.negative}`, c.position && `位置：${c.position}`]
      .filter(Boolean)
      .join('\n')
  if (!pairs) {
    const describeList = (draft: InpaintDraft) =>
      draft.characters.map((c, i) => `角色 ${i + 1}\n${describe(c)}`).join('\n\n')
    const old = describeList(before)
    const next = describeList(after)
    changes.push({
      id: String(changes.length),
      bucket: 'characters',
      group: '角色结构',
      pairKey: 'characters',
      label: '整组采纳角色重组',
      kind: 'structure',
      before: old,
      after: next,
      start: 0,
      end: 0,
      context: '',
    })
    review.push({
      key: 'characters',
      label: '角色结构',
      status: 'changed',
      fields: Array.from(
        { length: Math.max(before.characters.length, after.characters.length) },
        (_, i) =>
          (['prompt', 'negative', 'position'] as const).flatMap((field) => {
            const a = before.characters[i]?.[field] || ''
            const b = after.characters[i]?.[field] || ''
            return a === b
              ? []
              : [
                  {
                    key: `role-${i}-${field}`,
                    label: `角色 ${i + 1}${{ prompt: '', negative: ' 负面', position: ' 位置' }[field]}`,
                    before: a,
                    after: b,
                    kind: field === 'position' ? ('position' as const) : ('prompt' as const),
                    reason: '按原顺序展示。角色对应关系不明确，采纳将应用整组角色调整。',
                  },
                ]
          }),
      ).flat(),
    })
  } else {
    for (const [order, pair] of pairs.entries()) {
      const a = pair.before == null ? undefined : before.characters[pair.before]
      const b = pair.after == null ? undefined : after.characters[pair.after]
      const pairKey = `role-${order}`
      const group = a ? `角色 ${pair.before! + 1}` : `新增角色 ${pair.after! + 1}`
      const fields: ReviewGroup['fields'] = []
      if (!a || !b) {
        changes.push({
          id: String(changes.length),
          bucket: 'characters',
          index: order,
          pairKey,
          group,
          label: a ? '删除角色' : '新增角色',
          kind: a ? 'remove' : 'add',
          before: a ? describe(a) : '',
          after: b ? describe(b) : '',
          start: 0,
          end: 0,
          context: '',
        })
      }
      for (const field of ['prompt', 'negative', 'position'] as const) {
        const old = a?.[field] || ''
        const next = b?.[field] || ''
        const label = { prompt: '提示词', negative: '负面词', position: '位置' }[field]
        if (old !== next) {
          fields.push({
            key: field,
            label,
            before: old,
            after: next,
            kind: field === 'position' ? 'position' : 'prompt',
            reason: '',
          })
        }
        if (a && b) {
          textChanges(old, next, {
            bucket: 'characters',
            index: pair.before,
            pairKey,
            field,
            group,
            label,
          })
        }
      }
      if (fields.length || !a || !b) {
        review.push({
          key: pairKey,
          beforeIndex: pair.before ?? undefined,
          afterIndex: pair.after ?? undefined,
          label: group,
          status: (!b ? 'removed' : 'changed') as ReviewGroup['status'],
          fields,
        })
        if (!a) {
          review[review.length - 1].status = 'added'
        }
      }
    }
  }
  function render(selected: ReadonlySet<string>): InpaintDraft {
    const draft = clone(before)
    const patches = changes.filter((change) => change.kind === 'text' && selected.has(change.id))
    for (const patch of patches.sort((a, b) => b.start - a.start || Number(b.id) - Number(a.id))) {
      if (patch.bucket === 'characters') {
        const char = draft.characters[patch.index!]
        const text = char[patch.field!] ?? ''
        char[patch.field!] = text.slice(0, patch.start) + patch.after + text.slice(patch.end)
      } else {
        const text = draft[patch.bucket]
        draft[patch.bucket] = text.slice(0, patch.start) + patch.after + text.slice(patch.end)
      }
    }
    if (!pairs) {
      if (changes.some((c) => c.kind === 'structure' && selected.has(c.id))) {
        draft.characters = clone(after).characters
      }
    } else {
      const originalChars = draft.characters
      draft.characters = pairs.flatMap((pair, order) => {
        const change = changes.find(
          (c) => c.index === order && (c.kind === 'add' || c.kind === 'remove'),
        )
        const adopted = change && selected.has(change.id)
        if (pair.before == null) {
          return adopted ? [{ ...after.characters[pair.after!] }] : []
        }
        if (pair.after == null && adopted) {
          return []
        }
        return [originalChars[pair.before]]
      })
    }
    return draft
  }
  function transition(
    current: InpaintDraft,
    selected: ReadonlySet<string>,
    next: ReadonlySet<string>,
  ) {
    const expected = render(selected)
    const desired = render(next)
    const result = clone(current)
    for (const bucket of ['base', 'negative', 'characters'] as const) {
      if (equal(expected[bucket], desired[bucket])) {
        continue
      }
      if (!equal(clone(current)[bucket], expected[bucket])) {
        return {
          error: `${{ base: '主提示词', negative: '负面提示词', characters: '角色内容或顺序' }[bucket]}已手动修改，请重新优化后再调整这些建议。`,
        }
      }
      if (bucket === 'characters') {
        result.characters = desired.characters
      } else {
        result[bucket] = desired[bucket]
      }
    }
    return { draft: result }
  }
  return { changes, review, render, transition }
}
