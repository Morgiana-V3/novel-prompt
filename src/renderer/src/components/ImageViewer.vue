<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NaiImage } from '@shared/types'
import ImageViewport from './ImageViewport.vue'
import Icon from './Icon.vue'

const props = defineProps<{ image: NaiImage; canPrevious: boolean; canNext: boolean; canDelete?: boolean; confirmDelete?: boolean; deleting?: boolean }>()
const emit = defineEmits<{ close: []; previous: []; next: []; delete: [] }>()
const opened = ref(true)
const zoom = ref(100)
const width = ref(props.image.width || 0)
const height = ref(props.image.height || 0)
const failed = ref(false)
const viewport = ref<InstanceType<typeof ImageViewport>>()
const dialog = ref<HTMLElement>()
const previousFocus = document.activeElement as HTMLElement | null
const close = () => { opened.value = false }
watch(() => props.image.url, async () => {
  width.value = props.image.width || 0
  height.value = props.image.height || 0
  failed.value = false
  await nextTick()
  viewport.value?.reset()
  if (!dialog.value?.contains(document.activeElement)) dialog.value?.focus({ preventScroll: true })
})
function loaded(e: Event) {
  const image = e.target as HTMLImageElement
  width.value = image.naturalWidth
  height.value = image.naturalHeight
}
function key(e: KeyboardEvent) {
  if (!opened.value) return
  if (e.key === 'Delete' && !e.repeat && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && props.canDelete && !props.deleting && dialog.value?.contains(e.target as Node)) { e.preventDefault(); emit('delete') }
  if (e.key === 'Escape') close()
  if (e.key === 'ArrowLeft' && props.canPrevious) { e.preventDefault(); emit('previous') }
  if (e.key === 'ArrowRight' && props.canNext) { e.preventDefault(); emit('next') }
  if (e.key === 'Tab' && dialog.value) {
    const controls = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')]
    const first = controls[0], last = controls[controls.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.value || !dialog.value.contains(document.activeElement))) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && (document.activeElement === last || !dialog.value.contains(document.activeElement))) { e.preventDefault(); first?.focus() }
  }
}
onMounted(() => {
  void window.api.setDarkTitlebar(true)
  window.addEventListener('keydown', key)
  dialog.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  void window.api.setDarkTitlebar(false)
  window.removeEventListener('keydown', key)
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" appear @after-leave="emit('close')">
      <div v-if="opened" class="image-viewer" ref="dialog" tabindex="-1" role="dialog" aria-modal="true" aria-label="图片查看器">
        <div class="iv-toolbar modal-panel">
          <button class="icon-btn sm" title="上一张（←）" :disabled="!canPrevious" @click="emit('previous')">←</button>
          <button class="icon-btn sm" title="下一张（→）" :disabled="!canNext" @click="emit('next')">→</button>
          <span class="iv-name" :title="image.name">{{ image.name }}</span>
          <button class="icon-btn sm" title="缩小" :disabled="zoom <= 25" @click="viewport?.zoomTo(zoom / 1.25)">−</button>
          <span class="iv-zoom">{{ zoom }}%</span>
          <button class="icon-btn sm" title="放大" :disabled="zoom >= 1600" @click="viewport?.zoomTo(zoom * 1.25)">+</button>
          <button class="btn ghost small" @click="viewport?.reset()">适应窗口</button>
          <button v-if="canDelete !== undefined" class="btn small iv-delete" :class="{ 'danger-confirm': confirmDelete }" :disabled="deleting || !canDelete" :title="canDelete ? '删除图片（Delete，移到回收站）' : '工作台引用中，无法从图库删除'" @click="emit('delete')"><Icon name="trash" :size="14" />{{ deleting ? '删除中…' : confirmDelete ? '确认删除' : '删除图片' }}</button>
          <button class="icon-btn sm" title="关闭（Esc）" @click="close"><Icon name="x" :size="17" /></button>
        </div>
        <ImageViewport class="iv-canvas" ref="viewport" :width="width" :height="height" v-model:zoom="zoom" label="图片查看画布">
          <img v-if="!failed" :key="image.url" :src="image.url" :alt="image.name" draggable="false" @load="loaded" @error="failed = true" />
        </ImageViewport>
        <div v-if="failed" class="iv-error" role="alert">图片加载失败，请关闭后重新选择。</div>
        <div class="iv-hint">滚轮缩放 · 拖动移动 · 空格 / 中键也可拖动 · ← → 切换<span v-if="canDelete"> · {{ confirmDelete ? '再按 Delete 确认删除' : 'Delete 删除' }}</span><span v-else-if="canDelete === false"> · 工作台引用中，无法从图库删除</span> · Esc 关闭</div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.image-viewer { position: fixed; inset: 0; z-index: 90; padding: calc(var(--titlebar-safe-height) + 16px) 16px 16px; display: flex; flex-direction: column; gap: 10px; background: rgba(16,16,20,.86); backdrop-filter: blur(4px); }
.iv-toolbar { align-self: center; display: flex; align-items: center; gap: 8px; max-width: 100%; padding: 8px 10px; border: 1px solid var(--line2); border-radius: 14px; background: var(--bg); box-shadow: var(--shadow-sm); }
.iv-name { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text2); }
.iv-zoom { min-width: 50px; text-align: center; font: 12px var(--mono); }
.iv-delete.danger-confirm { background: var(--bad); border-color: var(--bad); color: #fff; }
.iv-canvas { flex: 1; border-radius: 10px; }
.iv-hint { text-align: center; color: #ffffffa6; font-size: 12px; padding: 4px; }
.iv-error { position: absolute; inset: 45% 0 auto; text-align: center; color: #fff; pointer-events: none; }
</style>
