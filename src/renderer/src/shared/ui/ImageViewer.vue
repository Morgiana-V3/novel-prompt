<script setup lang="ts">
import { enterImagePreview } from './image-preview-state'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import ImageViewport from './ImageViewport.vue'
import Icon from './Icon.vue'
import { imageLabel } from '../lib/image-label'

const props = defineProps<{
  image: NaiImage
  images?: NaiImage[]
  canPrevious: boolean
  canNext: boolean
  canDelete?: boolean
  confirmDelete?: boolean
  deleting?: boolean
}>()
const emit = defineEmits<{
  close: []
  previous: []
  next: []
  delete: []
  select: [image: NaiImage]
}>()
const opened = ref(true)
const label = computed(() => imageLabel(props.image))
const imageIndex = computed(
  () => props.images?.findIndex((image) => image.url === props.image.url) ?? -1,
)
const thumbnails = computed(() => {
  const list = props.images ?? []
  if (list.length < 2 || imageIndex.value < 0) {
    return []
  }
  const start = Math.max(0, Math.min(imageIndex.value - 4, list.length - 9))
  return list.slice(start, start + 9).map((image, offset) => ({ image, index: start + offset }))
})
const displayed = ref(props.image)
const loading = ref(false)
const direction = ref(1)
let imageRequest = 0
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
    !!target &&
    !!dialog.value?.contains(target) &&
    !target.closest('.iv-toolbar, .image-stage, .iv-step, .iv-filmstrip')
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
  async (url, previousUrl) => {
    const request = ++imageRequest
    const next = props.image
    const previousIndex = props.images?.findIndex((image) => image.url === previousUrl) ?? -1
    direction.value = imageIndex.value >= previousIndex ? 1 : -1
    loading.value = true
    failed.value = false
    // Decode before replacing the visible image, keeping the previous frame on screen.
    const preload = new Image()
    preload.src = url
    try {
      await preload.decode()
      if (request !== imageRequest || !opened.value) {
        return
      }
      width.value = preload.naturalWidth || next.width || 0
      height.value = preload.naturalHeight || next.height || 0
      displayed.value = next
      await nextTick()
      viewport.value?.reset()
      if (!dialog.value?.contains(document.activeElement)) {
        dialog.value?.focus({ preventScroll: true })
      }
    } catch {
      if (request === imageRequest) {
        failed.value = true
      }
    } finally {
      if (request === imageRequest) {
        loading.value = false
      }
    }
  },
)
function loaded(event2: Event) {
  const image = event2.target as HTMLImageElement
  if (image.getAttribute('src') !== displayed.value.url) {
    return
  }
  width.value = image.naturalWidth
  height.value = image.naturalHeight
}
function freezeThumbnail(element: Element) {
  const el = element as HTMLElement
  el.style.left = `${el.offsetLeft}px`
  el.style.top = `${el.offsetTop}px`
  el.style.width = `${el.offsetWidth}px`
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
  imageRequest++
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
        <div class="iv-toolbar">
          <div class="iv-meta">
            <span class="iv-name">{{ label }}</span>
            <span
              v-if="width && height"
              class="iv-dimensions"
              >{{ width }} × {{ height }}</span
            >
            <span
              v-if="imageIndex >= 0"
              class="iv-count"
              >{{ imageIndex + 1 }} / {{ images?.length }}</span
            >
          </div>
          <button
            class="icon-btn sm"
            aria-label="缩小"
            :disabled="zoom <= 25"
            @click="viewport?.zoomTo(zoom / 1.25)"
          >
            −
          </button>
          <span class="iv-zoom">{{ zoom }}%</span>
          <button
            class="icon-btn sm"
            aria-label="放大"
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
            @click="emit('delete')"
          >
            <Icon
              name="trash"
              :size="14"
            />{{ deleting ? '删除中…' : confirmDelete ? '确认删除' : '删除图片' }}
          </button>
          <button
            class="icon-btn sm"
            aria-label="关闭图片预览"
            @click="close"
          >
            <Icon
              name="x"
              :size="17"
            />
          </button>
        </div>
        <div
          class="iv-stage"
          :aria-busy="loading"
          :style="{
            '--iv-enter-offset': `${direction * 22}px`,
            '--iv-leave-offset': `${direction * -14}px`,
          }"
        >
          <Transition name="iv-image">
            <ImageViewport
              v-if="!failed"
              :key="displayed.url"
              ref="viewport"
              v-model:zoom="zoom"
              class="iv-canvas"
              :width="width"
              :height="height"
              label="图片查看画布"
            >
              <img
                :src="displayed.url"
                :alt="imageLabel(displayed)"
                draggable="false"
                @load="loaded"
                @error="failed = true"
              />
            </ImageViewport>
          </Transition>
          <button
            class="iv-step iv-previous"
            aria-label="上一张"
            :aria-disabled="!canPrevious || deleting"
            @click.stop="canPrevious && !deleting && emit('previous')"
          >
            <span class="iv-step-face"
              ><Icon
                name="chevron"
                :size="28"
                :stroke="2"
            /></span>
          </button>
          <button
            class="iv-step iv-next"
            aria-label="下一张"
            :aria-disabled="!canNext || deleting"
            @click.stop="canNext && !deleting && emit('next')"
          >
            <span class="iv-step-face"
              ><Icon
                name="chevron"
                :size="28"
                :stroke="2"
            /></span>
          </button>
        </div>
        <TransitionGroup
          v-if="thumbnails.length"
          name="iv-thumb"
          tag="nav"
          class="iv-filmstrip"
          aria-label="附近图片"
          @before-leave="freezeThumbnail"
        >
          <button
            v-for="item in thumbnails"
            :key="item.image.url"
            class="iv-thumbnail"
            :class="{ active: item.index === imageIndex }"
            :aria-current="item.index === imageIndex ? 'true' : undefined"
            :aria-label="`查看第 ${item.index + 1} 张：${imageLabel(item.image)}`"
            :disabled="deleting"
            @click="emit('select', item.image)"
          >
            <span class="iv-thumb-image"
              ><img
                :src="item.image.url"
                alt=""
                draggable="false"
            /></span>
          </button>
        </TransitionGroup>
        <div
          v-if="failed"
          class="iv-error"
          role="alert"
        >
          图片加载失败，请关闭后重新选择。
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
  padding: calc(var(--titlebar-safe-height) + 2px) 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #f4f4f6;
  background: rgb(20 20 24 / 96%);
  backdrop-filter: blur(6px);
}

.iv-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  flex-shrink: 0;
}

.iv-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1;
  padding-left: 8px;
  color: #ffffffa6;
  font-size: 12px;
}

.iv-name {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.iv-dimensions,
.iv-count {
  white-space: nowrap;
}

.iv-toolbar .btn,
.iv-toolbar .icon-btn {
  color: inherit;
  background: rgb(255 255 255 / 7%);
  border-color: transparent;
  flex-shrink: 0;
}

.iv-toolbar .danger-confirm {
  color: #ffb3c5;
  background: rgb(220 70 100 / 25%);
}

.iv-zoom {
  min-width: 46px;
  text-align: center;
  font: 12px var(--mono);
}

.iv-stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

.image-viewer .iv-canvas {
  position: absolute;
  inset: 0;
  height: 100%;
  border-radius: 0;
  box-shadow: none;
}

.image-viewer .iv-canvas:focus-visible {
  outline: 1px solid #ffffff38;
  outline-offset: -1px;
  box-shadow: none;
}

.iv-image-enter-active {
  transition:
    opacity 280ms ease,
    transform 340ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.iv-image-leave-active {
  pointer-events: none;
  transition:
    opacity 180ms ease,
    transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.iv-image-enter-from {
  opacity: 0;
  transform: translateX(var(--iv-enter-offset)) scale(0.985);
}

.iv-image-leave-to {
  opacity: 0;
  transform: translateX(var(--iv-leave-offset)) scale(0.99);
}

.iv-step {
  position: absolute;
  z-index: 2;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 80px;
  height: 80px;
  padding: 0;
  border: 0;
  color: #fff;
  background: transparent;
  opacity: 0.9;
  transition: opacity 180ms ease;
}

.iv-step-face {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgb(20 20 24 / 36%);
  transition: transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.iv-previous .icon {
  transform: rotate(180deg);
}

.iv-step .icon {
  width: 28px;
  height: 28px;
}

.iv-previous {
  left: 0;
}

.iv-next {
  right: 0;
}

.iv-step:hover:not([aria-disabled='true']),
.iv-step:focus-visible {
  opacity: 1;
}

.iv-previous:hover:not([aria-disabled='true']) .iv-step-face {
  transform: translateX(-3px);
}

.iv-next:hover:not([aria-disabled='true']) .iv-step-face {
  transform: translateX(3px);
}

.iv-step:active:not([aria-disabled='true']) .iv-step-face {
  transform: scale(0.92);
}

.iv-step[aria-disabled='true'] {
  opacity: 0.38;
  cursor: default;
}

.iv-filmstrip {
  --iv-thumb-size: 50px;
  --iv-selected-size: 68px;

  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 88px;
  padding: 8px 2px 12px;
  flex-shrink: 0;
}

.iv-thumbnail {
  position: relative;
  width: var(--iv-thumb-size);
  height: var(--iv-thumb-size);
  min-width: 0;
  flex: 0 1 var(--iv-thumb-size);
  padding: 3px;
  border: 2px solid transparent;
  border-radius: 12px;
  opacity: 0.52;
  background: rgb(255 255 255 / 6%);
  transition:
    width 280ms ease,
    height 280ms ease,
    flex-basis 280ms ease,
    opacity 220ms ease,
    border-color 220ms ease,
    background 220ms ease;
}

.iv-thumb-image {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 7px;
  background: #242428;
  transition:
    transform 260ms cubic-bezier(0.2, 0.7, 0.2, 1),
    box-shadow 220ms ease;
}

.iv-thumbnail:hover {
  opacity: 0.9;
}

.iv-thumbnail:hover .iv-thumb-image {
  transform: scale(1.04);
}

.iv-thumbnail.active {
  width: var(--iv-selected-size);
  height: var(--iv-selected-size);
  flex-basis: var(--iv-selected-size);
  opacity: 1;
  border-color: var(--pink);
  background: rgb(255 255 255 / 10%);
}

.iv-thumbnail.active .iv-thumb-image {
  box-shadow: 0 6px 20px rgb(0 0 0 / 30%);
}

.iv-thumbnail img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.iv-thumb-move {
  transition:
    transform 300ms cubic-bezier(0.2, 0.7, 0.2, 1),
    width 280ms ease,
    height 280ms ease,
    flex-basis 280ms ease,
    opacity 220ms ease;
}

.iv-thumb-enter-active,
.iv-thumb-leave-active {
  transition:
    opacity 220ms ease,
    transform 280ms ease;
}

.iv-thumb-enter-from,
.iv-thumb-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.8);
}

.iv-thumb-leave-active {
  position: absolute;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .iv-image-enter-active,
  .iv-image-leave-active,
  .iv-thumb-move,
  .iv-thumb-enter-active,
  .iv-thumb-leave-active,
  .iv-thumbnail,
  .iv-thumb-image,
  .iv-step,
  .iv-step-face {
    transition: none;
  }
}

.iv-error {
  position: absolute;
  inset: 45% 0 auto;
  text-align: center;
  color: #fff;
  pointer-events: none;
}

@media (width < 760px) {
  .iv-dimensions {
    display: none;
  }

  .iv-meta {
    gap: 8px;
  }

  .iv-name {
    max-width: 140px;
  }
}

@media (height < 650px) {
  .iv-filmstrip {
    --iv-thumb-size: 44px;
    --iv-selected-size: 54px;

    height: 74px;
  }
}
</style>
