import { computed } from 'vue'
import type { InpaintDraft } from '@shared/prompts/types'
import { applyWorkspace, current } from './actions'
import { adoptionPlan } from './partial-adoption'
import { toast } from '../../shared/lib/notifications'
import { tabRef } from '../creation/public/session'

/** scope 区分不同页面；采纳进度跟随生图创作的当前标签 */
export function usePartialAdoption(scope: string) {
  const plan = tabRef<ReturnType<typeof adoptionPlan> | null>(`${scope}.plan`, () => null, {
    shallow: true,
  })
  const selected = tabRef(`${scope}.selected`, () => new Set<string>())
  const changes = computed(() => plan.value?.changes ?? [])
  const all = computed(() => !!changes.value.length && selected.value.size === changes.value.length)
  const stale = computed(() => {
    if (!plan.value) {
      return false
    }
    const expected = plan.value.render(selected.value)
    const draft = current('')
    return (['base', 'negative', 'characters'] as const).some(
      (key) => JSON.stringify(draft[key]) !== JSON.stringify(expected[key]),
    )
  })
  function reset(before?: InpaintDraft, after?: InpaintDraft) {
    selected.value = new Set()
    plan.value = before && after ? adoptionPlan(before, after) : null
  }
  function apply(next: Set<string>) {
    if (!plan.value) {
      return false
    }
    const result = plan.value.transition(current(''), selected.value, next)
    if (!result.draft) {
      toast(result.error)
      return false
    }
    applyWorkspace(
      result.draft,
      next.size > selected.value.size ? '采纳 AI 修改前' : '取消 AI 采纳前',
    )
    selected.value = next
    return true
  }
  function toggle(id: string) {
    const next = new Set(selected.value)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    return apply(next)
  }
  function toggleMany(ids: string[]) {
    const next = new Set(selected.value)
    const remove = ids.every((id) => next.has(id))
    for (const id of ids) {
      if (remove) {
        next.delete(id)
      } else {
        next.add(id)
      }
    }
    return apply(next)
  }
  return {
    changes,
    review: computed(() => plan.value?.review ?? []),
    selected,
    all,
    stale,
    reset,
    toggle,
    toggleMany,
    adoptAll: () => apply(new Set(changes.value.map((c) => c.id))),
    undoAll: () => apply(new Set()),
  }
}
