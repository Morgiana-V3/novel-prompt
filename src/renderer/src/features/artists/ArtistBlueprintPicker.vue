<script setup lang="ts">
import { backdropCloser } from '../../shared/lib/dialog-motion'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { NaiImage, SavedRecipe } from '@shared/images/types'
import type { NaiVersion } from '@shared/generation/types'
import Icon from '../../shared/ui/Icon.vue'
import { reportError } from '../../shared/lib/notifications'
import { creationBlueprints, type ArtistBlueprint } from './blueprints'
import { favorites, refreshFavorites } from '../favorites/public'

type BlueprintSource = 'gallery' | 'favorite' | 'creation'

const props = defineProps<{ version: NaiVersion; busy: boolean }>()
const emit = defineEmits<{ select: [blueprint: ArtistBlueprint] }>()
const dialog = ref<HTMLDialogElement>()
const source = ref<BlueprintSource>('gallery')
/** 收藏配方：只列出带提示词的配置，按收藏时间倒序 */
const recipes = computed(() =>
  [...favorites.items]
    .filter(
      (item) =>
        !!item.recipe.request.base.trim() ||
        item.recipe.request.characters.some((character) => character.prompt.trim()),
    )
    .sort((a, b) => b.createdAt - a.createdAt),
)
const images = ref<NaiImage[]>([])
const limit = ref(36)
const selected = ref<ArtistBlueprint | null>(null)
const selectedId = ref('')
const loading = ref(false)
const error = ref('')
const tabs = computed(() => creationBlueprints(props.version))
let serial = 0

async function loadImages() {
  const requestId = ++serial
  loading.value = true
  error.value = ''
  try {
    const list = await window.api.naiList()
    if (requestId === serial) {
      images.value = list
        .filter((image) => !image.missing)
        .sort((a, b) => b.createdAt - a.createdAt)
    }
  } catch (cause) {
    if (requestId === serial) {
      error.value = String(cause)
    }
  } finally {
    if (requestId === serial) {
      loading.value = false
    }
  }
}
function open() {
  serial++
  loading.value = false
  error.value = ''
  selected.value = null
  selectedId.value = ''
  limit.value = 36
  dialog.value?.showModal()
  loadSource(source.value)
}
function loadSource(next: BlueprintSource) {
  if (next === 'gallery') {
    loadImages().catch(reportError)
  } else if (next === 'favorite' && !favorites.loaded) {
    refreshFavorites().catch(reportError)
  }
}
/*
 * ---------- 搜索 ----------
 * 收藏配方按名称、标签、备注、提示词；创作标签按标题与提示词；
 * 图库图片按种子、尺寸，输入关键词后再按需读取每张图保存的提示词建立索引（只在弹窗打开期间保留）。
 */
const INDEX_CONCURRENCY = 6
const query = ref('')
const normalizedQuery = computed(() => query.value.trim().toLowerCase())
const promptIndex = ref(new Map<string, string>())
const indexing = ref(false)
const indexedCount = ref(0)
let indexSerial = 0

function matches(...texts: (string | undefined)[]): boolean {
  const keyword = normalizedQuery.value
  return !keyword || texts.some((text) => !!text && text.toLowerCase().includes(keyword))
}
function requestText(request: ArtistBlueprint['request']): string {
  return [request.base, ...request.characters.map((character) => character.prompt)].join(' ')
}
const visibleImages = computed(() =>
  images.value.filter((image) =>
    matches(
      image.name,
      image.seed === undefined ? undefined : String(image.seed),
      `${image.width}x${image.height}`,
      `${image.width} × ${image.height}`,
      promptIndex.value.get(image.name),
    ),
  ),
)
const visibleRecipes = computed(() =>
  recipes.value.filter((item) =>
    matches(item.name, item.note, item.tags.join(' '), requestText(item.recipe.request)),
  ),
)
const visibleTabs = computed(() =>
  tabs.value.filter((tab) => matches(tab.title, requestText(tab.request))),
)

async function buildPromptIndex() {
  if (indexing.value || source.value !== 'gallery') {
    return
  }
  const serialAtStart = ++indexSerial
  const pending = images.value.filter((image) => !promptIndex.value.has(image.name))
  if (!pending.length) {
    return
  }
  indexing.value = true
  indexedCount.value = images.value.length - pending.length
  const next = new Map(promptIndex.value)
  let cursor = 0
  const worker = async () => {
    while (cursor < pending.length && serialAtStart === indexSerial) {
      const image = pending[cursor++]
      const recipe = await window.api.naiRecipe(image.name).catch(() => null)
      next.set(image.name, recipe ? requestText(recipe.request) : '')
      indexedCount.value++
      if (indexedCount.value % 24 === 0) {
        promptIndex.value = new Map(next)
      }
    }
  }
  await Promise.all(Array.from({ length: INDEX_CONCURRENCY }, worker))
  if (serialAtStart === indexSerial) {
    promptIndex.value = next
    indexing.value = false
  }
}
watch(normalizedQuery, (keyword) => {
  limit.value = 36
  if (keyword && source.value === 'gallery') {
    buildPromptIndex().catch(reportError)
  }
})

const searchPlaceholder = computed(() => {
  if (source.value === 'gallery') {
    return '搜索提示词、种子或尺寸'
  }
  if (source.value === 'favorite') {
    return '搜索名称、标签或提示词'
  }
  return '搜索标签名或提示词'
})
function close() {
  serial++
  indexSerial++
  indexing.value = false
  promptIndex.value = new Map()
  query.value = ''
  loading.value = false
  dialog.value?.close()
}
const backdrop = backdropCloser(() => close())
function changeSource(next: BlueprintSource) {
  serial++
  source.value = next
  selected.value = null
  selectedId.value = ''
  error.value = ''
  loading.value = false
  loadSource(next)
  if (next === 'gallery' && normalizedQuery.value) {
    buildPromptIndex().catch(reportError)
  }
}
function selectRecipe(item: SavedRecipe) {
  serial++
  loading.value = false
  error.value = ''
  selectedId.value = item.id
  selected.value = {
    kind: 'favorite',
    id: item.id,
    title: item.name,
    request: item.recipe.request,
  }
}
async function selectImage(image: NaiImage) {
  const requestId = ++serial
  selectedId.value = image.name
  selected.value = null
  loading.value = true
  error.value = ''
  try {
    const recipe = await window.api.naiRecipe(image.name)
    if (requestId !== serial) {
      return
    }
    if (!recipe) {
      error.value = '这张图未保存提示词和参数，请先在「图片反推」中处理。'
      return
    }
    selected.value = {
      kind: 'gallery',
      id: image.name,
      title: image.name,
      request: recipe.request,
      image,
    }
  } catch (cause) {
    if (requestId === serial) {
      error.value = String(cause)
    }
  } finally {
    if (requestId === serial) {
      loading.value = false
    }
  }
}
/*
 * 选中后只在底栏显示一行摘要（名称 · 模型 · 尺寸 · 角色数），完整提示词放在悬停提示里；
 * 不再弹出右侧预览栏，网格列数保持不变，选择时不会抖动。
 */
const selectedSummary = computed(() => {
  const blueprint = selected.value
  if (!blueprint) {
    return '选择要用于对照的画面内容'
  }
  const { version: model, params, characters } = blueprint.request
  const modelNote =
    model !== props.version ? `（将用 ${props.version.toUpperCase()} 重新生成）` : ''
  return `${blueprint.title} · ${model.toUpperCase()}${modelNote} · ${params.width} × ${params.height} · ${characters.length} 个角色`
})
const selectedPrompt = computed(() => {
  const request = selected.value?.request
  if (!request) {
    return ''
  }
  const characters = request.characters.map(
    (character, index) => `角色 ${index + 1}：${character.prompt}`,
  )
  return [request.base || '仅角色提示词', ...characters].join('\n')
})
function selectTab(blueprint: ArtistBlueprint) {
  selectedId.value = blueprint.id
  selected.value = blueprint
}
function useSelected() {
  if (!selected.value || props.busy || loading.value) {
    return
  }
  emit('select', selected.value)
  close()
}
function scroll(event: Event) {
  const element = event.target as HTMLElement
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 300) {
    limit.value += 36
  }
}
defineExpose({ open })
onBeforeUnmount(() => {
  serial++
  indexSerial++
})
</script>

<template>
  <dialog
    ref="dialog"
    class="blueprint-dialog"
    :class="{ 'creation-source': source === 'creation' }"
    :style="{ '--blueprint-tab-count': tabs.length }"
    aria-labelledby="blueprint-title"
    @pointerdown="backdrop.onPointerdown"
    @click="backdrop.onClick"
    @cancel.prevent="close"
  >
    <header>
      <h3 id="blueprint-title">选择蓝本</h3>
      <button
        class="icon-btn"
        aria-label="关闭蓝本选择"
        @click="close"
      >
        <Icon
          name="x"
          :size="18"
        />
      </button>
    </header>
    <nav aria-label="蓝本来源">
      <button
        :aria-pressed="source === 'gallery'"
        @click="changeSource('gallery')"
      >
        图库图片
      </button>
      <button
        :aria-pressed="source === 'favorite'"
        @click="changeSource('favorite')"
      >
        收藏配方
      </button>
      <button
        :aria-pressed="source === 'creation'"
        @click="changeSource('creation')"
      >
        创作标签
      </button>
      <label class="blueprint-search">
        <Icon
          name="search"
          :size="14"
        />
        <input
          v-model="query"
          type="search"
          class="input"
          :placeholder="searchPlaceholder"
          aria-label="搜索蓝本"
        />
        <small
          v-if="indexing"
          class="blueprint-indexing"
          >建立索引 {{ indexedCount }}/{{ images.length }}</small
        >
      </label>
    </nav>
    <div class="blueprint-layout">
      <div
        class="blueprint-body"
        @scroll="scroll"
      >
        <div
          v-if="source === 'gallery'"
          class="blueprint-images"
        >
          <button
            v-for="image in visibleImages.slice(0, limit)"
            :key="image.name"
            :class="{ selected: selectedId === image.name }"
            :aria-label="`选择蓝本图片 ${image.name}`"
            :aria-pressed="selectedId === image.name"
            @click="selectImage(image)"
          >
            <img
              :src="image.url"
              :alt="image.name"
              loading="lazy"
            /><span :title="image.name">{{ image.name }}</span>
          </button>
        </div>
        <div
          v-else-if="source === 'favorite'"
          class="blueprint-images"
        >
          <button
            v-for="item in visibleRecipes"
            :key="item.id"
            :class="{ selected: selectedId === item.id }"
            :aria-label="`选择收藏配方 ${item.name}`"
            :aria-pressed="selectedId === item.id"
            @click="selectRecipe(item)"
          >
            <img
              v-if="item.thumbnail || item.imageUrl"
              :src="item.thumbnail || item.imageUrl"
              :alt="item.name"
              loading="lazy"
            /><span
              v-else
              class="blueprint-config-only"
              ><Icon
                name="sliders"
                :size="22"
            /></span>
            <span :title="item.name">{{ item.name }}</span>
          </button>
        </div>
        <div
          v-else
          class="blueprint-tabs"
        >
          <button
            v-for="tab in visibleTabs"
            :key="tab.id"
            :class="{ selected: selectedId === tab.id }"
            :aria-pressed="selectedId === tab.id"
            :disabled="
              !tab.request.base.trim() &&
              !tab.request.characters.some((character) => character.prompt.trim())
            "
            @click="selectTab(tab)"
          >
            <strong>{{ tab.title }}</strong>
            <p>
              {{
                tab.request.base ||
                tab.request.characters.map((character) => character.prompt).join(', ') ||
                '空白标签'
              }}
            </p>
            <small
              >{{ tab.request.characters.length }} 个角色 · {{ tab.request.params.width }} ×
              {{ tab.request.params.height }}</small
            >
          </button>
        </div>
        <p
          v-if="source === 'gallery' && !images.length && !loading && !error"
          class="blueprint-empty"
        >
          图库中暂无图片，可以从创作标签选择。
        </p>
        <p
          v-if="source === 'favorite' && favorites.loaded && !recipes.length"
          class="blueprint-empty"
        >
          还没有收藏的生图配方，可以在图片上点星标收藏。
        </p>
        <p
          v-if="loading"
          role="status"
        >
          正在读取…
        </p>
        <div
          v-if="error"
          class="blueprint-error"
          role="alert"
        >
          {{ error
          }}<button
            v-if="!images.length"
            class="btn"
            @click="loadImages"
          >
            重试
          </button>
        </div>
      </div>
    </div>
    <footer>
      <span
        class="blueprint-summary"
        :title="selectedPrompt"
        >{{ selectedSummary }}</span
      ><button
        class="btn primary"
        :disabled="!selected || loading || busy"
        @click="useSelected"
      >
        使用此蓝本
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.blueprint-dialog {
  flex-direction: column;
  width: min(780px, 92vw);
  height: min(700px, 88dvh);
  max-height: 88dvh;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line2);
  border-radius: 16px;
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow-modal);
}

/* flex-direction 写在基础类上，[open] 只负责显示：退场期间 dialog 仍显示，方向不能跟着失效 */
.blueprint-dialog[open] {
  display: flex;
}

.blueprint-dialog.creation-source {
  height: min(640px, calc(210px + var(--blueprint-tab-count) * 116px), 88dvh);
  max-height: min(640px, 88dvh);
}

.blueprint-dialog::backdrop {
  background: var(--scrim);
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 16px;
  padding: 16px 20px;
}

header h3 {
  margin: 0;
  font-size: 16px;
}

nav {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  gap: 6px;
  padding: 0 20px 12px;
  border-bottom: 1px solid var(--line);
}

.blueprint-layout {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr);
}

/* 搜索框放在来源切换右侧 */
.blueprint-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  color: var(--muted);
}

.blueprint-search .icon {
  position: absolute;
  left: 11px;
  pointer-events: none;
}

.blueprint-search input {
  width: 240px;
  padding-left: 32px;
}

.blueprint-indexing {
  font-size: 11px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

nav button {
  padding: 7px 12px;
  border: 0;
  border-radius: 7px;
  color: var(--text2);
  background: transparent;
}

nav button[aria-pressed='true'] {
  color: var(--pink-deep);
  background: var(--pink-soft);
}

.blueprint-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px 20px;
}

.blueprint-images {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.blueprint-images button,
.blueprint-tabs button {
  overflow: hidden;
  padding: 8px;
  border: 1px solid var(--line2);
  border-radius: 10px;
  text-align: left;
  color: var(--text);
  background: var(--panel);
}

.blueprint-images img {
  width: 100%;
  height: 130px;
  object-fit: contain;
}

/* 仅收藏了配置、没有图片的配方：用占位块保持网格对齐 */
.blueprint-images .blueprint-config-only {
  display: grid;
  place-items: center;
  height: 130px;
  border-radius: 6px;
  color: var(--muted);
  background: var(--panel);
}

.blueprint-images span {
  display: block;
  overflow: hidden;
  font-size: 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.blueprint-images .selected,
.blueprint-tabs .selected {
  border-color: var(--pink-deep);
  background: var(--pink-soft);
}

.blueprint-tabs {
  display: grid;
  gap: 10px;
}

.blueprint-tabs button {
  padding: 14px;
}

.blueprint-tabs p {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.6;
}

.blueprint-tabs small,
footer span {
  font-size: 11px;
  color: var(--text2);
}

.blueprint-error {
  margin-top: 12px;
  color: var(--bad);
  font-size: 12px;
}

.blueprint-empty {
  color: var(--muted);
  font-size: 12px;
}

footer {
  border-top: 1px solid var(--line);
}

footer button {
  flex-shrink: 0;
}

footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (width <= 650px) {
  .blueprint-images {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
