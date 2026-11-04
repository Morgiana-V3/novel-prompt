<script setup lang="ts">
import { nextTick, ref } from 'vue'
import Icon from '../../shared/ui/Icon.vue'
import {
  closeTab,
  createTab,
  creationTabs,
  MAX_TABS,
  renameTab,
  switchTab,
  tabsLocked,
  tabTitle,
} from './tabs'

/** 生图创作的标签栏：每个标签是一份独立的提示词与生图会话。双击改名，中键关闭 */
const editing = ref<string | null>(null)
const draft = ref('')
const input = ref<HTMLInputElement[]>()

async function startRename(id: string, current: string) {
  editing.value = id
  draft.value = current
  await nextTick()
  input.value?.[0]?.select()
}
function finishRename() {
  if (editing.value) {
    renameTab(editing.value, draft.value)
  }
  editing.value = null
}
function onMiddle(event: MouseEvent, id: string) {
  if (event.button === 1) {
    event.preventDefault()
    closeTab(id)
  }
}
</script>

<template>
  <TransitionGroup
    tag="div"
    name="session-tab"
    class="creation-session-tabs"
    role="tablist"
    aria-label="创作标签"
  >
    <div
      v-for="tab in creationTabs.list"
      :key="tab.id"
      :class="['session-tab', { active: tab.id === creationTabs.activeId }]"
      role="tab"
      :aria-selected="tab.id === creationTabs.activeId"
      :title="
        tabsLocked && tab.id !== creationTabs.activeId ? '任务进行中，完成后再切换' : tabTitle(tab)
      "
      @click="switchTab(tab.id)"
      @dblclick="startRename(tab.id, tab.title || tabTitle(tab))"
      @mousedown="onMiddle($event, tab.id)"
    >
      <input
        v-if="editing === tab.id"
        ref="input"
        v-model="draft"
        class="session-tab-input"
        maxlength="40"
        @click.stop
        @keydown.enter="finishRename"
        @keydown.esc="editing = null"
        @blur="finishRename"
      />
      <span
        v-else
        class="session-tab-title"
        >{{ tabTitle(tab) }}</span
      >
      <button
        v-if="creationTabs.list.length > 1"
        class="session-tab-close"
        title="关闭标签"
        @click.stop="closeTab(tab.id)"
      >
        <Icon
          name="x"
          :size="11"
        />
      </button>
    </div>
    <button
      key="add"
      class="session-tab-add"
      :title="
        creationTabs.list.length >= MAX_TABS
          ? `最多同时打开 ${MAX_TABS} 个标签`
          : '新建标签（全新的提示词与参数）'
      "
      :disabled="creationTabs.list.length >= MAX_TABS"
      @click="createTab()"
    >
      <Icon
        name="plus"
        :size="14"
      />
    </button>
  </TransitionGroup>
</template>

<style scoped>
.creation-session-tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  flex-shrink: 0;
}

.session-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 160px;
  height: 28px;
  padding: 0 4px 0 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    color 160ms ease,
    background-color 160ms ease,
    border-color 160ms ease;
}

.session-tab:hover {
  color: var(--pink-deep);
  background: color-mix(in srgb, var(--pink) 7%, transparent);
}

.session-tab.active {
  color: var(--pink-deep);
  border-color: var(--pink-line);
  background: var(--pink-soft);
  font-weight: 600;
}

/* 激活标签底部的强调线：切换时从中间展开 */
.session-tab::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--pink);
  transform: scaleX(0);
  transition: transform var(--dur-slow) var(--ease-out);
  pointer-events: none;
}

.session-tab.active::after {
  transform: scaleX(1);
}

/* 新建 / 关闭：宽度展开、收起，相邻标签随之平滑补位 */
.session-tab-enter-active,
.session-tab-leave-active {
  overflow: hidden;
  transition:
    max-width var(--dur-slow) var(--ease-out),
    padding var(--dur-slow) var(--ease-out),
    margin var(--dur-slow) var(--ease-out),
    border-width var(--dur-slow) var(--ease-out),
    opacity var(--dur-base) ease;
}

.session-tab-enter-from,
.session-tab-leave-to {
  max-width: 0;
  padding-left: 0;
  padding-right: 0;
  margin-right: -4px;
  border-width: 0;
  opacity: 0;
}

.session-tab-move {
  transition: transform var(--dur-slow) var(--ease-out);
}

.session-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 4px;
}

.session-tab-input {
  width: 110px;
  height: 22px;
  padding: 0 4px;
  font-size: 12px;
}

.session-tab-close,
.session-tab-add {
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  flex-shrink: 0;
}

.session-tab-close {
  width: 18px;
  height: 18px;
  opacity: 0.55;
}

.session-tab-close:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--pink) 14%, transparent);
}

.session-tab-add {
  width: 28px;
  height: 28px;
  color: var(--text2);
}

.session-tab-add:hover:not(:disabled) {
  color: var(--pink-deep);
  background: color-mix(in srgb, var(--pink) 7%, transparent);
}

.session-tab-add:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
