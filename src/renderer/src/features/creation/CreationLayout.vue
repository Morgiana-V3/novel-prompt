<script setup lang="ts">
import { computed, nextTick, provide, ref, watch } from 'vue'
import { pagePresentation } from '../../shared/lib/page-presentation'
import { shellState, type Tab } from '../../shared/state/shell'
import PromptEditor from '../prompts/components/PromptEditor.vue'
import WorkspaceBar from '../prompts/components/WorkspaceBar.vue'
import { resizeWithin } from '../../shared/lib/autosize'
import { promptState } from '../prompts/state'

const props = defineProps<{ active: boolean; panel: string }>()
const emit = defineEmits<{ navigate: [panel: Tab] }>()
const editor = ref<HTMLElement>()
provide(pagePresentation, {
  embedded: computed(() => props.active),
  isActive: (tab) => (props.active ? props.panel === tab : shellState.tab === tab),
  navigate: (tab) => emit('navigate', tab),
  editor: () => (props.active ? editor.value : undefined),
})
const panels = [
  { key: 'compare', label: '词条检查' },
  { key: 'ai', label: '修改建议' },
  { key: 'preview', label: '预期分析' },
  { key: 'generate', label: '出图结果' },
] as const
watch(
  () => [props.active, promptState.characters.length],
  async () => {
    await nextTick()
    if (props.active) {
      resizeWithin(editor.value)
    }
  },
)
</script>

<template>
  <div :class="['creation-layout', { 'creation-active': active }]">
    <section
      v-show="active"
      id="creation-editor"
      ref="editor"
      class="creation-editor scroll"
    >
      <WorkspaceBar />
      <PromptEditor show-presets />
    </section>
    <section class="creation-results">
      <div
        v-show="active"
        class="creation-tabs"
        role="tablist"
        aria-label="创作辅助"
      >
        <button
          v-for="item in panels"
          :id="`creation-tab-${item.key}`"
          :key="item.key"
          role="tab"
          :aria-selected="panel === item.key"
          :aria-controls="`creation-panel-${item.key}`"
          :class="['btn', { primary: panel === item.key }]"
          @click="emit('navigate', item.key)"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="creation-panels"><slot /></div>
    </section>
    <!-- Target is mounted before the slotted generator Teleport resolves on tab entry. -->
    <div
      v-show="active"
      id="creation-generation-controls"
      class="creation-generation-controls"
    ></div>
  </div>
</template>

<style scoped>
.creation-layout,
.creation-results,
.creation-panels {
  display: contents;
}

.creation-active {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(360px, 1.1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
}

.creation-active .creation-editor,
.creation-active .creation-results {
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.creation-editor {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;

  /* 预留了滚动条槽位，右侧扣掉槽宽 */
  padding: 14px calc(16px - var(--scrollbar-size)) 14px 16px;
}

.creation-editor > * {
  flex-shrink: 0;
}

.creation-active .creation-results {
  grid-column: 2;
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--line);
}

.creation-tabs {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
}

.creation-active .creation-panels {
  display: block;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  flex: 1;
}

.creation-generation-controls {
  grid-column: 1;
  grid-row: 2;
  min-width: 0;
  position: relative;
  z-index: 10;
  border-top: 1px solid var(--line);
  background: var(--bg);
}

.creation-active :deep(.view) {
  display: block;
  height: auto;
  min-height: 0;
}

.creation-active :deep(.pane) {
  width: auto;
  min-width: 0;
  overflow: visible;
  border: 0;
}

.creation-active :deep(.pane-body:not(.generation-settings-popover)) {
  overflow: visible;
}

.creation-active :deep(.pane.right) {
  padding: 12px calc(16px - var(--scrollbar-size)) 12px 16px;
  gap: 16px;
}

.creation-active :deep(.empty) {
  min-height: 180px;
}

.creation-active :deep(.empty .mascot) {
  max-height: 96px;
}

@media (width <= 1050px) {
  .creation-active {
    grid-template-columns: minmax(250px, 1fr) minmax(300px, 1.1fr);
  }

  .creation-editor {
    padding: 12px calc(12px - var(--scrollbar-size) / 2) 12px 12px;
  }
}

@media (width <= 760px) {
  .creation-active {
    display: flex;
    flex-direction: column;
    overflow: auto;
  }

  .creation-active .creation-editor,
  .creation-active .creation-results,
  .creation-generation-controls {
    flex-shrink: 0;
    overflow: visible;
    max-height: none;
  }

  .creation-active .creation-results {
    order: 2;
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
</style>
