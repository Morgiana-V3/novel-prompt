<script setup lang="ts">
import { shellState } from '../../shared/state/shell'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TASK_LABELS, taskIsActive, type AppTask } from '@shared/tasks/model'
import { taskState, trialActivity, cancelTask } from '../../shared/state/tasks'
import { cleanErr } from '../../shared/lib/format'
import { toast } from '../../shared/lib/notifications'
import { type Tab } from '../../shared/state/shell'
import Icon from '../../shared/ui/Icon.vue'
import type { IconName } from '../../shared/ui/icons'

const opened = ref(false)
const root = ref<HTMLElement>()
const panel = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const now = ref(Date.now())
const active = computed(() => taskState.tasks.filter(taskIsActive))
const recent = computed(() => taskState.tasks.filter((task) => !taskIsActive(task)))
const activeCount = computed(
  () =>
    active.value.length +
    (trialActivity.running &&
    !active.value.some((task) => task.kind === 'generate' || task.kind === 'reverse-score')
      ? 1
      : 0),
)
const summary = computed(() => {
  if (trialActivity.running) {
    return trialActivity.message || '正在准备试图…'
  }
  const task = active.value[0]
  return task ? `${task.label || TASK_LABELS[task.kind]} · ${task.message || '正在处理…'}` : ''
})
const triggerLabel = computed(() =>
  activeCount.value ? `${activeCount.value} 个任务进行中，打开任务详情` : '打开任务详情',
)
// Bridge short gaps between queued tasks instead of repeatedly collapsing the control.
const visualCount = ref(activeCount.value)
const lastCount = ref(activeCount.value || 1)
let settleTimer: ReturnType<typeof setTimeout> | undefined
watch(activeCount, (count) => {
  clearTimeout(settleTimer)
  if (count) {
    visualCount.value = count
    lastCount.value = count
  } else {
    settleTimer = setTimeout(() => {
      visualCount.value = 0
    }, 400)
  }
})
const statusText = {
  running: '进行中',
  cancelling: '正在停止',
  completed: '已完成',
  cancelled: '已取消',
  failed: '未完成',
}
const icon = (task: AppTask): IconName => {
  if (task.status === 'failed') {
    return 'warn' as const
  }
  if (task.status === 'completed') {
    return 'check' as const
  }
  if (task.status === 'cancelled') {
    return 'stop' as const
  }
  return 'sparkle' as const
}
function duration(task: AppTask) {
  const seconds = Math.max(0, Math.floor(((task.endedAt ?? now.value) - task.startedAt) / 1000))
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}
function percent(task: AppTask) {
  return task.total && task.total > 0 && task.current !== undefined
    ? Math.max(0, Math.min(100, (task.current / task.total) * 100))
    : null
}
function visit(task: AppTask) {
  const resolveTab = () => {
    if (task.kind.startsWith('reverse-')) {
      return 'reverse' as const
    }
    if (task.kind.startsWith('db-') || task.kind.startsWith('update-')) {
      return 'settings' as const
    }
    if (task.kind.startsWith('page-')) {
      return 'workspace' as const
    }
    if (task.kind === 'optimize') {
      return 'ai' as const
    }
    if (task.kind === 'preview') {
      return 'preview' as const
    }
    if (task.kind === 'agent') {
      return shellState.tab
    }
    return 'generate' as const
  }
  const tab: Tab = resolveTab()
  shellState.tab = tab
  opened.value = false
}
async function clear() {
  try {
    await window.api.tasksClear()
  } catch (error) {
    toast(cleanErr(error))
  }
}
function outside(pointerEvent: PointerEvent) {
  if (
    !root.value?.contains(pointerEvent.target as Node) &&
    !panel.value?.contains(pointerEvent.target as Node)
  ) {
    opened.value = false
  }
}
function key(event2: KeyboardEvent) {
  if (opened.value && event2.key === 'Escape') {
    event2.preventDefault()
    event2.stopPropagation()
    opened.value = false
    trigger.value?.focus()
  }
}
let timer: ReturnType<typeof setInterval>
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', key, true)
})
onBeforeUnmount(() => {
  clearTimeout(settleTimer)
  clearInterval(timer)
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('keydown', key, true)
})
function closePanel() {
  opened.value = false
  trigger.value?.focus()
}
</script>

<template>
  <div
    ref="root"
    class="task-center"
  >
    <span
      class="task-summary"
      role="status"
      :title="summary"
      >{{ summary }}</span
    >
    <button
      ref="trigger"
      class="task-trigger"
      :class="{ working: visualCount, opened }"
      :aria-label="triggerLabel"
      :title="triggerLabel"
      :aria-expanded="opened"
      aria-controls="task-panel"
      @click="opened = !opened"
    >
      <span
        class="task-surface"
        aria-hidden="true"
      >
        <span class="task-glyph">
          <Icon
            name="tasks"
            :size="16"
            class="task-idle-icon"
          />
          <span class="task-loading"><i></i></span>
        </span>
        <span class="task-count">{{ lastCount > 99 ? '99+' : lastCount }}</span>
        <Icon
          name="chevron"
          :size="10"
          class="task-chevron"
        />
      </span>
      <span
        v-if="!activeCount && recent.some((t) => t.status === 'failed')"
        class="task-attention"
        aria-label="有未完成任务"
      ></span>
    </button>
    <Teleport to="body">
      <Transition name="popover">
        <section
          v-if="opened"
          id="task-panel"
          ref="panel"
          class="task-panel"
          aria-label="任务进度"
        >
          <header>
            <div><b>任务</b><span>切换页面，任务继续运行</span></div>
            <button
              class="icon-btn sm"
              aria-label="关闭任务面板"
              @click="closePanel"
            >
              <Icon
                name="x"
                :size="15"
              />
            </button>
          </header>
          <div class="task-list scroll">
            <p
              v-if="trialActivity.running"
              class="task-batch-summary"
            >
              {{ trialActivity.message }}
              <button
                class="task-cancel"
                @click="trialActivity.stop?.()"
              >
                停止试图
              </button>
            </p>
            <div
              v-if="!taskState.tasks.length && !trialActivity.running"
              class="task-empty"
            >
              <Icon
                name="layers"
                :size="30"
              /><b>暂时没有任务</b
              ><span>AI 分析、图片生成与数据更新的进度<br />都会显示在这里。</span>
            </div>
            <template
              v-for="group in [
                { label: '正在进行', tasks: active },
                { label: '最近结束', tasks: recent },
              ]"
              :key="group.label"
            >
              <div
                v-if="group.tasks.length"
                class="task-section"
              >
                <span>{{ group.label }} · {{ group.tasks.length }}</span
                ><button
                  v-if="group.tasks === recent"
                  @click="clear"
                >
                  清除记录
                </button>
              </div>
              <article
                v-for="task in group.tasks"
                :key="task.id"
                class="task-card"
                :class="task.status"
                :data-task-id="task.id"
                :data-kind="task.kind"
              >
                <div class="task-title">
                  <span class="task-icon"
                    ><Icon
                      :name="icon(task)"
                      :size="15"
                      :class="{ 'spin-slow': taskIsActive(task) }" /></span
                  ><button
                    title="返回对应页面"
                    @click="visit(task)"
                  >
                    {{ task.origin === 'agent' ? 'Agent · ' : ''
                    }}{{ task.label || TASK_LABELS[task.kind] }}</button
                  ><span class="task-status">{{ statusText[task.status] }}</span>
                </div>
                <p>{{ task.message }}</p>
                <div
                  v-if="taskIsActive(task)"
                  class="task-meter"
                  :class="{ indeterminate: percent(task) === null }"
                  role="progressbar"
                  :aria-label="TASK_LABELS[task.kind]"
                  :aria-valuenow="percent(task) ?? undefined"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <i :style="percent(task) !== null ? { '--p': percent(task)! / 100 } : {}"></i>
                </div>
                <footer>
                  <span
                    >{{ duration(task)
                    }}<template v-if="percent(task) !== null">
                      · {{ Math.round(percent(task)!) }}%</template
                    ></span
                  ><button
                    v-if="taskIsActive(task) && task.cancelMode !== 'none'"
                    class="task-cancel"
                    :disabled="task.status === 'cancelling'"
                    @click="cancelTask(task.id)"
                  >
                    {{
                      task.status === 'cancelling'
                        ? '正在停止…'
                        : task.cancelMode === 'after-current'
                          ? '本张完成后停止'
                          : '取消任务'
                    }}</button
                  ><button
                    v-else-if="!taskIsActive(task)"
                    class="task-visit"
                    @click="visit(task)"
                  >
                    返回页面
                    <Icon
                      name="arrow"
                      :size="12"
                    />
                  </button>
                </footer>
              </article>
            </template>
          </div>
          <div class="task-footnote">仅保留本次打开期间最近 20 条记录</div>
        </section>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.task-center {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: 0 1 350px;
  min-width: 76px;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

.task-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  color: var(--text2);
  font-size: 11px;
}

.task-count {
  position: absolute;
  right: 17px;
  top: 0;
  width: 24px;
  line-height: 30px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  opacity: 0;
  transform: translateX(6px);
  transition:
    opacity 180ms ease,
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-chevron {
  position: absolute;
  right: 6px;
  top: 10px;
  transform: rotate(90deg);
  opacity: 0;
  transition:
    opacity 180ms ease,
    transform 280ms ease;
}

.working .task-count {
  opacity: 1;
  transform: translateX(0);
  transition-delay: 80ms;
}

.working .task-chevron {
  opacity: 0.45;
  transition-delay: 80ms;
}

.opened .task-chevron {
  transform: rotate(-90deg);
}

.task-trigger:focus-visible {
  outline: 2px solid var(--pink);
  outline-offset: 3px;
}

.task-batch-summary {
  font-size: 12px;
  color: var(--text2);
  overflow-wrap: anywhere;
}

.task-trigger {
  position: relative;
  flex: 0 0 76px;
  width: 76px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 16px;
  font-size: 12px;
  color: var(--text2);
  background: transparent;
}

/* Only this inset surface morphs; the header keeps a stable footprint. */
.task-surface {
  position: absolute;
  right: 0;
  top: 0;
  width: 32px;
  height: 32px;
  overflow: hidden;
  border: 1px solid var(--line2);
  border-radius: 10px;
  background: var(--panel);
  transition:
    width 420ms cubic-bezier(0.22, 1, 0.36, 1),
    border-radius 420ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 200ms ease,
    transform 200ms ease;
}

.task-trigger:hover .task-surface,
.task-trigger.opened .task-surface {
  background: var(--hover);
}

.task-trigger:active .task-surface {
  transform: scale(var(--press));
}

.working .task-surface {
  width: 76px;
  border-radius: 16px;
}

.task-glyph {
  position: absolute;
  left: 7px;
  top: 7px;
  width: 16px;
  height: 16px;
}

.task-idle-icon,
.task-loading {
  position: absolute;
  inset: 0;
  transition:
    opacity 220ms ease,
    transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

.task-loading {
  opacity: 0;
  transform: scale(0.6);
}

.task-loading i {
  display: block;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--line2);
  border-top-color: var(--pink-deep);
  border-right-color: var(--pink-deep);
  border-radius: 50%;
  animation: task-loading-turn 900ms linear infinite;
  animation-play-state: paused;
}

.working .task-loading {
  opacity: 1;
  transform: scale(1);
}

.working .task-loading i {
  animation-play-state: running;
}

.working .task-idle-icon {
  opacity: 0;
  transform: scale(0.6);
}

@keyframes task-loading-turn {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-surface,
  .task-count,
  .task-chevron,
  .task-idle-icon,
  .task-loading {
    transition: none;
  }

  .task-loading i {
    animation: none;
  }
}

.task-attention {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bad);
}

.task-panel {
  position: fixed;
  right: 24px;
  top: max(64px, calc(var(--titlebar-safe-height) + 12px));
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 90px);
  z-index: 210;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line2);
  border-radius: 18px;
  background: var(--bg);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
  transform-origin: top right;
  -webkit-app-region: no-drag;
}

.task-panel header {
  padding: 18px 18px 15px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
}

.task-panel header > div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.task-panel header b {
  font-size: 15px;
}

.task-panel header span {
  font-size: 11px;
  color: var(--muted);
}

.task-list {
  padding: 4px 14px 14px;
  min-height: 0;
}

.task-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 13px 3px 9px;
  font-size: 10px;
  color: var(--muted);
}

.task-section button {
  color: var(--text2);
  transition: color var(--dur-fast) var(--ease-out);
}

.task-section button:hover {
  color: var(--pink-deep);
}

.task-card {
  padding: 13px;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}

.task-card.running,
.task-card.cancelling {
  border-color: var(--pink-line);
  background: var(--bg);
}

.task-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.completed .task-icon {
  color: var(--ok);
  background: var(--ok-soft);
}

.failed .task-icon {
  color: var(--bad);
  background: var(--bad-soft);
}

.cancelled .task-icon {
  color: var(--muted);
  background: var(--hover);
}

.task-title > button {
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  transition: color var(--dur-fast) var(--ease-out);
}

.task-title > button:hover {
  color: var(--pink-deep);
}

.task-status {
  margin-left: auto;
  font-size: 10px;
  color: var(--muted);
}

.running .task-status {
  color: var(--pink-deep);
}

.failed .task-status {
  color: var(--bad);
}

.task-card p {
  font-size: 11px;
  color: var(--text2);
  line-height: 1.65;
  margin: 10px 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  user-select: text;
}

.task-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: var(--muted);
  margin-top: 10px;
}

.task-cancel {
  border: 1px solid var(--line2);
  border-radius: 999px;
  padding: 3px 10px;
  color: var(--text2);
  background: var(--bg);
  font-size: 10.5px;
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.task-cancel:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.task-cancel:hover:not(:disabled) {
  color: var(--bad);
  border-color: var(--bad);
  background: var(--bad-soft);
}

.task-cancel:active:not(:disabled) {
  transform: scale(var(--press-sm));
}

.task-visit {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text2);
}

.task-meter {
  height: 3px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--pink-soft);
}

/* 确定进度用 scaleX 而非 width，避免每次进度更新触发布局 */
.task-meter i {
  display: block;
  height: 100%;
  background: var(--pink);
  transform: scaleX(var(--p, 0));
  transform-origin: left center;
  transition: transform var(--dur-base) var(--ease-out);
}

.task-meter.indeterminate i {
  width: 35%;
  border-radius: 4px;
  transform: none;
  transition: none;
  animation: task-progress 1.8s ease-in-out infinite;
}

.task-footnote {
  padding: 10px 18px;
  border-top: 1px solid var(--line);
  font-size: 10px;
  color: var(--muted);
  background: var(--panel);
}

.task-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 36px 12px;
  color: var(--muted);
}

.task-empty b {
  font-size: 13px;
  color: var(--text2);
}

.task-empty span {
  font-size: 11px;
  line-height: 1.9;
}

@keyframes task-progress {
  from {
    transform: translateX(-110%);
  }

  to {
    transform: translateX(390%);
  }
}
</style>
