import type { InpaintChange, InpaintDraft } from './types'

export function changeValue(draft: InpaintDraft, change: Pick<InpaintChange, 'field' | 'characterIndex'>): string {
  if (change.field === 'base' || change.field === 'negative') return draft[change.field]
  const c = draft.characters[change.characterIndex ?? -1]
  if (!c) throw new Error('修改指向不存在的角色')
  return (change.field === 'character' ? c.prompt : c.negative) ?? ''
}

/** Exact-field preconditions prevent applying stale AI changes over newer edits. */
export function applyInpaintChanges(draft: InpaintDraft, changes: InpaintChange[]): InpaintDraft {
  const out: InpaintDraft = JSON.parse(JSON.stringify(draft))
  for (const change of changes) {
    if (changeValue(out, change) !== change.before) throw new Error('提示词已改变，请重新分析后采纳')
    if (change.field === 'base' || change.field === 'negative') out[change.field] = change.after
    else out.characters[change.characterIndex!][change.field === 'character' ? 'prompt' : 'negative'] = change.after
  }
  return out
}

export function changeLabel(change: InpaintChange): string {
  return change.field === 'base' ? '主提示词' : change.field === 'negative' ? '负面提示词'
    : `角色 ${(change.characterIndex ?? 0) + 1} · ${change.field === 'character' ? '提示词' : '负面'}`
}
