<script setup lang="ts">
import { enterImagePreview } from './image-preview-state'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import ImageViewport from './ImageViewport.vue'
import Icon from './Icon.vue'

const props = defineProps<{
  image: NaiImage
  canPrevious: boolean
  canNext: boolean
  canDelete?: boolean
  confirmDelete?: boolean
  deleting?: boolean
}>()
const emit = defineEmits<{ close: []; previous: []; next: []; delete: [] }>()
const opened = ref(true)
const zoom = ref(100)
const width = ref(props.image.width || 0)
const height = ref(props.image.height || 0)
const failed = ref(false)
const viewport = ref<InstanceType<typeof ImageViewport>>()
const dialog = ref<HTMLElement>()
const previousFocus = document.activeElement as HTMLElement | null
let leavePreview: (() => void) | undefined
let dismissPointer: { id: number; x: number; y: number } | undefined
function isBackdrop(event: PointerEvent) {
  const target = document.elementFromPoint(event.clientX, event.clientY)
  return (
    !!target && !!dialog.value?.contains(target) && !target.closest('.iv-toolbar, .image-stage')
  )
}
function startDismiss(event: PointerEvent) {
  dismissPointer = undefined
  if (event.button === 0 && event.isPrimary && isBackdrop(event)) {
    dismissPointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
}
function moveDismiss(event: PointerEvent) {
  if (
    dismissPointer &&
    Math.hypot(event.clientX - dismissPointer.x, event.clientY - dismissPointer.y) > 5
  ) {
    dismissPointer = undefined
  }
}
function finishDismiss(event: PointerEvent) {
  moveDismiss(event)
  if (dismissPointer?.id === event.pointerId && isBackdrop(event)) {
    close()
  }
  dismissPointer = undefined
}
const close = () => {
  opened.value = false
}
watch(
  () => props.image.url,
  async () => {
    width.value = props.image.width || 0
    height.value = props.image.height || 0
    failed.value = false
    await nextTick()
    viewport.value?.reset()
    if (!dialog.value?.contains(document.activeElement)) {
      dialog.value?.focus({ preventScroll: true })
    }
  },
)
function loaded(event2: Event) {
  const image = event2.target as HTMLImageElement
  width.value = image.naturalWidth
  height.value = image.naturalHeight
}
function key(event2: KeyboardEvent) {
  if (!opened.value) {
    return
  }
  if (
    event2.key === 'Delete' &&
    !event2.repeat &&
    !event2.isComposing &&
    !event2.ctrlKey &&
    !event2.metaKey &&
    !event2.altKey &&
    !event2.shiftKey &&
    props.canDelete &&
    !props.deleting &&
    dialog.value?.contains(event2.target as Node)
  ) {
    event2.preventDefault()
    emit('delete')
  }
  if (event2.key === 'Escape') {
    close()
  }
  if (event2.key === 'ArrowLeft' && props.canPrevious) {
    event2.preventDefault()
    emit('previous')
  }
  if (event2.key === 'ArrowRight' && props.canNext) {
    event2.preventDefault()
    emit('next')
  }
  if (event2.key === 'Tab' && dialog.value) {
    const controls = [
      ...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'),
    ]
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (
      event2.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialog.value ||
        !dialog.value.contains(document.activeElement))
    ) {
      event2.preventDefault()
      last?.focus()
    } else if (
      !event2.shiftKey &&
      (document.activeElement === last || !dialog.value.contains(document.activeElement))
    ) {
      event2.preventDefault()
      first?.focus()
    }
  }
}
onMounted(() => {
  leavePreview = enterImagePreview()
  window.addEventListener('keydown', key)
  dialog.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  leavePreview?.()
  window.removeEventListener('keydown', key)
  if (previousFocus?.isConnected) {
    previousFocus.focus()
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition
      name="modal"
      appear
      @after-leave="emit('close')"
    >
      <div
        v-if="opened"
        ref="dialog"
        class="image-viewer"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        aria-label="图片查看器"
        @pointerdown.capture="startDismiss"
        @pointermove.capture="moveDismiss"
        @pointerup.capture="finishDismiss"
        @pointercancel.capture="dismissPointer = undefined"
      >
        <div class="iv-toolbar modal-panel">
          <button
            class="icon-btn sm"
            title="上一张（←）"
            :disabled="!canPrevious"
            @click="emit('previous')"
          >
            ←
          </button>
          <button
            class="icon-btn sm"
            title="下一张（→）"
            :disabled="!canNext"
            @click="emit('next')"
          >
            →
          </button>
          <span
            class="iv-name"
            :title="image.name"
            >{{ image.name }}</span
          >
          <button
            class="icon-btn sm"
            title="缩小"
            :disabled="zoom <= 25"
            @click="viewport?.zoomTo(zoom / 1.25)"
          >
            −
          </button>
          <span class="iv-zoom">{{ zoom }}%</span>
          <button
            class="icon-btn sm"
            title="放大"
            :disabled="zoom >= 1600"
            @click="viewport?.zoomTo(zoom * 1.25)"
          >
            +
          </button>
          <button
            class="btn ghost small"
            @click="viewport?.reset()"
          >
            适应窗口
          </button>
          <button
            v-if="canDelete !== undefined"
            class="btn small iv-delete"
            :class="{ 'danger-confirm': confirmDelete }"
            :disabled="deleting || !canDelete"
            :title="canDelete ? '删除图片（Delete，移到回收站）' : '工作台引用中，无法从图库删除'"
            @click="emit('delete')"
          >
            <Icon
              name="trash"
              :size="14"
            />{{ deleting ? '删除中…' : confirmDelete ? '确认删除' : '删除图片' }}
          </button>
          <button
            class="icon-btn sm"
            title="关闭图片预览（Esc）"
            aria-label="关闭图片预览"
            @click="close"
          >
            <Icon
              name="x"
              :size="17"
            />
          </button>
        </div>
        <ImageViewport
          ref="viewport"
          v-model:zoom="zoom"
          class="iv-canvas"
          :width="width"
          :height="height"
          label="图片查看画布"
        >
          <img
            v-if="!failed"
            :key="image.url"
            :src="image.url"
            :alt="image.name"
            draggable="false"
            @load="loaded"
            @error="failed = true"
          />
        </ImageViewport>
        <div
          v-if="failed"
          class="iv-error"
          role="alert"
        >
          图片加载失败，请关闭后重新选择。
        </div>
        <div class="iv-hint">
          滚轮缩放 · 拖动移动 · 空格 / 中键也可拖动 · ← → 切换<span v-if="canDelete">
            · {{ confirmDelete ? '再按 Delete 确认删除' : 'Delete 删除' }}</span
          ><span v-else-if="canDelete === false"> · 工作台引用中，无法从图库删除</span> · 点击空白或
          Esc 返回
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 300;
  -webkit-app-region: no-drag;
  padding: calc(var(--titlebar-safe-height) + 16px) 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgb(16 16 20 / 86%);
  backdrop-filter: blur(4px);
}

.iv-toolbar {
  align-self: center;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line2);
  border-radius: 14px;
  background: var(--bg);
  box-shadow: var(--shadow-sm);
}

.iv-name {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text2);
}

.iv-zoom {
  min-width: 50px;
  text-align: center;
  font: 12px var(--mono);
}

.iv-canvas {
  flex: 1;
  border-radius: 10px;
}

.iv-hint {
  text-align: center;
  color: #ffffffa6;
  font-size: 12px;
  padding: 4px;
}

.iv-error {
  position: absolute;
  inset: 45% 0 auto;
  text-align: center;
  color: #fff;
  pointer-events: none;
}
</style>
