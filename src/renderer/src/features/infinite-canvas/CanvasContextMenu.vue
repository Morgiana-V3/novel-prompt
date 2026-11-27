<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { reportError } from '../../shared/lib/notifications'
import type { CanvasPoint } from './session'

export interface CanvasMenuItem {
  label: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  children?: CanvasMenuItem[]
  run?: () => void | Promise<void>
}

const props = defineProps<{ at: CanvasPoint; groups: CanvasMenuItem[][] }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
const submenu = ref<HTMLElement>()
const children = ref<CanvasMenuItem[]>()
const position = ref(props.at)
const childPosition = ref(props.at)
let trigger: HTMLElement | undefined

function clamp(value: number, extent: number, size: number) {
  return Math.max(4, Math.min(value, extent - size - 4))
}

function positionMenu() {
  if (panel.value) {
    position.value = {
      x: clamp(props.at.x, innerWidth, panel.value.offsetWidth),
      y: clamp(props.at.y, innerHeight, panel.value.offsetHeight),
    }
  }
}

async function showChildren(item: CanvasMenuItem, event: Event, focus = false) {
  trigger = event.currentTarget as HTMLElement
  children.value = item.children
  await nextTick()
  if (!submenu.value || !trigger || !panel.value) {
    return
  }
  const rect = panel.value.getBoundingClientRect()
  const width = submenu.value.offsetWidth
  const x = rect.right + width <= innerWidth - 4 ? rect.right - 1 : rect.left - width + 1
  childPosition.value = {
    x: clamp(x, innerWidth, width),
    y: clamp(trigger.getBoundingClientRect().top - 5, innerHeight, submenu.value.offsetHeight),
  }
  if (focus) {
    submenu.value.querySelector('button')?.focus()
  }
}

function activate(item: CanvasMenuItem, event: Event) {
  if (item.children) {
    void showChildren(item, event, true).catch(reportError)
    return
  }
  if (!item.disabled && item.run) {
    emit('close')
    Promise.resolve().then(item.run).catch(reportError)
  }
}

function close() {
  emit('close')
}

function outside(event: PointerEvent) {
  const target = event.target
  if (
    target instanceof Node &&
    !panel.value?.contains(target) &&
    !submenu.value?.contains(target)
  ) {
    close()
  }
}

function handleKey(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    close()
    if (event.key === 'Escape') {
      event.stopPropagation()
      event.preventDefault()
    }
    return
  }
  if (event.key === 'ArrowLeft' && children.value) {
    trigger?.focus()
    children.value = undefined
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return
  }
  event.preventDefault()
  const menu = submenu.value?.contains(document.activeElement) ? submenu.value : panel.value
  const buttons = Array.from(
    menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
  )
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const step = event.key === 'ArrowDown' ? 1 : -1
  buttons[(index + step + buttons.length) % buttons.length]?.focus()
}

onMounted(() => {
  positionMenu()
  panel.value?.focus()
  window.addEventListener('pointerdown', outside, true)
  window.addEventListener('wheel', close, true)
  window.addEventListener('resize', close)
  window.addEventListener('blur', close)
  window.addEventListener('keydown', handleKey, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('wheel', close, true)
  window.removeEventListener('resize', close)
  window.removeEventListener('blur', close)
  window.removeEventListener('keydown', handleKey, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      class="canvas-menu"
      role="menu"
      aria-label="画布快捷菜单"
      tabindex="-1"
      :style="{ left: position.x + 'px', top: position.y + 'px' }"
      @contextmenu.prevent
    >
      <div
        v-for="(group, index) in groups"
        :key="index"
        class="canvas-menu-group"
        role="group"
      >
        <button
          v-for="item in group"
          :key="item.label"
          role="menuitem"
          type="button"
          :disabled="item.disabled"
          :class="{ danger: item.danger }"
          :aria-haspopup="item.children ? 'menu' : undefined"
          @pointerenter="showChildren(item, $event)"
          @keydown.right.prevent="showChildren(item, $event, true)"
          @click="activate(item, $event)"
        >
          {{ item.label }}
          <span
            v-if="item.children"
            aria-hidden="true"
            >▸</span
          >
          <kbd v-else-if="item.shortcut">{{ item.shortcut }}</kbd>
        </button>
      </div>
    </div>
    <div
      v-if="children"
      ref="submenu"
      class="canvas-menu canvas-submenu"
      role="menu"
      aria-label="新建操作盒"
      :style="{ left: childPosition.x + 'px', top: childPosition.y + 'px' }"
      @contextmenu.prevent
    >
      <button
        v-for="item in children"
        :key="item.label"
        type="button"
        role="menuitem"
        @click="activate(item, $event)"
      >
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.canvas-menu {
  position: fixed;
  z-index: 40;
  width: max-content;
  min-width: 212px;
  max-width: calc(100vw - 8px);
  max-height: calc(100vh - 8px);
  padding: 5px;
  overflow: auto;
  border: 1px solid var(--line2);
  border-radius: 12px;
  outline: none;
  background: var(--bg);
  box-shadow: var(--shadow-pop);
}

.canvas-submenu {
  min-width: 148px;
}

.canvas-menu-group + .canvas-menu-group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--line);
}

.canvas-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 7px;
  color: var(--text);
  font-size: 12px;
  text-align: left;
}

.canvas-menu button:hover:enabled,
.canvas-menu button:focus-visible {
  background: var(--hover);
}

.canvas-menu button.danger {
  color: var(--bad);
}

.canvas-menu kbd,
.canvas-menu button span {
  color: var(--muted);
  font: inherit;
  font-size: 11px;
}

.canvas-menu button:disabled {
  opacity: 0.45;
}
</style>
