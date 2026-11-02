<script setup lang="ts">
import { computed } from 'vue'
import type { AdoptionChange } from '../partial-adoption'
import AdoptChoice from './AdoptChoice.vue'

/** 整个角色层面的改动（新增 / 移除 / 整组重排），与逐条修改用同一种可点卡片 */
const props = defineProps<{ changes: AdoptionChange[]; selected: Set<string> }>()
const emit = defineEmits<{ toggle: [id: string]; toggleMany: [ids: string[]] }>()
const adopted = computed(
  () => props.changes.length > 0 && props.changes.every((c) => props.selected.has(c.id)),
)
const kind = computed(() => props.changes[0]?.kind)
const label = computed(() => {
  if (kind.value === 'structure') {
    return '整组角色'
  }
  if (kind.value === 'add') {
    return '新增角色'
  }
  if (kind.value === 'remove') {
    return '移除角色'
  }
  return props.changes[0]?.field === 'position' ? '位置调整' : '整段修改'
})
const preview = computed(() => {
  const change = props.changes[0]
  return (kind.value === 'remove' ? change?.before : change?.after || change?.before) ?? ''
})
</script>
<template>
  <AdoptChoice
    v-if="changes.length"
    class="field-adopt"
    :label="label"
    :tone="kind === 'add' ? 'add' : kind === 'remove' ? 'remove' : 'neutral'"
    :selected="adopted"
    :description="label"
    @toggle="
      emit(
        'toggleMany',
        changes.map((c) => c.id),
      )
    "
  >
    <p class="role-preview">{{ preview }}</p>
  </AdoptChoice>
</template>
<style scoped>
.role-preview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  white-space: pre-wrap;
  color: var(--text2);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
</style>
