<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { pagePresentation } from '../../shared/lib/page-presentation'
import { shellState, type Tab } from '../../shared/state/shell'
import { PromptEditor } from '../prompts/public/components'
import { WorkspaceBar } from '../prompts/public/components'
import CreationTabs from './CreationTabs.vue'
import { resizeWithin } from '../../shared/lib/autosize'
import { promptState } from '../prompts/public/draft'
import SplitHandle from '../../shared/ui/SplitHandle.vue'

const props = defineProps<{ active: boolean; panel: string }>()
const emit = defineEmits<{ navigate: [panel: Tab] }>()
const editor = ref<HTMLElement>()
const tabs = ref<HTMLElement>()
const indicator = ref<{ x: number; y: number; width: number }>()
let tabObserver: ResizeObserver | undefined
function updateIndicator() {
  const selected = tabs.value?.querySelector<HTMLElement>('[aria-selected="true"]')
  if (!props.active || !selected?.offsetWidth) {
    indicator.value = undefined
    return
  }
  indicator.value = {
    x: selected.offsetLeft + 10,
    y: selected.offsetTop + selected.offsetHeight - 2,
    width: selected.offsetWidth - 20,
  }
}
onMounted(() => {
  tabObserver = new ResizeObserver(updateIndicator)
  if (tabs.value) {
    tabObserver.observe(tabs.value)
    tabs.value.querySelectorAll('button').forEach((tab) => tabObserver?.observe(tab))
  }
  updateIndicator()
})
onBeforeUnmount(() => tabObserver?.disconnect())
watch(() => [props.active, props.panel], updateIndicator, { flush: 'post' })
provide(pagePresentation, {
  isActive: (tab) => (props.active ? props.panel === tab : shellState.tab === tab),
  navigate: (tab) => emit('navigate', tab),
  editor: () => (props.active ? editor.value : undefined),
})
const panels = [
  { key: 'compare', label: '词条检查' },
  { key: 'ai', label: '智能优化' },
  { key: 'preview', label: '画面推测' },
  { key: 'generate', label: '图片预览' },
] as const
function tabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return
  }
  event.preventDefault()
  const index = panels.findIndex((item) => item.key === props.panel)
  let next = event.key === 'ArrowLeft' ? index - 1 : index + 1
  if (event.key === 'Home') {
    next = 0
  }
  if (event.key === 'End') {
    next = panels.length - 1
  }
  const item = panels[(next + panels.length) % panels.length]
  emit('navigate', item.key)
  document.getElementById(`creation-tab-${item.key}`)?.focus({ preventScroll: true })
}
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
      <CreationTabs />
      <WorkspaceBar />
      <PromptEditor show-presets />
    </section>
    <SplitHandle
      v-show="active"
      class="creation-split"
      storage-key="creation-editor"
      variable="--creation-editor-width"
      :min="280"
      :max="900"
      :reserve="360"
      label="提示词编辑区宽度"
    />
    <section class="creation-results">
      <div
        v-show="active"
        class="creation-toolbar"
      >
        <div
          ref="tabs"
          class="creation-tabs"
          role="tablist"
          aria-label="创作辅助"
          @keydown="tabKey"
        >
          <button
            v-for="item in panels"
            :id="`creation-tab-${item.key}`"
            :key="item.key"
            role="tab"
            :aria-selected="panel === item.key"
            :aria-controls="`creation-panel-${item.key}`"
            class="creation-tab"
            :tabindex="panel === item.key ? 0 : -1"
            @click="emit('navigate', item.key)"
          >
            {{ item.label }}
          </button>
          <span
            v-if="indicator"
            class="creation-tab-indicator"
            aria-hidden="true"
            :style="{
              transform: `translate3d(${indicator.x}px, ${indicator.y}px, 0)`,
              width: `${indicator.width}px`,
            }"
          ></span>
        </div>
        <div
          id="creation-panel-actions"
          class="creation-panel-actions"
        ></div>
      </div>
      <div class="creation-panels"><slot /></div>
    </section>
    <!-- Target is mounted before the slotted generator Teleport resolves on tab entry. -->
    <div
      v-show="active"
      id="creation-generation-controls"
      class="creation-generation-controls"
      data-toast-avoid
    ></div>
  </div>
</template>

<style scoped>
:deep(.creation-action-bar .run-bar),
:deep(.creation-action-bar .run-actions) {
  display: flex;
  align-items: center;
  gap: 6px;
}

:deep(.creation-action-bar .btn) {
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  box-shadow: none;
}

:deep(.creation-action-bar .btn.accent) {
  color: var(--pink-deep);
  border-color: var(--pink-line);
  background: var(--pink-soft);
}

:deep(.creation-action-bar .btn.accent:hover:not(:disabled)) {
  background: color-mix(in srgb, var(--pink) 16%, var(--bg));
}

:deep(.creation-action-bar .icon-btn) {
  width: 28px;
  height: 28px;
  border-radius: 7px;
}

.creation-layout,
.creation-results,
.creation-panels {
  display: contents;
}

.creation-active {
  display: grid;
  grid-template-columns: var(--creation-editor-width, minmax(280px, 0.9fr)) 0 minmax(360px, 1.1fr);
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

.creation-split {
  grid-column: 2;
  grid-row: 1 / 3;
}

.creation-active .creation-results {
  grid-column: 3;
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--line);
}

.creation-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 4px 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}

.creation-tabs {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.creation-tab {
  position: relative;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 7px;
  background: transparent;
  color: var(--text2);
  font-size: 12.5px;
  white-space: nowrap;
  transition:
    color var(--dur-fast) ease,
    background-color var(--dur-fast) ease;
}

.creation-tab:hover {
  background: color-mix(in srgb, var(--pink) 7%, transparent);
  color: var(--pink-deep);
}

.creation-tab[aria-selected='true'] {
  color: var(--pink-deep);
  font-weight: 600;
  background: transparent;
}

.creation-tab-indicator {
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--pink);
  pointer-events: none;
  transition:
    transform var(--dur-slow) var(--ease-glide),
    width var(--dur-slow) var(--ease-glide);
}

@media (prefers-reduced-motion: reduce) {
  .creation-tab,
  .creation-tab-indicator {
    transition: none;
  }
}

.creation-panel-actions {
  margin-left: auto;
}

.creation-panel-actions:empty {
  display: none;
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
    grid-template-columns: var(--creation-editor-width, minmax(250px, 1fr)) 0 minmax(300px, 1.1fr);
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

  .creation-split {
    display: none;
  }

  .creation-active .creation-results {
    order: 2;
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
</style>
