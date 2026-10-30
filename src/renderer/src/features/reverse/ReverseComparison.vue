<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { ReverseTrial } from './use-reverse-trials'
import ReverseTrialInspector from './ReverseTrialInspector.vue'
import ImageViewer from '../../shared/ui/ImageViewer.vue'
import Icon from '../../shared/ui/Icon.vue'

const props = defineProps<{
  referenceUrl: string
  referenceName: string
  styles: string[]
  trials: ReverseTrial[]
  previous: ReverseTrial[]
  running: boolean
  disabled: boolean
  active: boolean
}>()
const emit = defineEmits<{ retry: [trial: ReverseTrial] }>()
const round = ref<'current' | 'previous'>('current')
const selectedIndex = ref(0)
const viewer = ref<NaiImage>()
const imageFailed = ref(false)
const items = computed(() => {
  const current = props.trials.length
    ? props.trials.map((trial) => ({ trial, style: trial.style }))
    : props.styles.map((style) => ({ trial: undefined, style }))
  return [
    ...current.map((item, index) => ({
      ...item,
      index,
      round: 'current',
      key: `current-${index}`,
    })),
    ...props.previous.map((trial, index) => ({
      trial,
      style: trial.style,
      index,
      round: 'previous',
      key: `previous-${index}`,
    })),
  ]
})
const visibleItems = computed(() => items.value.filter((item) => item.round === round.value))
const selected = computed(() => visibleItems.value[selectedIndex.value] ?? visibleItems.value[0])
const completedCount = computed(() => visibleItems.value.filter((item) => item.trial?.image).length)
watch(
  () => props.trials,
  () => {
    round.value = 'current'
    selectedIndex.value = 0
  },
)
watch(
  () => selected.value?.trial?.image?.url,
  () => {
    imageFailed.value = false
  },
)
watch(
  () => props.active,
  (active) => {
    if (!active) {
      viewer.value = undefined
    }
  },
)
function selectRound(value: 'current' | 'previous') {
  round.value = value
  selectedIndex.value = 0
}
function stateLabel(trial?: ReverseTrial) {
  if (trial?.state === 'generating') {
    return '生成中…'
  }
  if (trial?.state === 'scoring') {
    return '比较风格中…'
  }
  if (trial?.image) {
    return '已生成'
  }
  if (trial?.state === 'error') {
    return '生成失败'
  }
  return props.running ? '排队中' : '待生成'
}
function moveSelection(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    return
  }
  event.preventDefault()
  const last = visibleItems.value.length - 1
  if (event.key === 'Home') {
    selectedIndex.value = 0
  } else if (event.key === 'End') {
    selectedIndex.value = last
  } else {
    const direction = event.key === 'ArrowRight' ? 1 : -1
    selectedIndex.value = (selectedIndex.value + direction + last + 1) % (last + 1)
  }
  const strip = event.currentTarget as HTMLElement
  strip.querySelectorAll<HTMLButtonElement>('button')[selectedIndex.value]?.focus()
}
function enlargeReference() {
  if (props.referenceUrl) {
    viewer.value = { name: props.referenceName, url: props.referenceUrl, createdAt: 0 }
  }
}
</script>

<template>
  <section
    class="reverse-comparison"
    aria-label="原图与当前方案对比"
  >
    <div class="comparison-main">
      <div class="comparison-images">
        <figure>
          <figcaption><strong>参考图</strong></figcaption>
          <button
            class="comparison-canvas"
            aria-label="放大参考图"
            @click="enlargeReference"
          >
            <img
              :src="referenceUrl"
              :alt="referenceName || '参考图'"
            />
            <span class="zoom-hint"
              ><Icon
                name="search"
                :size="14"
              />放大查看</span
            >
          </button>
        </figure>
        <figure>
          <figcaption>
            <strong
              >{{ round === 'previous' ? '上一轮 · ' : '' }}方案
              {{ (selected?.index ?? 0) + 1 }}</strong
            >
            <span role="status">{{ stateLabel(selected?.trial) }}</span>
          </figcaption>
          <button
            v-if="selected?.trial?.image && !imageFailed"
            class="comparison-canvas"
            aria-label="放大当前方案"
            @click="viewer = selected.trial.image"
          >
            <img
              :src="selected.trial.image.url"
              :alt="`方案 ${selected.index + 1}`"
              @error="imageFailed = true"
            />
            <span class="zoom-hint"
              ><Icon
                name="search"
                :size="14"
              />放大查看</span
            >
          </button>
          <div
            v-else
            class="comparison-canvas comparison-empty"
            role="status"
          >
            <Icon
              :name="selected?.trial?.state === 'error' ? 'warn' : 'image'"
              :size="32"
            />
            <strong>{{ imageFailed ? '图片无法加载' : stateLabel(selected?.trial) }}</strong>
          </div>
        </figure>
      </div>
      <div class="comparison-filmstrip">
        <div class="filmstrip-heading">
          <div
            class="round-switch"
            aria-label="查看轮次"
          >
            <button
              :class="{ active: round === 'current' }"
              :aria-pressed="round === 'current'"
              @click="selectRound('current')"
            >
              本轮方案
            </button>
            <button
              v-if="previous.length"
              :class="{ active: round === 'previous' }"
              :aria-pressed="round === 'previous'"
              @click="selectRound('previous')"
            >
              上一轮
            </button>
          </div>
          <span>{{ completedCount }} / {{ visibleItems.length }} 已完成</span>
        </div>
        <div
          class="trial-thumbnails"
          aria-label="选择对比方案"
          @keydown="moveSelection"
        >
          <button
            v-for="item in visibleItems"
            :key="item.key"
            class="trial-thumbnail"
            :class="{ selected: selected?.key === item.key }"
            :aria-pressed="selected?.key === item.key"
            :aria-label="`查看${round === 'previous' ? '上一轮' : '本轮'}方案 ${item.index + 1}`"
            @click="selectedIndex = item.index"
          >
            <span class="thumbnail-image">
              <img
                v-if="item.trial?.image"
                :src="item.trial.image.url"
                alt=""
              />
              <span v-else>{{ String(item.index + 1).padStart(2, '0') }}</span>
            </span>
            <span class="thumbnail-info">
              <strong
                >方案 {{ item.index + 1
                }}<Icon
                  v-if="selected?.key === item.key"
                  name="check"
                  :size="12"
              /></strong>
              <small>{{ stateLabel(item.trial) }}</small>
            </span>
          </button>
        </div>
      </div>
    </div>
    <aside
      class="comparison-inspector"
      aria-label="当前方案信息与操作"
    >
      <ReverseTrialInspector
        v-for="item in items"
        v-show="selected?.key === item.key"
        :key="item.key"
        :index="item.index"
        :style-prompt="item.style"
        :trial="item.trial"
        :status="stateLabel(item.trial)"
        :disabled="disabled"
        @retry="item.trial && emit('retry', item.trial)"
      />
    </aside>
    <ImageViewer
      v-if="viewer && active"
      :image="viewer"
      :can-previous="false"
      :can-next="false"
      :can-delete="undefined"
      @close="viewer = undefined"
    />
  </section>
</template>

<style scoped>
.reverse-comparison {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  grid-template-rows: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg);
}

.comparison-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.comparison-images {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

figure {
  display: flex;
  flex-direction: column;
  margin: 0;
  min-width: 0;
  min-height: 0;
}

figure + figure {
  border-left: 1px solid var(--line);
}

figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 44px;
  flex-shrink: 0;
  padding: 0 16px;
  font-size: 12px;
}

figcaption > span {
  color: var(--muted);
  font-size: 11px;
}

.comparison-canvas {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  flex: 1;
  min-height: 0;
  height: 0;
  padding: 18px;
  border: 0;
  background: var(--panel);
  color: var(--text2);
}

button.comparison-canvas {
  cursor: zoom-in;
}

.comparison-canvas > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.zoom-hint {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  opacity: 0;
  font-size: 11px;
}

.comparison-canvas:hover .zoom-hint,
.comparison-canvas:focus-visible .zoom-hint {
  opacity: 1;
}

.comparison-empty {
  flex-direction: column;
  gap: 14px;
  text-align: center;
  font-size: 12px;
}

.comparison-empty > span {
  max-width: 220px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.8;
}

.comparison-filmstrip {
  flex: 0 0 144px;
  padding: 12px 14px;
  border-top: 1px solid var(--line);
}

.filmstrip-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.filmstrip-heading > span {
  color: var(--muted);
  font-size: 10px;
}

.round-switch {
  display: flex;
  gap: 12px;
}

.round-switch button {
  padding: 0 0 4px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
}

.round-switch button.active {
  border-bottom-color: var(--pink-deep);
  color: var(--text);
}

.trial-thumbnails {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 5px;
}

.trial-thumbnail {
  display: flex;
  flex: 0 0 180px;
  width: 180px;
  min-width: 0;
  max-width: 180px;
  align-items: center;
  gap: 10px;
  height: 76px;
  padding: 7px;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text2);
  cursor: pointer;
}

.trial-thumbnail.selected {
  border-color: var(--pink-deep);
  background: var(--pink-soft);
}

.thumbnail-image {
  display: grid;
  place-items: center;
  flex: 0 0 44px;
  height: 60px;
  border-radius: 4px;
  background: var(--panel);
  overflow: hidden;
  color: var(--muted);
  font-size: 18px;
}

.thumbnail-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.thumbnail-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
}

.thumbnail-info > strong {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--text);
}

.thumbnail-info > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}

.thumbnail-info small {
  font-size: 10px;
  color: var(--muted);
}

.comparison-inspector {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--line);
}

@media (width <= 1100px) {
  .reverse-comparison {
    grid-template-columns: minmax(0, 1fr) 230px;
  }

  .comparison-inspector :deep(.reverse-trial-inspector) {
    padding: 14px;
  }
}

@media (width <= 700px) {
  .reverse-comparison {
    grid-template-columns: minmax(0, 1fr) minmax(160px, 0.75fr);
  }

  .comparison-images {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }

  .comparison-canvas {
    padding: 8px;
  }

  figcaption {
    padding: 0 10px;
    flex-wrap: wrap;
    align-content: center;
    gap: 3px 6px;
  }

  .filmstrip-heading > span {
    display: none;
  }
}
</style>
