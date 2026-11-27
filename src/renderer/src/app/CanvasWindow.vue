<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CanvasWindowAction } from '@shared/contracts/api'
import InfiniteCanvasView from '../features/infinite-canvas/InfiniteCanvasView.vue'
import { useCanvasProjects } from '../features/infinite-canvas/use-canvas-projects'
import { useCanvasSubscription } from '../features/infinite-canvas/use-canvas-subscription'
import { reportError } from '../shared/lib/notifications'
import { shellState } from '../shared/state/shell'
import AnimatedNumber from '../shared/ui/AnimatedNumber.vue'
import Icon from '../shared/ui/Icon.vue'
import ConfirmDialog from '../shared/ui/ConfirmDialog.vue'
import type { ConfirmationRequest } from '@shared/contracts/confirmation'

const isMac = navigator.userAgent.includes('Macintosh')
const { tabs, activeId, active, create, open, save, close } = useCanvasProjects()
const {
  state: subscriptionState,
  balance,
  freePercent,
  tooltip: quotaTooltip,
  refresh: refreshQuota,
} = useCanvasSubscription()

const confirmations = ref<ConfirmationRequest[]>([])
const confirmation = computed(() => confirmations.value[0])
let offConfirmations: (() => void) | undefined

function replyConfirmation(approved: boolean) {
  if (confirmation.value) {
    void window.canvasApi.replyConfirmation(confirmation.value.id, approved).catch(reportError)
  }
}

const galleryOpen = ref(false)
const tabStrip = ref<HTMLElement>()
const windowMenuOpen = ref(false)
const windowMenuPanel = ref<HTMLElement>()
const windowMenuButton = ref<HTMLButtonElement>()
let windowMenuOpenedByHover = false

const activeHasUnsaved = computed(() => active.value.revision !== active.value.saved)

watch(
  activeId,
  () => {
    const strip = tabStrip.value
    const currentTab = strip?.querySelector<HTMLElement>('.canvas-tab.current')
    if (!strip || !currentTab) {
      return
    }
    const stripBounds = strip.getBoundingClientRect()
    const tabBounds = currentTab.getBoundingClientRect()
    if (tabBounds.left < stripBounds.left) {
      strip.scrollLeft -= stripBounds.left - tabBounds.left + 8
    } else if (tabBounds.right > stripBounds.right) {
      strip.scrollLeft += tabBounds.right - stripBounds.right + 8
    }
  },
  { flush: 'post' },
)

function scrollTabs(event: WheelEvent) {
  const strip = tabStrip.value
  if (!strip || strip.scrollWidth <= strip.clientWidth || !event.deltaY || event.deltaX) {
    return
  }
  event.preventDefault()
  const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 14 : event.deltaY
  strip.scrollBy({ left: delta })
}

function focusClassicWindow() {
  void window.canvasApi.focusClassicWindow().catch(reportError)
}

function openProjectFile() {
  void open().catch(reportError)
}

function saveProjectFile(saveAs = false) {
  void save(saveAs).catch(reportError)
}

function closeProjectTab(tabId: string) {
  void close(tabId).catch(reportError)
}

function toggleMaterials() {
  galleryOpen.value = !galleryOpen.value
}

function refreshAccountQuota() {
  void refreshQuota(true).catch(reportError)
}

function hoverWindowMenu(event: PointerEvent) {
  if (event.pointerType !== 'touch' && !windowMenuOpen.value) {
    windowMenuOpen.value = true
    windowMenuOpenedByHover = true
  }
}

function leaveWindowMenu(event: PointerEvent) {
  if (
    event.pointerType !== 'touch' &&
    windowMenuOpen.value &&
    !windowMenuPanel.value?.contains(document.activeElement)
  ) {
    windowMenuOpen.value = false
    windowMenuOpenedByHover = false
  }
}

function blurWindowMenu(event: FocusEvent) {
  const group = event.currentTarget as HTMLElement
  if (
    windowMenuOpen.value &&
    event.relatedTarget instanceof Node &&
    !group.contains(event.relatedTarget)
  ) {
    windowMenuOpen.value = false
    windowMenuOpenedByHover = false
  }
}

async function activateWindowMenu(event: MouseEvent) {
  if (event instanceof PointerEvent && event.pointerType === 'touch' && windowMenuOpen.value) {
    windowMenuOpen.value = false
    windowMenuOpenedByHover = false
    return
  }
  if (windowMenuOpen.value && windowMenuOpenedByHover) {
    windowMenuOpenedByHover = false
    return
  }
  windowMenuOpenedByHover = false
  windowMenuOpen.value = !windowMenuOpen.value
  if (windowMenuOpen.value && event.detail === 0) {
    await nextTick()
    windowMenuPanel.value?.querySelector('button')?.focus()
  }
}

function closeWindowMenu() {
  windowMenuOpen.value = false
  windowMenuOpenedByHover = false
}

function runWindowAction(action: CanvasWindowAction) {
  windowMenuOpen.value = false
  if (typeof window.canvasApi.canvasWindowAction !== 'function') {
    if (action === 'close') {
      window.close()
    }
    return
  }
  void window.canvasApi.canvasWindowAction(action).catch(reportError)
}

function handleWindowFocus() {
  if (Date.now() - subscriptionState.updatedAt > 60_000) {
    void refreshQuota().catch(reportError)
  }
}

onMounted(() => {
  offConfirmations = window.canvasApi.onConfirmations?.((requests) => {
    confirmations.value = requests
  })
  void refreshQuota().catch(reportError)
  window.addEventListener('focus', handleWindowFocus)
})

onBeforeUnmount(() => {
  offConfirmations?.()
  window.removeEventListener('focus', handleWindowFocus)
})
</script>

<template>
  <main
    class="canvas-window"
    :class="{ 'canvas-window-mac': isMac }"
    @pointerdown="closeWindowMenu"
  >
    <header
      class="canvas-topbar"
      aria-label="画布窗口导航"
    >
      <div class="canvas-topbar-start">
        <button
          class="chrome-btn chrome-back"
          type="button"
          title="切回主窗口"
          aria-label="切回主窗口"
          @click="focusClassicWindow"
        >
          <Icon
            class="chrome-back-icon"
            name="arrow"
            :size="14"
          />
          <span class="chrome-brand-label">主窗口</span>
        </button>

        <button
          class="chrome-btn chrome-materials"
          :class="{ active: galleryOpen }"
          type="button"
          title="打开或收起素材库"
          aria-label="素材库"
          :aria-expanded="galleryOpen"
          @click="toggleMaterials"
        >
          <Icon
            name="album"
            :size="15"
          />
          <span>素材</span>
        </button>

        <div
          class="canvas-tab-bar"
          role="tablist"
          aria-label="打开的画布项目"
        >
          <div
            ref="tabStrip"
            class="canvas-tab-scroll"
            @wheel="scrollTabs"
          >
            <div
              v-for="tab in tabs"
              :key="tab.id"
              class="canvas-tab"
              :class="{ current: activeId === tab.id }"
            >
              <button
                class="canvas-tab-trigger"
                type="button"
                role="tab"
                :aria-selected="activeId === tab.id"
                :title="tab.name"
                @click="activeId = tab.id"
              >
                <span
                  v-if="tab.revision !== tab.saved"
                  class="canvas-tab-dirty"
                  aria-label="未保存"
                />
                <span class="canvas-tab-title">{{ tab.name }}</span>
              </button>
              <button
                class="canvas-tab-close"
                type="button"
                :aria-label="'关闭 ' + tab.name"
                @click="closeProjectTab(tab.id)"
              >
                <Icon
                  name="x"
                  :size="11"
                />
              </button>
            </div>
          </div>
          <button
            class="canvas-tab-add"
            type="button"
            title="新建画布 (Ctrl+N)"
            aria-label="新建画布"
            @click="create"
          >
            <Icon
              name="plus"
              :size="14"
            />
          </button>
        </div>
      </div>

      <div
        class="canvas-drag-area"
        aria-hidden="true"
      />

      <div class="canvas-topbar-end">
        <div
          class="canvas-file-group"
          role="group"
          aria-label="项目文件操作"
        >
          <button
            class="chrome-action"
            type="button"
            title="打开画布项目 (Ctrl+O)"
            @click="openProjectFile"
          >
            <Icon
              name="folder"
              :size="14"
            />
            <span>打开</span>
          </button>
          <span
            class="chrome-divider"
            aria-hidden="true"
          />
          <button
            class="chrome-action"
            :class="{ 'is-dirty': activeHasUnsaved }"
            type="button"
            title="保存当前画布 (Ctrl+S)"
            :disabled="active.saving"
            @click="saveProjectFile(false)"
          >
            <span
              v-if="activeHasUnsaved"
              class="chrome-save-dot"
              aria-hidden="true"
            />
            <span>{{ active.saving ? '保存中…' : '保存' }}</span>
          </button>
          <button
            class="chrome-action chrome-save-as"
            type="button"
            title="另存为新项目 (Ctrl+Shift+S)"
            :disabled="active.saving"
            @click="saveProjectFile(true)"
          >
            <span>另存为</span>
          </button>
        </div>

        <button
          class="canvas-quota-pill"
          type="button"
          :title="quotaTooltip"
          aria-label="Anlas 余额与免费额度"
          :disabled="subscriptionState.loading"
          @click="refreshAccountQuota"
        >
          <Icon
            class="quota-sparkle"
            name="sparkle"
            :size="14"
            :class="{ 'spin-slow': subscriptionState.loading }"
          />
          <span class="quota-anlas">
            <AnimatedNumber
              v-if="balance !== null"
              :value="balance"
            />
            <template v-else>{{ subscriptionState.loading ? '…' : '—' }}</template>
          </span>
          <template v-if="freePercent !== undefined">
            <span
              class="quota-divider"
              aria-hidden="true"
            />
            <span class="quota-free">免费 {{ freePercent }}%</span>
          </template>
        </button>

        <div
          v-if="!isMac"
          class="window-actions"
          @pointerenter="hoverWindowMenu"
          @pointerleave="leaveWindowMenu"
          @pointerdown.stop
          @focusout="blurWindowMenu"
        >
          <button
            ref="windowMenuButton"
            type="button"
            class="chrome-btn chrome-window-trigger"
            :class="{ active: windowMenuOpen }"
            aria-label="窗口操作"
            aria-controls="canvas-window-menu"
            :aria-expanded="windowMenuOpen"
            @click="activateWindowMenu"
          >
            <Icon
              name="more"
              :size="16"
            />
          </button>
          <Transition name="window-menu">
            <div
              v-if="windowMenuOpen"
              class="window-menu-bridge"
            >
              <div
                id="canvas-window-menu"
                ref="windowMenuPanel"
                class="window-menu-panel"
                role="group"
                aria-label="窗口操作"
              >
                <button
                  type="button"
                  @click="runWindowAction('minimize')"
                >
                  最小化
                </button>
                <button
                  type="button"
                  @click="runWindowAction('toggle-maximized')"
                >
                  最大化 / 还原
                </button>
                <button
                  type="button"
                  class="window-menu-danger"
                  @click="runWindowAction('close')"
                >
                  关闭窗口
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <div class="canvas-window-content">
      <InfiniteCanvasView
        :key="active.id"
        v-model:gallery-open="galleryOpen"
        :session="active.session"
        :title="active.name"
        @exit="focusClassicWindow"
      />
    </div>

    <p
      v-if="shellState.toast"
      class="toast"
      role="status"
    >
      {{ shellState.toast }}
    </p>
  </main>
  <ConfirmDialog
    v-if="confirmation"
    :key="confirmation.id"
    :title="confirmation.title"
    :message="
      confirmation.cost
        ? confirmation.message
        : [confirmation.message, confirmation.detail].filter(Boolean).join('\n\n')
    "
    :cost="confirmation.cost"
    :confirm-label="confirmation.confirmLabel"
    @confirm="replyConfirmation(true)"
    @cancel="replyConfirmation(false)"
  />
</template>

<style scoped>
.canvas-window {
  --canvas-chrome-height: 46px;
  --canvas-chrome-fill: color-mix(in srgb, var(--bg) 88%, transparent);
  --canvas-chrome-border: color-mix(in srgb, var(--line2) 86%, transparent);

  position: relative;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--side);
}

.canvas-window-content {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
}

.canvas-topbar {
  position: absolute;
  z-index: 10;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--canvas-chrome-height);
  padding: 6px 12px;
  pointer-events: none;
}

.canvas-window-mac .canvas-topbar {
  padding-left: 84px;
}

.canvas-topbar-start,
.canvas-drag-area,
.canvas-topbar-end {
  pointer-events: auto;
}

.canvas-topbar-start,
.canvas-topbar-end {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.canvas-topbar-start {
  flex: 0 1 auto;
}

.canvas-topbar-end {
  flex: 0 0 auto;
}

.canvas-drag-area {
  flex: 1 0 24px;
  height: 100%;
  -webkit-app-region: drag;
  user-select: none;
}

.chrome-btn,
.canvas-tab-bar,
.canvas-file-group,
.canvas-quota-pill {
  height: 32px;
  border: 1px solid var(--canvas-chrome-border);
  border-radius: 10px;
  background: var(--canvas-chrome-fill);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(12px);
  -webkit-app-region: no-drag;
}

.chrome-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 10px;
  color: var(--text2);
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.chrome-btn:hover {
  background: var(--bg);
  color: var(--text);
}

.chrome-btn:active {
  transform: scale(var(--press-sm));
}

.chrome-btn.active {
  border-color: var(--pink-line);
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.chrome-window-trigger {
  width: 32px;
  padding: 0;
}

.chrome-back-icon {
  transform: rotate(180deg);
}

.canvas-tab-bar {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 2px;
  min-width: 96px;
  max-width: min(40vw, 440px);
  padding: 3px;
}

.canvas-tab-scroll {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow: auto hidden;
  scrollbar-width: none;
}

.canvas-tab-scroll::-webkit-scrollbar {
  display: none;
}

.canvas-tab {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  height: 24px;
  max-width: 170px;
  padding: 0 3px 0 8px;
  border-radius: 7px;
  color: var(--text2);
  font-size: 12px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.canvas-tab:hover {
  background: color-mix(in srgb, var(--hover) 82%, transparent);
  color: var(--text);
}

.canvas-tab.current {
  background: var(--bg);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgb(20 20 30 / 8%);
}

.canvas-tab-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  height: 100%;
  padding-right: 2px;
}

.canvas-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-tab-dirty {
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pink);
}

.canvas-tab-close {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: var(--muted);
  opacity: 0;
  transition:
    opacity var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.canvas-tab:hover .canvas-tab-close,
.canvas-tab.current .canvas-tab-close,
.canvas-tab-close:focus-visible {
  opacity: 1;
}

.canvas-tab-close:hover {
  background: var(--hover);
  color: var(--text);
}

.canvas-tab-add {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--text2);
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.canvas-tab-add:hover {
  background: var(--hover);
  color: var(--text);
}

.canvas-file-group {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  padding: 3px;
}

.chrome-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 7px;
  color: var(--text2);
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.chrome-action:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.chrome-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.chrome-action.is-dirty {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.chrome-action.is-dirty:hover:not(:disabled) {
  background: color-mix(in srgb, var(--pink-soft) 72%, var(--pink-line));
}

.chrome-save-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pink);
}

.chrome-divider {
  width: 1px;
  height: 14px;
  margin: 0 2px;
  background: var(--line2);
}

/* ---------- 右上角积分与免费额度（即梦风格） ---------- */
.canvas-quota-pill {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border-radius: 999px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.canvas-quota-pill:hover:not(:disabled) {
  border-color: var(--pink-line);
  background: var(--bg);
}

.canvas-quota-pill:active:not(:disabled) {
  transform: scale(var(--press-sm));
}

.quota-sparkle {
  color: var(--pink-deep);
}

.quota-divider {
  width: 1px;
  height: 12px;
  background: var(--line2);
}

.quota-free {
  color: var(--ok);
  font-size: 11.5px;
  font-weight: 600;
}

/* ---------- 右上角窗口菜单（Bluepad 风格） ---------- */
.window-actions {
  position: relative;
  flex: 0 0 auto;
}

.window-menu-bridge {
  position: absolute;
  top: 100%;
  right: 0;
  padding-top: 6px;
}

.window-menu-panel {
  display: flex;
  flex-direction: column;
  min-width: 136px;
  padding: 4px;
  border: 1px solid var(--line2);
  border-radius: 11px;
  background: color-mix(in srgb, var(--bg) 96%, transparent);
  box-shadow: var(--shadow-pop);
  backdrop-filter: blur(14px);
}

.window-menu-panel button {
  padding: 7px 11px;
  border-radius: 7px;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.window-menu-panel button:hover {
  background: var(--hover);
}

.window-menu-panel .window-menu-danger {
  color: var(--bad);
}

.window-menu-panel .window-menu-danger:hover {
  background: var(--bad-soft);
}

.window-menu-enter-active,
.window-menu-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.window-menu-enter-from,
.window-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (width <= 960px) {
  .chrome-brand-label,
  .chrome-save-as,
  .quota-free,
  .quota-divider {
    display: none;
  }

  .canvas-tab-bar {
    max-width: min(44vw, 300px);
  }
}
</style>
