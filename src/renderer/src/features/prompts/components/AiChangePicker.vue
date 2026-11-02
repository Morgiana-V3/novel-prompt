<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AiChange } from '@shared/prompts/types'
import type { AdoptionChange } from '../partial-adoption'
import Icon from '../../../shared/ui/Icon.vue'
import AiExplanations from './AiExplanations.vue'
import AdoptChoice from './AdoptChoice.vue'

const props = defineProps<{
  changes: AdoptionChange[]
  selected: Set<string>
  /** 每条修改匹配到的说明，按修改 id 索引 */
  notes?: Map<string, AiChange[]>
}>()
defineEmits<{ toggle: [id: string] }>()
const opened = ref(new Set<string>())
const OPERATIONS = {
  add: '＋ 新增内容',
  remove: '− 删除内容',
  replace: '替换内容',
  format: '调整格式',
  reorder: '调整顺序',
} as const
function operation(change: AdoptionChange): keyof typeof OPERATIONS {
  if (change.description) {
    return change.description.operation
  }
  if (!change.after) {
    return 'remove'
  }
  return change.before ? 'replace' : 'add'
}
const prepared = computed(() =>
  props.changes.map((change) => {
    const op = operation(change)
    return {
      ...change,
      op,
      opLabel: OPERATIONS[op],
      // 描述里是整理过的 tag 文本（去掉了分隔符和上下文），比原始补丁更好读
      before: (change.description?.before ?? change.before).trim(),
      after: (change.description?.after ?? change.after).trim(),
      notes: props.notes?.get(change.id) ?? [],
    }
  }),
)
function toggleNotes(id: string) {
  const next = new Set(opened.value)
  if (!next.delete(id)) {
    next.add(id)
  }
  opened.value = next
}
</script>
<template>
  <ul
    class="ai-change-list"
    aria-label="可逐条采纳的修改"
  >
    <li
      v-for="(change, index) in prepared"
      :key="change.id"
      :style="{ '--i': Math.min(index, 10) }"
    >
      <AdoptChoice
        class="ai-change"
        :class="{ open: opened.has(change.id) }"
        :data-change-id="change.id"
        :label="change.opLabel"
        :tone="
          change.op === 'add' || change.op === 'remove' || change.op === 'replace'
            ? change.op
            : 'neutral'
        "
        :selected="selected.has(change.id)"
        :description="`${change.label} ${change.after || change.before}`"
        @toggle="$emit('toggle', change.id)"
      >
        <template #meta>
          <button
            v-if="change.notes.length"
            class="change-why"
            :aria-expanded="opened.has(change.id)"
            :title="opened.has(change.id) ? '收起说明' : '查看这条修改的原因'"
            @click.stop="toggleNotes(change.id)"
            @keydown.stop
          >
            说明<Icon
              name="chevron"
              :size="11"
            />
          </button>
        </template>
        <del v-if="change.before">{{ change.before }}</del
        ><span
          v-if="change.before && change.after"
          class="change-arrow"
          aria-hidden="true"
          >→</span
        ><ins v-if="change.after">{{ change.after }}</ins>
        <template #after>
          <div
            v-if="change.notes.length"
            class="change-notes"
            :inert="!opened.has(change.id)"
            @click.stop
          >
            <div>
              <AiExplanations
                :changes="change.notes"
                plain
              />
            </div>
          </div>
        </template>
      </AdoptChoice>
    </li>
  </ul>
</template>
<style scoped>
.ai-change-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-change del {
  color: var(--bad);
  text-decoration-color: color-mix(in srgb, var(--bad) 55%, transparent);
}

.ai-change ins {
  color: var(--ok);
  text-decoration: none;
}

/* 小箭头，和左上角小字同级 */
.change-arrow {
  margin: 0 6px;
  font-size: 11px;
  color: var(--muted);
}

.change-why {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 0 4px;
  border-radius: 5px;
  color: var(--muted);
  font-size: 11px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.change-why:hover,
.open .change-why {
  background: var(--hover);
  color: var(--text);
}

.change-why .icon {
  transform: rotate(90deg);
  transition: transform var(--dur-base) var(--ease-out);
}

.open .change-why .icon {
  transform: rotate(-90deg);
}

.change-notes {
  display: grid;
  grid-template-rows: 0fr;
  cursor: auto;
  transition: grid-template-rows var(--dur-slow) var(--ease-out);
}

.open .change-notes {
  grid-template-rows: 1fr;
}

.change-notes > div {
  min-height: 0;
  overflow: hidden;
}

.change-notes :deep(.inline-explanations) {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
}
</style>
