<script setup lang="ts">
/**
 * 左右分栏的拖拽分隔条。自身宽度为 0，不占布局空间，只把面板宽度写进父元素的 CSS 变量，
 * 由各布局用 var(变量, 默认值) 决定怎么使用；未调整过时完全沿用原有默认布局。
 * 宽度保存在 localStorage，双击或按 Enter 恢复默认，方向键可微调。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const KEY_STEP_PX = 16
const KEY_LARGE_STEP_PX = 64

const props = withDefaults(
  defineProps<{
    /** 持久化键名，同一布局保持稳定 */
    storageKey: string
    /** 写到父元素上的 CSS 变量名 */
    variable: string
    /** 被调整的面板在分隔条之前（start）还是之后（end） */
    side?: 'start' | 'end'
    min: number
    max: number
    /** 另一侧至少保留的宽度 */
    reserve?: number
    label: string
    /** 接收 CSS 变量的祖先选择器；默认是父元素 */
    scope?: string
  }>(),
  { side: 'start', reserve: 320, scope: '' },
)

const handle = ref<HTMLElement>()
/** 实际生效的宽度（已按容器宽度收紧） */
const size = ref<number | null>(null)
/** 用户选择的宽度；窗口变窄时暂时收紧，变宽后恢复 */
let preferred: number | null = null
let observer: ResizeObserver | undefined
const dragging = ref(false)
let dragStartX = 0
let dragStartSize = 0

const storageName = () => `np-split:${props.storageKey}`

function panel(): HTMLElement | null {
  const sibling =
    props.side === 'start' ? handle.value?.previousElementSibling : handle.value?.nextElementSibling
  return sibling instanceof HTMLElement ? sibling : null
}

function upperBound() {
  // 父元素未渲染（display: contents 或隐藏）时宽度为 0，此时不收紧，等可见后再按实际宽度计算
  const parentWidth = handle.value?.parentElement?.clientWidth || Infinity
  return Math.max(props.min, Math.min(props.max, parentWidth - props.reserve))
}

function clamp(value: number) {
  return Math.round(Math.min(upperBound(), Math.max(props.min, value)))
}

function target(): HTMLElement | null {
  if (props.scope) {
    return handle.value?.closest<HTMLElement>(props.scope) ?? null
  }
  return handle.value?.parentElement ?? null
}

function apply(value: number | null) {
  preferred = value
  const effective = value === null ? null : clamp(value)
  size.value = effective
  const element = target()
  if (!element) {
    return
  }
  if (effective === null) {
    element.style.removeProperty(props.variable)
  } else {
    element.style.setProperty(props.variable, `${effective}px`)
  }
}

/**
 * 窗口缩放时按容器宽度收紧/恢复面板：同样不走过渡，
 * 短暂标记 split-settling，样式生效两帧后移除。
 */
let settleFrame = 0
function settle(value: number) {
  const before = size.value
  apply(value)
  if (size.value === before) {
    return
  }
  document.body.classList.add('split-settling')
  cancelAnimationFrame(settleFrame)
  settleFrame = requestAnimationFrame(() => {
    settleFrame = requestAnimationFrame(() => document.body.classList.remove('split-settling'))
  })
}

function save(value: number | null) {
  preferred = value
  if (value === null) {
    localStorage.removeItem(storageName())
    return
  }
  localStorage.setItem(storageName(), String(value))
}

function currentSize() {
  return size.value ?? panel()?.getBoundingClientRect().width ?? props.min
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) {
    return
  }
  event.preventDefault()
  handle.value?.setPointerCapture(event.pointerId)
  dragging.value = true
  dragStartX = event.clientX
  dragStartSize = currentSize()
  document.body.classList.add('split-resizing')
  // 指针捕获在部分情况下收不到 pointerup（如窗口外松开），窗口级监听兜底结束拖拽
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('blur', endDrag)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) {
    return
  }
  const delta = event.clientX - dragStartX
  const next = props.side === 'start' ? dragStartSize + delta : dragStartSize - delta
  apply(clamp(next))
}

function onPointerUp(event: PointerEvent) {
  if (handle.value?.hasPointerCapture(event.pointerId)) {
    handle.value.releasePointerCapture(event.pointerId)
  }
  endDrag()
}

function endDrag() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  window.removeEventListener('blur', endDrag)
  if (!dragging.value) {
    return
  }
  dragging.value = false
  document.body.classList.remove('split-resizing')
  save(size.value)
}

function reset() {
  apply(null)
  save(null)
}

function onKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? KEY_LARGE_STEP_PX : KEY_STEP_PX
  // 方向键按视觉方向移动分隔条，与拖拽一致
  const grow = props.side === 'start' ? 'ArrowRight' : 'ArrowLeft'
  const shrink = props.side === 'start' ? 'ArrowLeft' : 'ArrowRight'
  let next: number | null | undefined
  if (event.key === grow) {
    next = clamp(currentSize() + step)
  } else if (event.key === shrink) {
    next = clamp(currentSize() - step)
  } else if (event.key === 'Home') {
    next = props.min
  } else if (event.key === 'End') {
    next = upperBound()
  } else if (event.key === 'Enter') {
    next = null
  }
  if (next === undefined) {
    return
  }
  event.preventDefault()
  apply(next)
  save(next)
}

onMounted(() => {
  const saved = Number(localStorage.getItem(storageName()))
  if (Number.isFinite(saved) && saved > 0) {
    apply(Math.min(props.max, Math.max(props.min, saved)))
  }
  const parent = handle.value?.parentElement
  if (parent) {
    observer = new ResizeObserver(() => {
      if (preferred !== null && !dragging.value) {
        settle(preferred)
      }
    })
    observer.observe(parent)
  }
})

onBeforeUnmount(() => {
  endDrag()
  observer?.disconnect()
  cancelAnimationFrame(settleFrame)
  document.body.classList.remove('split-settling')
  if (preferred !== null) {
    target()?.style.removeProperty(props.variable)
  }
  document.body.classList.remove('split-resizing')
})
</script>

<template>
  <div
    ref="handle"
    class="split-handle"
    :class="{ dragging }"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="size ?? undefined"
    :title="`拖动调整${label}，双击恢复默认`"
    @pointerdown="onPointerDown"
    @dblclick="reset"
    @keydown="onKeydown"
  ></div>
</template>

<style>
/* 拖拽过程中全局保持列宽光标，并阻止选中文字 */
body.split-resizing {
  cursor: col-resize;
  user-select: none;
}

body.split-resizing iframe,
body.split-resizing img {
  pointer-events: none;
}

/*
 * 拖拽（及窗口缩放时收紧面板）时宽度要实时跟随：暂停所有过渡（侧栏开合的 width、网格列宽等），
 * 否则每一步都会被过渡拖慢成“追着跑”。松手后恢复，开合与双击复位仍有动画。
 * 例外说明：需要 !important，各布局 scoped 的过渡规则权重更高；只在拖拽期间生效。
 */
body.split-resizing *,
body.split-settling * {
  transition: none !important;
}
</style>

<style scoped>
.split-handle {
  position: relative;
  z-index: 5;
  flex: none;
  align-self: stretch;
  width: 0;
  outline: none;
  cursor: col-resize;
  touch-action: none;
}

/* 实际可点击区域：以分隔线为中心左右各 4px */
.split-handle::before {
  content: '';
  position: absolute;
  inset: 0 -4px;
}

/* 悬停/拖拽/聚焦时显示的高亮线，覆盖在原有边框上 */
.split-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -1px;
  width: 2px;
  background: var(--pink);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.split-handle:hover::after,
.split-handle.dragging::after,
.split-handle:focus-visible::after {
  opacity: 1;
}
</style>
