<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId } from 'vue'
import type { NaiImage } from '@shared/images/types'
import { backdropCloser } from '../../../shared/lib/dialog-motion'
import { cleanErr } from '../../../shared/lib/format'
import { vFadeImg } from '../../../shared/lib/fade-image'
import { vSegIndicator } from '../../../shared/lib/seg-indicator'
import Icon from '../../../shared/ui/Icon.vue'

const props = defineProps<{
  busy: boolean
  disabled: boolean
  error: string
  baseImage?: boolean
}>()
const emit = defineEmits<{ select: [image: NaiImage]; close: [] }>()
const dialog = ref<HTMLDialogElement>()
const titleId = useId()
const images = shallowRef<NaiImage[]>([])
const loading = ref(true)
const loadError = ref('')
const limit = ref(48)
const selected = shallowRef<NaiImage>()
const confirmLabel = computed(() => {
  if (props.busy) {
    return '正在添加…'
  }
  return props.baseImage ? '用作底图' : '添加参考图'
})
const filters = [
  { value: 'all', label: '全部' },
  { value: 'saved', label: '已留存' },
  { value: 'workspace', label: '精修存档' },
  { value: 'temporary', label: '临时' },
] as const
type Source = (typeof filters)[number]['value']
const source = ref<Source>('all')
const list = ref<HTMLElement>()
const filtered = computed(() =>
  source.value === 'all'
    ? images.value
    : images.value.filter((image) => (image.storage ?? 'saved') === source.value),
)
function filterBy(value: Source) {
  source.value = value
  selected.value = filtered.value[0]
  limit.value = 48
  list.value?.scrollTo(0, 0)
}
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    images.value = (await window.api.naiList())
      .filter((image) => !image.missing)
      .sort((a, b) => b.createdAt - a.createdAt)
    selected.value = filtered.value[0]
  } catch (cause) {
    loadError.value = cleanErr(cause)
  } finally {
    loading.value = false
  }
}
function dismiss() {
  if (!props.busy) {
    dialog.value?.close()
  }
}
const backdrop = backdropCloser(dismiss)
onMounted(async () => {
  dialog.value?.showModal()
  await load()
})
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog
    ref="dialog"
    class="gallery-picker"
    :aria-labelledby="titleId"
    aria-modal="true"
    @keydown.stop
    @cancel.prevent="dismiss"
    @pointerdown="backdrop.onPointerdown"
    @click="backdrop.onClick"
    @close="emit('close')"
  >
    <header class="picker-heading">
      <div>
        <Icon
          name="folder"
          :size="18"
        />
        <h2 :id="titleId">{{ baseImage ? '选择图生图底图' : '从图库选择参考图' }}</h2>
      </div>
      <button
        class="icon-btn"
        aria-label="关闭图库"
        :disabled="busy"
        @click="dismiss"
      >
        <Icon
          name="x"
          :size="16"
        />
      </button>
    </header>
    <div class="picker-toolbar">
      <div
        v-seg-indicator
        class="seg picker-filters"
        role="group"
        aria-label="图片来源"
      >
        <button
          v-for="item in filters"
          :key="item.value"
          :class="{ on: source === item.value }"
          :aria-pressed="source === item.value"
          :disabled="busy"
          @click="filterBy(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
      <small v-if="!loading && !loadError">{{ filtered.length }} 张</small>
    </div>
    <div class="picker-body">
      <div
        ref="list"
        class="picker-list scroll"
      >
        <p
          v-if="loading"
          role="status"
        >
          正在读取图库…
        </p>
        <div
          v-else-if="loadError"
          role="alert"
        >
          {{ loadError }}
          <button
            class="btn small"
            @click="load"
          >
            重试
          </button>
        </div>
        <p v-else-if="!filtered.length">这里还没有图片</p>
        <template v-else
          ><div class="picker-grid">
            <button
              v-for="(image, index) in filtered.slice(0, limit)"
              :key="image.name"
              class="picker-tile"
              :aria-label="'预览第 ' + (index + 1) + ' 张图片'"
              :aria-pressed="selected?.name === image.name"
              :disabled="busy"
              @click="selected = image"
            >
              <img
                v-fade-img
                :src="image.url"
                alt=""
                loading="lazy"
              /><span v-if="selected?.name === image.name"
                ><Icon
                  name="check"
                  :size="12"
              /></span>
            </button>
          </div>
          <button
            v-if="filtered.length > limit"
            class="btn small picker-more"
            @click="limit += 48"
          >
            加载更多
          </button>
        </template>
      </div>
      <figure class="picker-preview">
        <template v-if="selected"
          ><img
            :src="selected.url"
            alt="所选图片的完整画面"
          />
          <figcaption>
            <span>所选图片</span
            ><span v-if="selected.width && selected.height"
              >{{ selected.width }} × {{ selected.height }}</span
            >
          </figcaption></template
        >
      </figure>
    </div>
    <footer class="picker-footer">
      <span
        v-if="error"
        role="alert"
        >{{ error }}</span
      ><button
        class="btn small"
        :disabled="busy"
        @click="dismiss"
      >
        取消</button
      ><button
        class="btn primary small"
        :disabled="disabled || !selected"
        @click="selected && emit('select', selected)"
      >
        {{ confirmLabel }}
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.gallery-picker {
  width: min(810px, calc(100vw - 40px));
  height: min(548px, calc(100dvh - 68px));
  max-width: none;
  max-height: none;
  margin: auto;
  padding: 0;
  border: 1px solid var(--line2);
  border-radius: 16px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-modal);
  overflow: hidden;
}

.gallery-picker[open] {
  display: flex;
  flex-direction: column;
}

.gallery-picker::backdrop {
  background: var(--scrim);
}

.picker-heading,
.picker-heading > div,
.picker-toolbar,
.picker-footer,
.picker-filters,
.picker-preview figcaption {
  display: flex;
  align-items: center;
}

.picker-heading,
.picker-toolbar,
.picker-preview figcaption {
  justify-content: space-between;
}

.picker-heading {
  padding: 16px 20px 9px;
}

.picker-heading > div {
  gap: 9px;
}

.picker-heading .icon {
  color: var(--text2);
}

.picker-toolbar {
  padding: 5px 20px 12px;
  gap: 8px;
}

.picker-toolbar small,
.picker-preview figcaption {
  font-size: 11px;
  color: var(--text2);
}

.picker-filters {
  gap: 2px;
}

.picker-filters button {
  padding: 4px 11px;
  font-size: 12px;
}

.picker-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr);
  border-top: 1px solid var(--line);
}

.picker-list {
  overflow: auto;
  min-height: 0;
  padding: 14px 16px 14px 20px;
}

.picker-list p,
.picker-list [role='alert'] {
  font-size: 12px;
  color: var(--text2);
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 92px), 1fr));
  gap: 8px;
}

.picker-tile {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 9px;
  background: var(--hover);
  border: 2px solid transparent;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce),
    box-shadow var(--dur-base) var(--ease-out);
}

.picker-tile img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.picker-tile:hover:not(:disabled) {
  border-color: var(--pink-line);
  transform: translateY(var(--lift-chip));
}

.picker-tile:active:not(:disabled) {
  transform: scale(var(--press-sm));
}

.picker-tile[aria-pressed='true'],
.picker-tile:focus-visible {
  border-color: var(--pink);
}

.picker-tile span {
  position: absolute;
  right: 4px;
  top: 4px;
  display: grid;
  place-items: center;
  background: var(--pink-deep);
  color: white;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  animation: pop var(--dur-base) var(--ease-out);
}

.picker-more {
  display: block;
  margin: 10px auto 0;
}

.picker-preview {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  margin: 0;
  padding: 16px;
  gap: 10px;
  background: var(--panel);
  border-left: 1px solid var(--line);
}

.picker-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.picker-footer {
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
}

.picker-footer [role='alert'] {
  margin-right: auto;
  color: var(--bad);
  font-size: 12px;
}

.picker-footer .btn,
.picker-filters button {
  flex-shrink: 0;
}

.picker-filters button:focus-visible,
.picker-footer button:focus-visible,
.picker-heading button:focus-visible,
.picker-more:focus-visible {
  box-shadow: inset 0 0 0 1px var(--pink-deep);
}

@media (width <= 620px) {
  .picker-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 64px), 1fr));
  }

  .picker-body {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  }

  .picker-list,
  .picker-preview {
    padding: 8px;
  }
}
</style>
