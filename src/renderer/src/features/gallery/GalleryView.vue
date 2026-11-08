<script setup lang="ts">
import AnimatedNumber from '../../shared/ui/AnimatedNumber.vue'
import { detachLeaving } from '../../shared/lib/list-motion'
import { vFadeImg } from '../../shared/lib/fade-image'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import { DEFAULT_COLLECTION } from '@shared/images/collections'
import {
  collections,
  galleryCollection as collection,
  refreshCollections,
} from './collections-state'
import { shellState } from '../../shared/state/shell'
import { copy, toast, reportError } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import { importGenerationRequest } from '../prompts/public/import-export'
import { openTabForLoad } from '../creation/public/navigation'
import { selectReferenceImage } from '../generation/public'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import ImageViewer from '../../shared/ui/ImageViewer.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
import ConfirmDialog from '../../shared/ui/ConfirmDialog.vue'
import { FavoriteButton } from '../favorites/public'

const images = ref<NaiImage[]>([])
const api = window.api
const retention = ref('all')
const selected = ref('')
/* 无限滚动：先显示 60 张，接近底部再追加；切换图集或筛选时重置 */
const PAGE_SIZE = 60
const STAGGER_CAP = 16
const shownCount = ref(PAGE_SIZE)
const browser = ref<HTMLElement>()
const loadMoreSentinel = ref<HTMLElement>()
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const lightbox = ref(false)
const editing = ref<'create' | 'rename' | ''>('')
const name = ref('')
const confirming = ref<'collection' | 'image' | ''>('')
const current = computed(() => images.value.find((image) => image.name === selected.value))
const activeCollection = computed(() => collections.value.find((c) => c.id === collection.value))
const options = computed(() => collections.value.map((c) => ({ value: c.id, label: c.name })))
const filtered = computed(() =>
  images.value.filter(
    (image) =>
      (collection.value === 'all' ||
        (image.collectionId || DEFAULT_COLLECTION) === collection.value) &&
      (retention.value === 'all' || image.storage === retention.value),
  ),
)
const visible = computed(() => filtered.value.slice(0, shownCount.value))
const hasMore = computed(() => shownCount.value < filtered.value.length)
/** 每批新追加的缩略图从 0 开始依次错开入场 */
const staggerIndex = (position: number) => Math.min(position % PAGE_SIZE, STAGGER_CAP)
const gridKey = computed(() => `${collection.value}|${retention.value}`)
const index = computed(() => filtered.value.findIndex((image) => image.name === selected.value))
const storageLabel = (image: NaiImage) =>
  ({ temporary: '临时', saved: '已留存', workspace: '精修存档' })[image.storage || 'saved']
const createdAtLabel = computed(() =>
  current.value ? new Date(current.value.createdAt).toLocaleString('zh-CN') : '',
)
const deleteTitle = computed(() =>
  current.value?.storage === 'workspace'
    ? '精修存档由创作项目管理，请在项目中删除'
    : '删除图片（移到系统回收站）',
)
let epoch = 0
let unsubscribe: (() => void) | undefined
async function refresh() {
  const request = ++epoch
  loading.value = true
  try {
    const [list] = await Promise.all([window.api.naiList(), refreshCollections()])
    if (request !== epoch) {
      return
    }
    images.value = list
    if (collection.value !== 'all' && !collections.value.some((c) => c.id === collection.value)) {
      collection.value = DEFAULT_COLLECTION
    }
    if (!list.some((image) => image.name === selected.value)) {
      selected.value = ''
      lightbox.value = false
    }
    error.value = ''
  } catch (reason) {
    if (request === epoch) {
      error.value = cleanErr(reason)
    }
  } finally {
    if (request === epoch) {
      loading.value = false
    }
  }
}
/*
 * 详情栏常驻占位，始终有一张选中：切换图集或筛选时默认选中第一张；
 * 删除或移出当前图集后选中原位置的相邻图片；图集为空时显示占位。
 */
watch([collection, retention], () => {
  shownCount.value = PAGE_SIZE
  selected.value = filtered.value[0]?.name ?? ''
  lightbox.value = false
  browser.value?.scrollTo({ top: 0 })
})
let lastIndex = 0
watch(index, (position) => {
  if (position >= 0) {
    lastIndex = position
  }
})
watch(
  filtered,
  (list) => {
    if (list.some((image) => image.name === selected.value)) {
      return
    }
    const neighbor = list[Math.min(lastIndex, list.length - 1)]
    selected.value = neighbor?.name ?? ''
  },
  { immediate: true },
)

let loadMoreObserver: IntersectionObserver | undefined
function observeLoadMore(element: HTMLElement | undefined) {
  loadMoreObserver?.disconnect()
  if (element) {
    loadMoreObserver?.observe(element)
  }
}
watch(loadMoreSentinel, observeLoadMore)

onMounted(() => {
  void refresh().catch(reportError)
  unsubscribe = window.api.onGalleryChanged(() => {
    void refresh().catch(reportError)
  })
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting) && hasMore.value) {
        shownCount.value += PAGE_SIZE
      }
    },
    { root: browser.value, rootMargin: '600px 0px' },
  )
  observeLoadMore(loadMoreSentinel.value)
})
onBeforeUnmount(() => {
  unsubscribe?.()
  loadMoreObserver?.disconnect()
  epoch++
})
async function act(action: () => Promise<unknown>) {
  if (busy.value) {
    return
  }
  busy.value = true
  try {
    await action()
    await refresh()
  } catch (reason) {
    error.value = cleanErr(reason)
  } finally {
    busy.value = false
  }
}
function startEdit(mode: 'create' | 'rename') {
  editing.value = mode
  name.value = mode === 'rename' ? activeCollection.value?.name || '' : ''
}
async function saveCollection() {
  await act(async () => {
    if (editing.value === 'create') {
      collection.value = (await window.api.collectionsCreate(name.value)).id
    } else {
      await window.api.collectionsRename(collection.value, name.value)
    }
    editing.value = ''
  })
}
async function remove() {
  const kind = confirming.value
  const id = collection.value
  const image = current.value
  confirming.value = ''
  await act(async () => {
    if (kind === 'collection') {
      await window.api.collectionsDelete(id)
      collection.value = DEFAULT_COLLECTION
    } else if (image) {
      await window.api.naiDelete(image.name)
      selected.value = ''
      lightbox.value = false
    }
  })
}
async function move(id: string) {
  const image = current.value
  if (!image) {
    return
  }
  await act(() => window.api.collectionsAssign([image.name], id))
  if (collection.value !== 'all' && collection.value !== id) {
    selected.value = ''
  }
}
async function reuse() {
  const image = current.value
  if (!image) {
    return
  }
  await act(async () => {
    const recipe = await window.api.naiRecipe(image.name)
    if (!recipe) {
      throw new Error('这张图片没有可读取的生成记录')
    }
    if (!openTabForLoad()) {
      return
    }
    await importGenerationRequest(recipe.request, '图库载入')
    selectReferenceImage(image)
    shellState.tab = 'generate'
  })
}
async function saveAs() {
  const image = current.value
  if (!image) {
    return
  }
  await act(async () => {
    if (await window.api.naiSaveAs(image.name)) {
      toast('已保存')
    }
  })
}
function step(delta: number) {
  const nextIndex = index.value + delta
  const image = filtered.value[nextIndex]
  if (image) {
    selected.value = image.name
    // 大图里翻到尚未加载的位置时，同步把网格追加到那里
    if (nextIndex >= shownCount.value) {
      shownCount.value = (Math.floor(nextIndex / PAGE_SIZE) + 1) * PAGE_SIZE
    }
  }
}
</script>
<template>
  <div class="library-view">
    <aside class="library-collections scroll">
      <div class="library-section-head">
        <b>图集</b
        ><button
          class="icon-btn sm"
          title="新建图集"
          aria-label="新建图集"
          @click="startEdit('create')"
        >
          <Icon
            name="plus"
            :size="16"
          />
        </button>
      </div>
      <form
        v-if="editing"
        class="collection-form"
        @submit.prevent="saveCollection"
      >
        <input
          v-model="name"
          class="input"
          aria-label="图集名称"
          placeholder="图集名称"
          maxlength="40"
        />
        <div class="row">
          <button
            class="btn small"
            :disabled="busy || !name.trim()"
          >
            保存</button
          ><button
            type="button"
            class="btn ghost small"
            @click="editing = ''"
          >
            取消
          </button>
        </div>
      </form>
      <button
        class="collection-item"
        :class="{ active: collection === 'all' }"
        @click="collection = 'all'"
      >
        <span>全部图片</span><small><AnimatedNumber :value="images.length" /></small>
      </button>
      <TransitionGroup
        tag="div"
        name="list"
        class="collection-list list-motion"
        @before-leave="detachLeaving"
      >
        <button
          v-for="item in collections"
          :key="item.id"
          class="collection-item"
          :class="{ active: collection === item.id }"
          @click="collection = item.id"
        >
          <span>{{ item.name }}</span
          ><small>{{
            images.filter((image) => (image.collectionId || 'default') === item.id).length
          }}</small>
        </button>
      </TransitionGroup>
    </aside>
    <main class="library-main">
      <header class="library-toolbar">
        <h2>
          {{ activeCollection?.name || '全部图片' }}
          <small><AnimatedNumber :value="filtered.length" /></small>
        </h2>
        <div class="row">
          <button
            v-if="activeCollection && collection !== DEFAULT_COLLECTION"
            class="btn ghost small"
            @click="startEdit('rename')"
          >
            重命名
          </button>
          <button
            v-if="activeCollection && collection !== DEFAULT_COLLECTION"
            class="btn ghost small"
            @click="confirming = 'collection'"
          >
            删除图集
          </button>
          <ThemeSelect
            v-model="retention"
            :options="[
              { value: 'all', label: '全部状态' },
              { value: 'saved', label: '已留存' },
              { value: 'temporary', label: '临时' },
              { value: 'workspace', label: '精修存档' },
            ]"
            aria-label="图片保存状态"
          />
          <button
            class="btn ghost small"
            :disabled="loading"
            aria-label="刷新图库"
            @click="refresh"
          >
            刷新
          </button>
        </div>
      </header>
      <p
        v-if="error"
        class="library-error"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="library-content">
        <div
          ref="browser"
          class="library-browser scroll"
          :aria-busy="loading"
        >
          <div
            v-if="loading && !images.length && !error"
            class="library-grid library-skeleton"
            role="status"
            aria-label="正在读取图库"
          >
            <span
              v-for="n in 12"
              :key="n"
              class="library-skeleton-tile"
              :style="{ '--i': n }"
            ></span>
          </div>
          <div
            v-else-if="!filtered.length && !error"
            class="library-empty"
          >
            <Mascot
              :mood="retention === 'all' ? 'sleep' : 'shrug'"
              :size="120"
            />
            <p v-if="retention !== 'all'">没有符合筛选条件的图片</p>
            <p v-else>这个图集还没有图片</p>
          </div>
          <Transition
            name="library-swap"
            mode="out-in"
          >
            <div
              v-if="filtered.length"
              :key="gridKey"
              class="library-grid"
            >
              <button
                v-for="(image, position) in visible"
                :key="image.name"
                class="library-thumb"
                :class="{ selected: selected === image.name }"
                :style="{ '--i': staggerIndex(position) }"
                :aria-label="`查看图片 ${image.name}`"
                @click="selected = image.name"
                @dblclick="lightbox = true"
              >
                <img
                  v-fade-img
                  :src="image.url"
                  alt="生成图片"
                  loading="lazy"
                  draggable="false"
                />
                <span
                  >{{ image.width }} × {{ image.height
                  }}<small>{{ storageLabel(image) }}</small></span
                >
              </button>
            </div>
          </Transition>
          <div
            v-if="hasMore"
            ref="loadMoreSentinel"
            class="library-sentinel"
            aria-hidden="true"
          ></div>
        </div>
        <aside
          class="library-inspector scroll"
          aria-label="图片详情"
        >
          <p
            v-if="!current"
            class="library-inspector-empty"
          >
            <Icon
              name="image"
              :size="26"
            />{{ loading && !images.length ? '正在读取图库…' : '这个图集还没有图片' }}
          </p>
          <template v-else>
            <div class="library-preview">
              <button
                :key="current.name"
                class="library-preview-open"
                aria-label="放大图片"
                title="放大查看（也可以双击缩略图）"
                @click="lightbox = true"
              >
                <img
                  v-fade-img
                  :src="current.url"
                  alt="当前图片"
                />
                <span class="library-preview-zoom"
                  ><Icon
                    name="expand"
                    :size="13"
                /></span>
              </button>
            </div>
            <dl class="library-meta">
              <div>
                <dt>尺寸</dt>
                <dd>{{ current.width }} × {{ current.height }}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd
                  class="library-storage"
                  :data-storage="current.storage || 'saved'"
                >
                  {{ storageLabel(current) }}
                </dd>
              </div>
              <div v-if="current.seed !== undefined">
                <dt>种子</dt>
                <dd>
                  <button
                    class="library-seed"
                    title="复制种子"
                    @click="copy(String(current.seed))"
                  >
                    {{ current.seed
                    }}<Icon
                      name="copy"
                      :size="12"
                    />
                  </button>
                </dd>
              </div>
              <div>
                <dt>时间</dt>
                <dd>{{ createdAtLabel }}</dd>
              </div>
            </dl>
            <section class="library-field">
              <span class="library-field-label">所属图集</span>
              <ThemeSelect
                :model-value="current.collectionId || DEFAULT_COLLECTION"
                :options="options"
                :disabled="busy"
                aria-label="图片所属图集"
                @update:model-value="move"
              />
            </section>
            <p
              v-if="current.storage === 'temporary'"
              class="library-note"
            >
              <Icon
                name="warn"
                :size="13"
              />临时图片退出后清理，分类不会自动留存。
            </p>
            <div class="library-actions">
              <button
                v-if="current.storage === 'temporary'"
                class="btn primary"
                :disabled="busy"
                @click="act(() => api.naiRetain(current!.name))"
              >
                留存图片
              </button>
              <div class="library-primary-row">
                <button
                  class="btn"
                  :class="{ accent: current.storage !== 'temporary' }"
                  :disabled="busy"
                  @click="reuse"
                >
                  <Icon
                    name="import"
                    :size="14"
                  />载入提示词与参数
                </button>
                <FavoriteButton
                  :image="current"
                  class="library-favorite"
                />
              </div>
            </div>
            <div class="library-tools">
              <button
                :disabled="busy"
                title="另存为"
                @click="saveAs"
              >
                <Icon
                  name="download"
                  :size="15"
                /><span>另存为</span>
              </button>
              <button
                :disabled="busy"
                title="打开文件位置"
                @click="act(() => api.naiReveal(current!.name))"
              >
                <Icon
                  name="folder"
                  :size="15"
                /><span>文件位置</span>
              </button>
              <button
                class="danger"
                :disabled="busy || current.storage === 'workspace'"
                :title="deleteTitle"
                @click="confirming = 'image'"
              >
                <Icon
                  name="trash"
                  :size="15"
                /><span>删除</span>
              </button>
            </div>
          </template>
        </aside>
      </div>
    </main>
    <ImageViewer
      v-if="lightbox && current"
      :image="current"
      :images="filtered"
      :can-previous="index > 0"
      :can-next="index < filtered.length - 1"
      @select="selected = $event.name"
      @close="lightbox = false"
      @previous="step(-1)"
      @next="step(1)"
    />
    <ConfirmDialog
      v-if="confirming"
      :title="confirming === 'collection' ? '删除图集' : '删除图片'"
      :message="
        confirming === 'collection'
          ? '图集内的图片将归入默认图集，原图不会删除。'
          : '图片将移到系统回收站。'
      "
      confirm-label="删除"
      danger
      @confirm="remove"
      @cancel="confirming = ''"
    />
  </div>
</template>
<style scoped>
.library-view {
  display: flex;
  height: 100%;
  min-height: 0;
}

.library-collections {
  width: 175px;
  flex-shrink: 0;
  padding: 14px calc(12px - var(--scrollbar-size)) 18px 12px;
  border-right: 1px solid var(--line);
}

.library-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 12px;
}

.collection-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  text-align: left;
  padding: 10px;
  border-radius: 8px;
  background: transparent;
}

.collection-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collection-item small {
  margin-left: auto;
  color: var(--text2);
}

.collection-item.active {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.collection-form {
  display: grid;
  gap: 8px;
  padding: 8px 0;
}

.collection-form input {
  min-width: 0;
  width: 100%;
}

.library-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.library-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-height: 52px;
  padding: 8px 16px 8px 20px;
  border-bottom: 1px solid var(--line);
}

/* 顶栏控件压到 30px，顶栏不再占一大截高度 */
.library-toolbar :deep(.theme-select) {
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
}

.library-toolbar h2 {
  margin: 0;
  font-size: 17px;
}

.library-toolbar small {
  font-size: 12px;
  color: var(--text2);
  font-weight: 400;
}

.library-content {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

/* 切换图集 / 筛选：旧网格快速淡出，新网格里的缩略图依次浮入（与收藏的生图配方一致） */
.library-swap-enter-active {
  transition: opacity var(--dur-base) var(--ease-out);
}

.library-swap-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in);
}

.library-swap-enter-from,
.library-swap-leave-to {
  opacity: 0;
}

.library-sentinel {
  height: 1px;
}

/* 滚动条贴住区域右缘，右内边距扣掉滚动条槽位，与左侧留白对称 */
.library-browser {
  flex: 1;
  min-width: 0;
  padding: 20px calc(20px - var(--scrollbar-size)) 20px 20px;
}

.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
  gap: 14px;
  align-items: start;
}

.library-thumb {
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  min-width: 0;
  text-align: left;
  animation: fade-up var(--dur-slow) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * var(--dur-stagger));
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out),
    transform var(--dur-slow) var(--ease-glide);
}

.library-thumb:hover {
  border-color: var(--pink-line);
  box-shadow: var(--shadow-lift);
  transform: translateY(var(--lift-card));
}

.library-thumb:active {
  transform: translateY(0) scale(var(--press));
  transition-duration: var(--dur-fast);
}

.library-thumb.selected {
  border-color: var(--pink);
  background: var(--pink-soft);
}

.library-thumb img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  background: var(--panel);
  border-radius: 5px;
}

.library-thumb > span {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  font-size: 11px;
  padding: 8px 4px 4px;
  color: var(--text2);
}

/* 详情栏常驻占位：网格宽度固定，选中图片切换时只更新栏内内容，不挤压、不跳动 */
.library-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 300px;
  flex-shrink: 0;
  padding: 18px calc(18px - var(--scrollbar-size)) 18px 18px;
  border-left: 1px solid var(--line);
  font-size: 12px;
  background: var(--bg);
}

.library-inspector-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: auto 0;
  color: var(--muted);
  text-align: center;
}

.library-inspector > * {
  flex-shrink: 0;
}

/* ---------- 预览：棋盘底，右上角收藏，悬停出现放大提示 ---------- */
.library-preview {
  position: relative;
}

.library-preview-open {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  min-height: 160px;
  padding: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  background:
    radial-gradient(circle at 50% 40%, var(--bg) 0%, transparent 70%),
    repeating-conic-gradient(var(--panel) 0% 25%, var(--hover) 0% 50%) 0 0 / 16px 16px;
  cursor: zoom-in;
  animation: fade-in var(--dur-base) var(--ease-out);
  transition:
    border-color var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.library-preview-open:hover {
  border-color: var(--pink-line);
  box-shadow: var(--shadow-pop);
}

.library-preview-open img {
  display: block;
  max-width: 100%;
  max-height: 320px;
  border-radius: 6px;
  object-fit: contain;
  filter: drop-shadow(0 6px 18px rgb(20 20 30 / 12%));
}

.library-preview-zoom {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: #fff;
  background: rgb(20 20 28 / 55%);
  backdrop-filter: blur(6px);
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}

.library-preview-open:hover .library-preview-zoom,
.library-preview-open:focus-visible .library-preview-zoom {
  opacity: 1;
  transform: none;
}

/* ---------- 元信息：两列清单，长种子不再折行 ---------- */
.library-meta {
  display: grid;
  gap: 2px;
  margin: 0;
}

.library-meta > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 26px;
}

.library-meta dt {
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--muted);
}

.library-meta dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.library-storage[data-storage='workspace'] {
  color: var(--pink-deep);
}

.library-storage[data-storage='temporary'] {
  color: var(--alias);
}

.library-seed {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-right: -6px;
  padding: 2px 6px;
  border-radius: 6px;
  background: transparent;
  font-variant-numeric: tabular-nums;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.library-seed .icon {
  color: var(--muted);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.library-seed:hover {
  background: var(--hover);
}

.library-seed:hover .icon,
.library-seed:focus-visible .icon {
  opacity: 1;
}

.library-field {
  display: grid;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.library-field-label {
  font-size: 11.5px;
  color: var(--text2);
}

.library-note {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--panel);
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text2);
}

.library-note .icon {
  margin-top: 2px;
  color: var(--alias);
}

/* ---------- 操作：主操作整行，次要操作三等分图标按钮 ---------- */
.library-actions {
  display: grid;
  gap: 8px;
  margin-top: 4px;
}

.library-actions .btn {
  justify-content: center;
  height: 36px;
}

/* 收藏与主操作并排：星标是一个圆形开关，状态一眼可见，不再压在图片上 */
.library-primary-row {
  display: flex;
  gap: 8px;
}

.library-primary-row .btn {
  flex: 1;
  min-width: 0;
}

.library-primary-row :deep(.library-favorite.favorite-button) {
  width: 36px;
  height: 36px;
  border: 1px solid var(--line2);
  border-radius: 50%;
  background: var(--bg);
}

.library-primary-row :deep(.library-favorite.favorite-button.selected) {
  border-color: var(--pink-line);
  background: var(--pink-soft);
}

.library-tools {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.library-tools button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 9px 4px 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
  font-size: 11px;
  color: var(--text2);
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.library-tools button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.library-tools button.danger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--bad) 30%, var(--line));
  background: var(--bad-soft);
  color: var(--bad);
}

.library-tools button:active:not(:disabled) {
  transform: scale(var(--press-sm));
}

.library-tools button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.library-tools span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-error {
  color: var(--bad);
  padding: 0 20px;
}

/* 首次读取：按网格形状排出占位块，柔光依次扫过，读完后原位换成缩略图 */
.library-skeleton-tile {
  aspect-ratio: 1 / 1.13;
  border-radius: 8px;
  background: linear-gradient(100deg, var(--panel) 35%, var(--hover) 50%, var(--panel) 65%) 0 0 /
    250% 100%;
  animation: shimmer 1.4s var(--ease-loop) infinite;
  animation-delay: calc(var(--i, 0) * 60ms);
}

.library-empty {
  color: var(--text2);
  text-align: center;
  padding: 70px 10px;
}

@media (width < 1150px) {
  .library-collections {
    width: 145px;
  }

  .library-inspector {
    width: 260px;
  }
}
</style>
