<script setup lang="ts">
/**
 * 匹配画风的对比页：左参考图、右当前选中的结果；下方按轮次排列全部结果（不互相覆盖），
 * 每轮按相似度排序，全场最像的标「最佳」并默认选中；右侧卡片是选中结果的配置与操作。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { ReverseTrial } from './use-reverse-trials'
import type { MatchRound } from './use-style-match'
import ReverseTrialInspector from './ReverseTrialInspector.vue'
import ImageViewer from '../../shared/ui/ImageViewer.vue'
import Icon from '../../shared/ui/Icon.vue'

const props = defineProps<{
  referenceUrl: string
  referenceName: string
  rounds: MatchRound[]
  running: boolean
  disabled: boolean
  active: boolean
}>()
const emit = defineEmits<{ retry: [trial: ReverseTrial] }>()
const viewer = ref<NaiImage>()
const imageFailed = ref(false)
const strip = ref<HTMLElement>()

interface Item {
  key: string
  roundLabel: string
  index: number
  trial: ReverseTrial
}
/** 每轮一组；完成的轮次按相似度排序，进行中的保持出图顺序 */
const groups = computed(() =>
  props.rounds.map((round, roundIndex) => {
    const items: Item[] = round.trials.map((trial, index) => ({
      key: `${roundIndex}-${index}`,
      roundLabel: round.label,
      index,
      trial,
    }))
    if (!round.live) {
      items.sort(
        (a, b) => (b.trial.score ?? -Infinity) - (a.trial.score ?? -Infinity) || a.index - b.index,
      )
    }
    return { key: `round-${roundIndex}`, label: round.label, live: !!round.live, items }
  }),
)
const items = computed(() => groups.value.flatMap((group) => group.items))
const ranked = computed(() =>
  items.value
    .filter((item) => Number.isFinite(item.trial.score))
    .sort((a, b) => b.trial.score! - a.trial.score!),
)
const bestKey = computed(() => ranked.value[0]?.key)
function rankOf(key: string) {
  const index = ranked.value.findIndex((item) => item.key === key)
  return index < 0 ? undefined : index + 1
}
function titleOf(item: Item) {
  return `${item.roundLabel} · 方案 ${item.index + 1}`
}

/* 默认跟随全场最佳；用户手动点选后不再自动跳走，新一次匹配开始时恢复跟随 */
const pickedKey = ref('')
const selected = computed(
  () =>
    items.value.find((item) => item.key === pickedKey.value) ??
    items.value.find((item) => item.key === bestKey.value) ??
    items.value.at(-1),
)
function pick(key: string) {
  pickedKey.value = key
}
watch(
  () => props.rounds.length,
  async (length, previous) => {
    if (length < (previous ?? 0) || length <= 1) {
      pickedKey.value = ''
    }
    await nextTick()
    strip.value?.scrollTo({ left: strip.value.scrollWidth, behavior: 'smooth' })
  },
)
watch(
  () => selected.value?.trial.image?.url,
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
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !items.value.length) {
    return
  }
  event.preventDefault()
  const last = items.value.length - 1
  let position = items.value.findIndex((item) => item.key === selected.value?.key)
  if (event.key === 'Home') {
    position = 0
  } else if (event.key === 'End') {
    position = last
  } else {
    const direction = event.key === 'ArrowRight' ? 1 : -1
    position = (position + direction + last + 1) % (last + 1)
  }
  pick(items.value[position].key)
  strip.value?.querySelectorAll<HTMLButtonElement>('.trial-thumbnail')[position]?.focus()
}
const emptyLabel = computed(() => {
  if (imageFailed.value) {
    return '图片无法加载'
  }
  return selected.value ? stateLabel(selected.value.trial) : '点「匹配画风」开始出图'
})
function enlargeReference() {
  if (props.referenceUrl) {
    viewer.value = { name: props.referenceName, url: props.referenceUrl, createdAt: 0 }
  }
}
function enlargeSelected() {
  viewer.value = selected.value?.trial.image
}
</script>

<template>
  <section
    class="reverse-comparison"
    aria-label="参考图与匹配结果对比"
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
          </button>
        </figure>
        <figure>
          <figcaption>
            <strong>{{ selected ? titleOf(selected) : '匹配结果' }}</strong>
            <span role="status">{{ selected ? stateLabel(selected.trial) : '还没有结果' }}</span>
          </figcaption>
          <button
            v-if="selected?.trial.image && !imageFailed"
            class="comparison-canvas"
            aria-label="放大当前结果"
            @click="enlargeSelected"
          >
            <img
              :src="selected.trial.image.url"
              :alt="titleOf(selected)"
              @error="imageFailed = true"
            />
          </button>
          <div
            v-else
            class="comparison-canvas comparison-empty"
            role="status"
          >
            <Icon
              :name="selected?.trial.state === 'error' ? 'warn' : 'image'"
              :size="32"
            />
            <strong>{{ emptyLabel }}</strong>
          </div>
        </figure>
      </div>
      <div class="comparison-filmstrip">
        <div
          ref="strip"
          class="trial-thumbnails"
          aria-label="选择结果"
          @keydown="moveSelection"
        >
          <template
            v-for="group in groups"
            :key="group.key"
          >
            <span
              class="round-label"
              :class="{ live: group.live }"
              >{{ group.label }}</span
            >
            <button
              v-for="item in group.items"
              :key="item.key"
              class="trial-thumbnail"
              :class="{ selected: selected?.key === item.key }"
              :aria-pressed="selected?.key === item.key"
              :aria-label="`查看${titleOf(item)}`"
              @click="pick(item.key)"
            >
              <span class="thumbnail-image">
                <img
                  v-if="item.trial.image"
                  :src="item.trial.image.url"
                  alt=""
                />
                <span v-else>{{ item.index + 1 }}</span>
              </span>
              <span class="thumbnail-info">
                <strong
                  >方案 {{ item.index + 1
                  }}<span
                    v-if="bestKey === item.key"
                    class="thumbnail-best"
                    >最佳</span
                  ></strong
                >
                <small v-if="item.trial.score !== undefined"
                  >相似度 {{ item.trial.score.toFixed(3) }}</small
                >
                <small v-else>{{ stateLabel(item.trial) }}</small>
              </span>
            </button>
          </template>
          <p
            v-if="!groups.length"
            class="filmstrip-empty"
          >
            匹配结果会按轮次排在这里
          </p>
        </div>
      </div>
    </div>
    <aside
      class="comparison-inspector"
      aria-label="选中结果的配置与操作"
    >
      <ReverseTrialInspector
        v-for="item in items"
        v-show="selected?.key === item.key"
        :key="item.key"
        :index="item.index"
        :title="titleOf(item)"
        :style-prompt="item.trial.style"
        :trial="item.trial"
        :status="stateLabel(item.trial)"
        :rank="rankOf(item.key)"
        :total="ranked.length"
        :disabled="disabled"
        @retry="emit('retry', item.trial)"
      />
      <p
        v-if="!items.length"
        class="inspector-empty"
      >
        还没有结果
      </p>
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
  flex: 0 0 112px;
  padding: 12px 14px;
  border-top: 1px solid var(--line);
}

.trial-thumbnails {
  display: flex;
  align-items: center;
  gap: 8px;

  /* 横向滚动条的高度始终预留：方案变多出现滚动条时，上方大图不会被挤动 */
  overflow-x: scroll;
  padding-bottom: 2px;
}

.trial-thumbnail {
  display: flex;
  flex: 0 0 150px;
  width: 150px;
  min-width: 0;
  max-width: 150px;
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
  white-space: nowrap;
}

/* 轮次标签：竖排在每组缩略图前，进行中的轮次带粉色 */
.round-label {
  flex-shrink: 0;
  padding: 4px 2px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  writing-mode: vertical-rl;
  letter-spacing: 1px;
}

.round-label:not(:first-child) {
  margin-left: 8px;
  padding-left: 10px;
  border-left: 1px solid var(--line);
}

.round-label.live {
  color: var(--pink-deep);
}

.thumbnail-best {
  padding: 0 6px;
  border-radius: 999px;
  color: var(--pink-deep);
  background: var(--pink-soft);
  font-size: 10px;
  font-weight: 600;
}

.filmstrip-empty,
.inspector-empty {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.inspector-empty {
  padding: 20px 18px;
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
}
</style>
