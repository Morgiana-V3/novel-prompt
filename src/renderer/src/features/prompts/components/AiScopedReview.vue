<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReviewField, ReviewGroup } from '../prompt-review'
import type { AiChange } from '@shared/prompts/types'
import { granularChanges, type AdoptionChange } from '../partial-adoption'
import { reviewExplanations } from '../review-explanations'
import Icon from '../../../shared/ui/Icon.vue'
import { vScrollRow } from '../../../shared/lib/scroll-row'
import PromptReview from './PromptReview.vue'
import AiExplanations from './AiExplanations.vue'
import AiChangePicker from './AiChangePicker.vue'
import AdoptChoice from './AdoptChoice.vue'
import PositionCompareDialog, { type RolePosition } from './PositionCompareDialog.vue'

const props = defineProps<{
  groups: ReviewGroup[]
  changes?: AiChange[]
  /** 某段（不传 field 时为整组角色）可采纳的修改 */
  changesFor?: (group: ReviewGroup, field?: ReviewField) => AdoptionChange[]
  selected?: Set<string>
  /** 修改前后所有角色的位置，用于位置对比图 */
  positions?: { before: RolePosition[]; after: RolePosition[] }
  canvas?: { width: number; height: number }
  /** 位置对比的参考底图（当前预览图）与透明度，沿用角色位置编辑器的设置 */
  reference?: { url: string; opacity: number } | null
}>()
const emit = defineEmits<{ toggle: [id: string]; toggleMany: [ids: string[]] }>()
const explanations = computed(() => reviewExplanations(props.groups, props.changes ?? []))
const active = ref('')
const notesOpen = ref(false)
const othersOpen = ref(false)
const comparing = ref(false)

interface ScopeItem {
  key: string
  group: ReviewGroup
  field: ReviewField
}
interface Scope {
  key: string
  label: string
  kind: 'fields' | 'positions'
  group?: ReviewGroup
  items: ScopeItem[]
}
/**
 * 范围按「谁」来分：主提示词、全局负面各一页，每个角色的提示词和负面词合在一页；
 * 所有角色的位置变化单独汇总到「位置变更」，方便对照整体构图。
 */
const scopes = computed<Scope[]>(() => {
  const result: Scope[] = []
  const positions: ScopeItem[] = []
  for (const group of props.groups) {
    const item = (field: ReviewField) => ({ key: `${group.key}/${field.key}`, group, field })
    if (group.key === 'global') {
      for (const field of group.fields) {
        result.push({
          key: item(field).key,
          label: field.label,
          kind: 'fields',
          group,
          items: [item(field)],
        })
      }
      continue
    }
    const fields = group.fields.filter((field) => field.kind !== 'position')
    positions.push(...group.fields.filter((field) => field.kind === 'position').map(item))
    if (fields.length || group.status !== 'changed') {
      result.push({
        key: group.key,
        label: group.label,
        kind: 'fields',
        group,
        items: fields.map(item),
      })
    }
  }
  if (positions.length) {
    result.push({ key: 'positions', label: '位置变更', kind: 'positions', items: positions })
  }
  return result
})
const selectedScope = computed(
  () => scopes.value.find((scope) => scope.key === active.value) ?? scopes.value[0],
)
watch(
  () => props.groups,
  () => {
    active.value = scopes.value[0]?.key || ''
  },
)
watch(active, () => {
  notesOpen.value = false
})

const changesOf = (item: ScopeItem) => props.changesFor?.(item.group, item.field) ?? []
const isAdopted = (ids: string[]) => ids.length > 0 && ids.every((id) => props.selected?.has(id))
/** 每段：能拆成小改动就列出逐条修改；AI 说明能对上具体修改的挂过去，其余归入本段说明 */
const prepared = computed(() =>
  (selectedScope.value?.items ?? []).map((item) => {
    const changes = changesOf(item)
    const local = granularChanges(changes)
    // 只有每一处改动都能单独列出时才展示逐条列表，保证列表和上面的整段对比一一对应；
    // 含整句改写、调序等无法拆开的段落，统一按整段采纳。
    const cards = changes.length > 1 && local.length === changes.length ? local : []
    const byChange = new Map<string, AiChange[]>()
    const rest: AiChange[] = []
    for (const note of explanations.value.byField.get(item.key) ?? []) {
      const haystack = `${note.text} ${note.evidence}`.toLowerCase()
      const card = cards.find((change) =>
        [change.description?.before ?? change.before, change.description?.after ?? change.after]
          .map((text) => text.trim().toLowerCase())
          .some((text) => text.length >= 2 && haystack.includes(text)),
      )
      if (card) {
        byChange.set(card.id, [...(byChange.get(card.id) ?? []), note])
      } else {
        rest.push(note)
      }
    }
    let summary = '随角色整组采纳'
    if (cards.length) {
      summary = `${cards.length} 处修改，可逐条采纳`
    } else if (changes.length === 1) {
      summary = '1 处修改'
    } else if (changes.length) {
      summary = '以整句改写为主，按整段采纳'
    }
    const title =
      item.group.key === 'global' || item.group.key === 'characters'
        ? item.field.label
        : `${item.group.label} · ${item.field.label}`
    return {
      ...item,
      ids: changes.map((change) => change.id),
      cards,
      byChange,
      rest,
      summary,
      title,
    }
  }),
)
const scopeNotes = computed(() => prepared.value.flatMap((item) => item.rest))

function navigateScope(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return
  }
  const buttons = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
  ]
  let index = buttons.indexOf(event.target as HTMLButtonElement)
  if (event.key === 'Home') {
    index = 0
  } else if (event.key === 'End') {
    index = buttons.length - 1
  } else {
    index = (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
  }
  event.preventDefault()
  buttons[index]?.click()
  buttons[index]?.focus()
}
</script>
<template>
  <div class="scoped-review">
    <div
      v-scroll-row
      class="review-scopes"
      role="tablist"
      aria-label="修改范围"
      @keydown="navigateScope"
    >
      <button
        v-for="scope in scopes"
        :key="scope.key"
        role="tab"
        :aria-selected="selectedScope?.key === scope.key"
        :tabindex="selectedScope?.key === scope.key ? 0 : -1"
        :class="{ active: selectedScope?.key === scope.key, positions: scope.kind === 'positions' }"
        @click="active = scope.key"
      >
        <Icon
          v-if="scope.kind === 'positions'"
          name="frame"
          :size="13"
        />{{ scope.label
        }}<span
          v-if="scope.kind === 'positions'"
          class="scope-count"
          >{{ scope.items.length }}</span
        >
      </button>
    </div>

    <div
      v-if="selectedScope"
      :key="selectedScope.key"
      class="scoped-field"
    >
      <slot
        v-if="selectedScope.group"
        name="group-adoption"
        :group="selectedScope.group"
      />

      <template v-if="selectedScope.kind === 'fields'">
        <!-- 每段一张卡：标题 → 整段前后对比（总体方案）→ 逐条修改与原因 -->
        <section
          v-for="item in prepared"
          :key="item.key"
          class="field-card"
          :class="{ adopted: isAdopted(item.ids) }"
        >
          <header class="field-card-title">
            <b>{{ item.title }}</b>
            <span>{{ item.summary }}</span>
            <button
              v-if="item.ids.length"
              class="field-adopt card-adopt"
              :class="{ adopted: isAdopted(item.ids) }"
              :aria-pressed="isAdopted(item.ids)"
              :aria-label="`${isAdopted(item.ids) ? '取消采纳' : '采纳'}${item.title}`"
              :title="isAdopted(item.ids) ? '已写入编辑区，点击撤回' : '采纳整段，写入对应位置'"
              @click="emit('toggleMany', item.ids)"
            >
              <Icon
                name="check"
                :size="13"
              />{{ isAdopted(item.ids) ? '已采纳整段' : '采纳整段' }}
            </button>
          </header>
          <PromptReview
            :groups="[{ ...item.group, fields: [item.field] }]"
            full-context
            flat
          />
          <div
            v-if="item.cards.length"
            class="card-changes"
          >
            <span class="card-changes-title">逐条修改</span>
            <AiChangePicker
              :changes="item.cards"
              :selected="selected ?? new Set()"
              :notes="item.byChange"
              @toggle="emit('toggle', $event)"
            />
          </div>
        </section>
      </template>

      <div
        v-else
        class="position-changes"
      >
        <div class="position-head">
          <span>{{ selectedScope.items.length }} 个角色的位置有变化</span>
          <button
            v-if="positions"
            class="btn small"
            @click="comparing = true"
          >
            <Icon
              name="eye"
              :size="13"
            />查看位置对比
          </button>
        </div>
        <div class="position-list">
          <template
            v-for="(item, index) in prepared"
            :key="item.key"
          >
            <AdoptChoice
              v-if="item.ids.length"
              class="position-row"
              :style="{ '--i': Math.min(index, 10) }"
              :label="item.group.key === 'characters' ? item.field.label : item.group.label"
              tone="neutral"
              :selected="isAdopted(item.ids)"
              :description="`${item.group.label}位置 ${item.field.before || '自动'} 改为 ${item.field.after || '自动'}`"
              @toggle="emit('toggleMany', item.ids)"
            >
              <span class="position-values"
                ><code class="old">{{ item.field.before || '自动' }}</code
                ><span class="position-arrow">→</span
                ><code class="new">{{ item.field.after || '自动' }}</code></span
              >
            </AdoptChoice>
            <div
              v-else
              class="position-row locked"
            >
              <span class="locked-label">{{ item.field.label }} · 随角色整组采纳</span>
              <span class="position-values"
                ><code class="old">{{ item.field.before || '自动' }}</code
                ><span class="position-arrow">→</span
                ><code class="new">{{ item.field.after || '自动' }}</code></span
              >
            </div>
          </template>
        </div>
      </div>

      <div
        v-if="scopeNotes.length"
        class="notes-block"
        :class="{ open: notesOpen }"
      >
        <button
          class="notes-toggle"
          :aria-expanded="notesOpen"
          @click="notesOpen = !notesOpen"
        >
          <Icon
            name="chevron"
            class="notes-caret"
            :size="12"
          />本段说明<span class="notes-count">{{ scopeNotes.length }}</span>
        </button>
        <div
          class="notes-collapse"
          :inert="!notesOpen"
        >
          <div>
            <AiExplanations
              :changes="scopeNotes"
              plain
            />
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="explanations.remaining.length"
      class="notes-block other-explanations"
      :class="{ open: othersOpen }"
    >
      <button
        class="notes-toggle"
        :aria-expanded="othersOpen"
        @click="othersOpen = !othersOpen"
      >
        <Icon
          name="chevron"
          class="notes-caret"
          :size="12"
        />其他建议与说明<span class="notes-count">{{ explanations.remaining.length }}</span>
      </button>
      <div
        class="notes-collapse"
        :inert="!othersOpen"
      >
        <div>
          <AiExplanations
            :changes="explanations.remaining"
            plain
          />
        </div>
      </div>
    </div>

    <PositionCompareDialog
      v-if="comparing && positions"
      :before="positions.before"
      :after="positions.after"
      :width="canvas?.width"
      :reference="reference"
      :height="canvas?.height"
      @close="comparing = false"
    />
  </div>
</template>
<style scoped>
.review-scopes {
  display: flex;
  gap: 6px;
  padding: 12px 0;
}

.review-scopes button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--bg);
  border: 1px solid var(--line2);
  border-radius: 20px;
  padding: 6px 12px;
  color: var(--text2);
  font-size: 12px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.review-scopes button:hover:not(.active) {
  border-color: var(--pink-line);
  color: var(--text);
}

.review-scopes button.active {
  border-color: var(--pink);
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.scope-count {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--line);
  font-size: 10.5px;
  text-align: center;
}

.active .scope-count {
  background: var(--bg);
}

.scoped-field {
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: fade-in var(--dur-base) var(--ease-out);
}

/* 卡片右上角：采纳 / 已采纳，写入或撤回对应字段 */
.card-adopt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px 0 8px;
  border: 1px solid var(--line2);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text2);
  font-size: 12px;
  font-weight: 500;
  transition:
    background-color var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.card-adopt .icon {
  color: var(--muted);
  transition: color var(--dur-base) var(--ease-out);
}

.card-adopt:hover {
  border-color: var(--ok);
  color: var(--ok);
}

.card-adopt:active {
  transform: scale(var(--press-sm));
}

.card-adopt.adopted {
  border-color: var(--ok);
  background: var(--ok);
  color: #fff;
}

.card-adopt.adopted .icon {
  color: #fff;
}

/* 不再层层套卡片：标题是一行文字，只有前后对比保留一个框 */
.field-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-card + .field-card {
  margin-top: 14px;
}

.field-card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
}

.field-card-title b {
  font-size: 13px;
  font-weight: 650;
}

.field-card-title span {
  font-size: 11.5px;
  color: var(--muted);
}

.field-card-title .card-adopt {
  margin-left: auto;
}

.card-changes {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
}

.card-changes-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text2);
}

.position-changes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.position-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--text2);
}

/* 与逐条修改一致：每张卡独占一行 */
.position-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.position-row.locked {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px 12px;
  border: 1px dashed var(--line2);
  border-radius: 10px;
}

.locked-label {
  font-size: 11px;
  color: var(--muted);
}

.position-values {
  display: inline-flex;
  align-items: center;
}

.position-arrow {
  margin: 0 6px;
  font-size: 11px;
  color: var(--muted);
}

.position-values code {
  padding: 2px 7px;
  border-radius: 5px;
  font: 12px var(--mono);
}

.position-values .old {
  background: var(--bad-soft);
  color: var(--bad);
}

.position-values .new {
  background: var(--ok-soft);
  color: var(--ok);
}

.notes-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.other-explanations {
  margin-top: 10px;
}

.notes-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  height: 28px;
  padding: 0 10px 0 6px;
  border-radius: 8px;
  color: var(--text2);
  font-size: 12px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.notes-toggle:hover {
  background: var(--hover);
  color: var(--text);
}

.notes-caret {
  transition: transform var(--dur-base) var(--ease-out);
}

.open > .notes-toggle .notes-caret {
  transform: rotate(90deg);
}

.notes-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--line);
  font-size: 10.5px;
  text-align: center;
}

.notes-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-slow) var(--ease-out);
}

.open > .notes-collapse {
  grid-template-rows: 1fr;
}

.notes-collapse > div {
  min-height: 0;
  overflow: hidden;
}

.notes-collapse :deep(.inline-explanations) {
  padding: 4px 6px 6px 26px;
}
</style>
