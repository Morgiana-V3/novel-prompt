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

/**
 * 生图创作的标签栏：每个标签是一份独立的提示词与生图会话。双击改名，中键关闭。
 * 参考 Chrome：标签始终排在一行，等宽，越多越窄（不换行）；当前标签保留最小宽度以显示关闭按钮；
 * 新建时宽度从 0 长出、关闭时收到 0，其余标签随宽度变化同步让位，不做位移和缩放。
 */
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

/* ---------- 增删动画：只改宽度（max-width 从 0 到实际宽度），其余标签由弹性布局自然补位 ---------- */
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function onEnter(el: Element, done: () => void) {
  const node = el as HTMLElement
  if (!node.classList.contains('session-tab') || reduced()) {
    return done()
  }
  const width = node.getBoundingClientRect().width
  node
    .animate(
      [
        { maxWidth: '0px', minWidth: '0px', paddingLeft: '0px', paddingRight: '0px' },
        { maxWidth: `${width}px`, minWidth: '0px' },
      ],
      { duration: 200, easing: EASING },
    )
    .finished.then(done, done)
}

function onLeave(el: Element, done: () => void) {
  const node = el as HTMLElement
  if (!node.classList.contains('session-tab') || reduced()) {
    return done()
  }
  node.classList.add('leaving')
  const width = node.getBoundingClientRect().width
  node
    .animate(
      [
        { maxWidth: `${width}px`, minWidth: '0px' },
        { maxWidth: '0px', minWidth: '0px', paddingLeft: '0px', paddingRight: '0px' },
      ],
      { duration: 180, easing: EASING, fill: 'forwards' },
    )
    .finished.then(done, done)
}
</script>

<template>
  <TransitionGroup
    tag="div"
    class="creation-session-tabs"
    role="tablist"
    aria-label="创作标签"
    :css="false"
    @enter="onEnter"
    @leave="onLeave"
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
        aria-label="关闭标签"
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
      aria-label="新建标签"
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
/* 标签条：浅灰底槽，当前标签是浮起的白色卡片（与侧栏选中项同一语言） */
.creation-session-tabs {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-width: 0;
  padding: 3px;
  border-radius: 11px;
  background: var(--hover);
}

.session-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;

  /* 等宽：空间够时最宽 200px，不够时一起变窄，始终一行 */
  flex: 1 1 0;
  min-width: 0;
  max-width: 200px;
  height: 28px;
  padding: 0 3px 0 10px;
  overflow: hidden;
  container-type: inline-size;
  border-radius: 8px;
  color: var(--text2);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  transition:
    background-color var(--dur-fast) ease,
    color var(--dur-fast) ease,
    box-shadow var(--dur-fast) ease;
}

/* Chrome 式分隔线：未选中的标签之间一条短竖线，挨着当前或悬停的标签时隐藏 */
.session-tab::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 1px;
  background: var(--line2);
  transition: opacity var(--dur-fast) ease;
}

.session-tab:first-child::before,
.session-tab.active::before,
.session-tab:hover::before,
.session-tab.active + .session-tab::before,
.session-tab:hover + .session-tab::before {
  opacity: 0;
}

.session-tab:hover:not(.active) {
  color: var(--text);
  background: color-mix(in srgb, var(--bg) 55%, transparent);
}

.session-tab.active {
  /* 当前标签再挤也留出名字开头和关闭按钮 */
  min-width: 96px;
  color: var(--text);
  background: var(--bg);
  box-shadow: var(--shadow-sm);
  font-weight: 600;
}

.session-tab.leaving {
  pointer-events: none;
}

.session-tab-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-tab-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 4px;
  font-size: 12px;
}

.session-tab-close,
.session-tab-add {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
}

/* 关闭按钮只在当前标签和悬停时出现；隐藏时仍占位，标题不会跳动 */
.session-tab-close {
  width: 18px;
  height: 18px;
  color: var(--muted);
  opacity: 0;
  transition:
    opacity var(--dur-fast) ease,
    background-color var(--dur-fast) ease;
}

.session-tab.active .session-tab-close,
.session-tab:hover .session-tab-close,
.session-tab-close:focus-visible {
  opacity: 1;
}

/* 挤得很窄时（同 Chrome）：未选中标签不再给关闭按钮留位，名字占满 */
@container (width < 76px) {
  .session-tab:not(.active, :hover) .session-tab-close {
    display: none;
  }
}

.session-tab-close:hover {
  color: var(--text);
  background: var(--hover);
}

.session-tab-add {
  width: 28px;
  height: 28px;
  margin-left: 2px;
  color: var(--text2);
  transition: background-color var(--dur-fast) ease;
}

.session-tab-add:hover:not(:disabled) {
  color: var(--text);
  background: color-mix(in srgb, var(--bg) 55%, transparent);
}

.session-tab-add:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
