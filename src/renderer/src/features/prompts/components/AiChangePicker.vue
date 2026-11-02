<script setup lang="ts">
import type { AdoptionChange } from '../partial-adoption'
import { computed } from 'vue'
const displayText = (text: string) => text.trim()
function action(change: AdoptionChange) {
  if (change.kind !== 'text') {
    return ''
  }
  if (change.description) {
    return {
      add: '新增',
      remove: '删除',
      replace: '替换',
      format: '格式调整',
      reorder: '顺序调整',
    }[change.description.operation]
  }
  if (!change.after) {
    return '移除'
  }
  return change.before ? '替换' : '补充'
}
const props = defineProps<{ changes: AdoptionChange[]; selected: Set<string>; compact?: boolean }>()
const prepared = computed(() =>
  props.changes.map((change) => ({ ...change, ...change.description })),
)
defineEmits<{ toggle: [id: string] }>()
</script>
<template>
  <div
    class="ai-change-picker"
    :class="{ compact }"
  >
    <button
      v-for="change in prepared"
      :key="change.id"
      class="ai-change"
      :class="{ adopted: selected.has(change.id) }"
      :aria-pressed="selected.has(change.id)"
      :aria-label="`${selected.has(change.id) ? '取消采纳' : '采纳'}：${change.label} ${change.after || change.before}`"
      :title="selected.has(change.id) ? '点击取消采纳' : '点击采纳到编辑区'"
      :data-change-id="change.id"
      @click="$emit('toggle', change.id)"
    >
      <span class="change-heading"
        ><b
          ><template v-if="!compact">{{ change.group }} · {{ change.label }} · </template
          >{{ action(change) || change.label }}</b
        ></span
      >
      <span
        v-if="!compact && change.context && change.kind === 'text'"
        class="change-context"
        >{{ change.context }}</span
      >
      <span class="change-text"
        ><del v-if="change.before && (!compact || change.kind === 'text')">{{
          displayText(change.before)
        }}</del
        ><span v-if="change.before && change.after && (!compact || change.kind === 'text')">
          → </span
        ><ins v-if="change.after && (!compact || change.kind === 'text')">{{
          displayText(change.after)
        }}</ins></span
      >
    </button>
    <p
      v-if="!changes.length"
      class="muted small"
    >
      提示词没有变化。
    </p>
  </div>
</template>
<style scoped>
.ai-change-picker {
  display: grid;
  gap: 8px;
}

.ai-change {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--line2);
  border-radius: 10px;
  text-align: left;
  background: var(--bg);
  min-width: 0;
}

.ai-change.adopted {
  border-color: var(--ok);
  background: var(--ok-soft);
}

.change-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.change-context {
  font-size: 11px;
  color: var(--text2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.change-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.change-text del {
  color: var(--bad);
}

.change-text ins {
  color: var(--ok);
  text-decoration: none;
}

.compact {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
}

.compact .ai-change {
  gap: 4px;
  padding: 6px 9px;
  border-radius: 6px;
  max-width: 100%;
}

.compact .change-heading {
  font-size: 10px;
}

.compact .change-text {
  font-size: 12px;
}
</style>
