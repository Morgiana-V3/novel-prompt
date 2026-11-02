<script setup lang="ts">
import { computed } from 'vue'
import type { AdoptionChange } from '../partial-adoption'
import AiChangePicker from './AiChangePicker.vue'
const props = defineProps<{ changes: AdoptionChange[]; selected: Set<string> }>()
defineEmits<{ toggle: [id: string]; toggleMany: [ids: string[]] }>()
const adopted = computed(
  () => props.changes.length > 0 && props.changes.every((c) => props.selected.has(c.id)),
)
// Keep prose rewrites atomic in the primary action. Only offer small independent tag patches.
const local = computed(() =>
  props.changes.filter(
    (c) =>
      c.kind === 'text' &&
      c.field !== 'position' &&
      c.before.length + c.after.length <= 180 &&
      !/[.!?。！？]\s/.test(c.before + c.after),
  ),
)
const label = computed(() => {
  const change = props.changes[0]
  if (change?.kind === 'structure') {
    return '整组角色'
  }
  if (change?.kind === 'add') {
    return '新增角色'
  }
  if (change?.kind === 'remove') {
    return '移除角色'
  }
  return change?.field === 'position' ? '位置调整' : '整段修改'
})
</script>
<template>
  <div
    v-if="changes.length"
    class="field-adoption"
  >
    <button
      class="btn small field-adopt"
      :class="{ adopted }"
      :aria-pressed="adopted"
      :aria-label="`${adopted ? '取消采纳' : '采纳'}${label}`"
      :title="adopted ? '点击取消采纳' : '点击采纳到编辑区'"
      @click="
        $emit(
          'toggleMany',
          changes.map((c) => c.id),
        )
      "
    >
      {{ label }}
    </button>
    <div
      v-if="local.length > 1 || (local.length && local.length < changes.length)"
      class="local-adoption"
    >
      <AiChangePicker
        :changes="local"
        :selected="selected"
        compact
        @toggle="$emit('toggle', $event)"
      />
    </div>
  </div>
</template>
<style scoped>
.field-adoption {
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  display: flex;
  align-items: start;
  flex-wrap: wrap;
  gap: 10px;
}

.field-adopt {
  flex-shrink: 0;
}

.field-adopt.adopted {
  color: var(--ok);
  border-color: var(--ok);
  background: var(--ok-soft);
}

.local-adoption {
  flex: 1;
  min-width: 150px;
  font-size: 12px;
}

.local-adoption :deep(.compact) {
  border: 0;
  padding: 0;
}
</style>
