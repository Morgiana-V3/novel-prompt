<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { groupFavorites, type FavoriteGroup } from '@shared/images/favorite-groups'
import { favorites, refreshFavorites } from './state'
import { shellState } from '../../shared/state/shell'
import { importGenerationRequest, sectionText } from '../prompts/actions'
import { copy, toast } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import Icon from '../../shared/ui/Icon.vue'
import Mascot from '../../shared/ui/Mascot.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
import FavoriteButton from './components/FavoriteButton.vue'
import SnippetLibrary from '../prompts/components/SnippetLibrary.vue'

const favoriteTab = computed({
  get: () => favorites.tab,
  set: (value) => {
    favorites.tab = value
  },
})
const query = ref('')
const tag = ref('')
const selectedId = ref('')
const selectedGroupKey = ref('')
const loaded = ref(false)
const busy = ref(false)
const error = ref('')
const editing = ref(false)
const keepSeed = ref(true)
const failedImage = ref(false)
const imageReady = ref(false)
const draft = reactive({ name: '', note: '', tags: '' })
const tags = computed(() => [...new Set(favorites.items.flatMap((item) => item.tags))].sort())
const tagOptions = computed(() => [
  { value: '', label: '全部标签' },
  ...tags.value.map((label) => ({ value: label, label })),
])
const overview = ref(true)
const grid = ref<HTMLElement>()
let browseScroll = 0
watch(grid, async (element) => {
  if (element) {
    await nextTick()
    element.scrollTop = browseScroll
  }
})
const groups = computed(() => groupFavorites(favorites.items))
const filtered = computed(() =>
  groups.value.filter((group) =>
    group.items.some(
      (item) =>
        (!tag.value || item.tags.includes(tag.value)) &&
        [item.name, item.note, ...item.tags, sectionText(item.recipe.request)]
          .join(' ')
          .toLowerCase()
          .includes(query.value.trim().toLowerCase()),
    ),
  ),
)
const selectedGroup = computed(
  () =>
    filtered.value.find((group) => group.key === selectedGroupKey.value) ??
    filtered.value.find((group) => group.items.some((item) => item.id === selectedId.value)) ??
    filtered.value[0],
)
const selected = computed(
  () =>
    selectedGroup.value?.items.find((item) => item.id === selectedId.value) ??
    selectedGroup.value?.items[0],
)
const groupIndex = computed(() => filtered.value.indexOf(selectedGroup.value!))
const variantIndex = computed(
  () => selectedGroup.value?.items.findIndex((item) => item.id === selected.value?.id) ?? 0,
)
watch([query, tag], () => {
  browseScroll = 0
  if (grid.value) {
    grid.value.scrollTop = 0
  }
})
function openGroup(group: FavoriteGroup, id = group.cover.id) {
  if (grid.value) {
    browseScroll = grid.value.scrollTop
  }
  selectedGroupKey.value = group.key
  selectedId.value = id
  overview.value = false
}
function moveGroup(offset: number) {
  const group = filtered.value[groupIndex.value + offset]
  if (group) {
    openGroup(group)
  }
}
function browse() {
  overview.value = true
}
function moveVariant(offset: number) {
  const item = selectedGroup.value?.items[variantIndex.value + offset]
  if (item) {
    selectedId.value = item.id
  }
}
/** 详情页里点标签：回到总览并按该标签筛选 */
function clearFilters() {
  query.value = ''
  tag.value = ''
}
function filterByTag(label: string) {
  tag.value = label
  query.value = ''
  browse()
}
const variantOptions = computed(() =>
  (selectedGroup.value?.items ?? []).map((item, index, all) => ({
    value: item.id,
    label: `${index + 1} / ${all.length} · 种子 ${item.recipe.request.params.seed ?? '随机'}`,
  })),
)
const request = computed(() => selected.value?.recipe.request)
watch(
  () => selected.value?.id,
  (id) => {
    if (id) {
      selectedId.value = id
    }
    failedImage.value = false
    imageReady.value = false
    editing.value = false
  },
)
watch(
  () => shellState.tab,
  async (tab) => {
    if (tab !== 'favorites') {
      return
    }
    try {
      await refreshFavorites()
      error.value = ''
    } catch (e) {
      error.value = cleanErr(e)
    }
  },
  { immediate: true },
)
// 其他页面收藏后点「查看收藏」：清掉筛选，直接打开那一张。
watch(
  [() => favorites.focusId, () => favorites.items],
  () => {
    const id = favorites.focusId
    if (!id) {
      return
    }
    const group = groups.value.find((entry) => entry.items.some((item) => item.id === id))
    if (!group) {
      return
    }
    favorites.focusId = ''
    favoriteTab.value = 'recipes'
    query.value = ''
    tag.value = ''
    openGroup(group, id)
  },
  { immediate: true },
)
const parameters = computed(() =>
  request.value
    ? [
        ['采样器', request.value.params.sampler],
        ['步数', request.value.params.steps],
        ['引导强度', request.value.params.scale],
        ['引导重缩放', request.value.params.cfgRescale],
        ['噪声调度', request.value.params.noiseSchedule],
        ['生成张数', request.value.params.count],
        ['自动质量词', request.value.params.qualityTags ? '开启' : '关闭'],
        ['负面预设', request.value.params.ucPreset],
      ]
    : [],
)
const createdAt = computed(() =>
  selected.value
    ? new Date(selected.value.createdAt).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '',
)
async function load() {
  if (!request.value || busy.value) {
    return
  }
  const snapshot = JSON.parse(JSON.stringify(request.value))
  busy.value = true
  try {
    if (!keepSeed.value) {
      snapshot.params.seed = null
    }
    await importGenerationRequest(snapshot, '已载入收藏')
    loaded.value = true
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    busy.value = false
  }
}
function startEdit() {
  if (!selected.value) {
    return
  }
  Object.assign(draft, {
    name: selected.value.name,
    note: selected.value.note,
    tags: selected.value.tags.join(', '),
  })
  editing.value = true
}
async function saveEdit() {
  if (!selected.value || busy.value) {
    return
  }
  busy.value = true
  try {
    await window.api.recipesUpdate(selected.value.id, {
      name: draft.name.trim() || selected.value.name,
      note: draft.note,
      tags: draft.tags
        .split(/[,，]/)
        .map((text) => text.trim())
        .filter(Boolean),
    })
    await refreshFavorites()
    editing.value = false
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    busy.value = false
  }
}
async function exportImage() {
  if (!selected.value) {
    return
  }
  try {
    if (await window.api.recipesExport(selected.value.id)) {
      toast('已导出原图与生成记录')
    }
  } catch (e) {
    error.value = cleanErr(e)
  }
}
/** 详情页快捷键：← → 切换同配置图片，Shift + ← → 切换组，Esc 回到总览 */
function onKey(event: KeyboardEvent) {
  if (
    shellState.tab !== 'favorites' ||
    favoriteTab.value !== 'recipes' ||
    overview.value ||
    editing.value ||
    event.isComposing ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement ||
    document.querySelector('[aria-modal="true"], .theme-select-menu, .task-panel, :popover-open')
  ) {
    return
  }
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
  if (step) {
    event.preventDefault()
    if (event.shiftKey) {
      moveGroup(step)
    } else {
      moveVariant(step)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    browse()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <section
    class="favorites-view"
    aria-label="收藏图片与生成记录"
  >
    <header class="favorites-toolbar">
      <div class="seg">
        <button
          :class="{ on: favoriteTab === 'recipes' }"
          :data-count="favorites.items.length || null"
          @click="favoriteTab = 'recipes'"
        >
          生图配方</button
        ><button
          :class="{ on: favoriteTab === 'snippets' }"
          @click="favoriteTab = 'snippets'"
        >
          提示词片段
        </button>
      </div>
      <template v-if="favoriteTab === 'recipes'">
        <div class="favorites-search">
          <Icon
            name="search"
            :size="14"
          />
          <input
            v-model="query"
            class="input"
            type="search"
            placeholder="搜索名称、标签或提示词"
            aria-label="搜索收藏"
          />
        </div>
        <ThemeSelect
          v-model="tag"
          class="favorites-tag-filter"
          :options="tagOptions"
          :disabled="!tags.length"
          aria-label="按标签筛选收藏"
        />
      </template>
    </header>
    <SnippetLibrary
      v-if="favoriteTab === 'snippets'"
      class="favorites-pane"
    />
    <template v-else>
      <p
        v-if="error"
        class="error-box"
        role="alert"
      >
        {{ error }}
      </p>
      <div
        v-if="filtered.length"
        class="favorites-navigation"
      >
        <template v-if="overview">
          <span class="muted small"
            >{{ filtered.length }} 组配置 · {{ favorites.items.length }} 张收藏 ·
            相同配置自动归组，保留每张图片的种子</span
          >
          <button
            v-if="tag"
            class="chip on favorites-active-tag"
            :title="`清除标签筛选：${tag}`"
            @click="tag = ''"
          >
            {{ tag
            }}<Icon
              name="x"
              :size="12"
            />
          </button>
        </template>
        <template v-else>
          <button
            class="btn ghost small favorites-back"
            title="返回全部收藏（Esc）"
            @click="browse"
          >
            <Icon
              name="chevron"
              class="previous"
              :size="14"
            />全部收藏
          </button>
          <span class="favorites-crumb">{{ selected?.name }}</span>
          <div class="favorite-pager">
            <button
              class="icon-btn sm"
              aria-label="上一组收藏"
              title="上一组（Shift + ←）"
              :disabled="groupIndex <= 0"
              @click="moveGroup(-1)"
            >
              <Icon
                name="chevron"
                class="previous"
                :size="14"
              />
            </button>
            <span>{{ groupIndex + 1 }} / {{ filtered.length }} 组</span>
            <button
              class="icon-btn sm"
              aria-label="下一组收藏"
              title="下一组（Shift + →）"
              :disabled="groupIndex >= filtered.length - 1"
              @click="moveGroup(1)"
            >
              <Icon
                name="chevron"
                :size="14"
              />
            </button>
          </div>
        </template>
      </div>
      <div
        v-if="overview && filtered.length"
        class="favorites-overview"
      >
        <div
          ref="grid"
          class="favorites-grid scroll"
          aria-label="收藏配置列表"
        >
          <button
            v-for="(group, index) in filtered"
            :key="group.key"
            class="favorite-card"
            :style="{ '--i': Math.min(index, 16) }"
            :title="group.cover.name"
            @click="openGroup(group)"
          >
            <div class="favorite-cover">
              <img
                v-if="group.cover.thumbnail"
                :src="group.cover.thumbnail"
                alt=""
                loading="lazy"
              /><span
                v-else
                class="favorite-config-cover"
                ><Icon
                  name="sliders"
                  :size="26"
                />仅配置</span
              ><span
                v-if="group.items.length > 1"
                class="favorite-count"
                ><Icon
                  name="layers"
                  :size="11"
                />{{ group.items.length }} 个版本</span
              ><span
                v-if="group.cover.recipe.sourceKind === 'inpaint'"
                class="favorite-kind"
                >局部重绘</span
              >
            </div>
            <div class="favorite-card-meta">
              <strong>{{ group.cover.name }}</strong>
              <small
                >{{ group.cover.recipe.request.version.toUpperCase() }} ·
                {{ group.cover.recipe.request.params.width }} ×
                {{ group.cover.recipe.request.params.height }}</small
              >
            </div>
          </button>
        </div>
      </div>
      <div
        v-else-if="selected && request"
        :key="selectedGroup!.key"
        class="favorites-body"
      >
        <div class="favorites-gallery">
          <div class="favorite-preview">
            <img
              v-if="selected.imageUrl && !failedImage"
              :key="selected.id"
              :class="{ ready: imageReady }"
              :src="selected.imageUrl"
              :alt="selected.name"
              @load="imageReady = true"
              @error="failedImage = true"
            />
            <div
              v-else
              class="favorite-placeholder"
            >
              <Icon
                name="image"
                :size="40"
              /><span>{{
                selected.imageUrl
                  ? '收藏图片无法读取，生成记录仍可查看'
                  : selected.sourceImage
                    ? '旧版收藏 · 无独立原图，生成记录仍可载入'
                    : '仅收藏了配置 · 载入后即可出图'
              }}</span>
            </div>
            <FavoriteButton
              :key="selected.id"
              :item="selected"
              class="favorite-remove"
            />
          </div>
          <div
            v-if="selectedGroup!.items.length > 1"
            class="favorite-variants"
          >
            <div
              class="favorite-strip scroll"
              role="listbox"
              aria-label="同配置图片"
            >
              <button
                v-for="(item, index) in selectedGroup!.items"
                :key="item.id"
                role="option"
                :aria-selected="item.id === selected.id"
                :class="{ on: item.id === selected.id }"
                :title="`种子 ${item.recipe.request.params.seed ?? '随机'}`"
                @click="selectedId = item.id"
              >
                <img
                  v-if="item.thumbnail"
                  :src="item.thumbnail"
                  alt=""
                  loading="lazy"
                /><span v-else>{{ index + 1 }}</span>
              </button>
            </div>
            <div class="favorite-pager">
              <button
                class="icon-btn sm"
                aria-label="上一张同配置图片"
                title="上一张（←）"
                :disabled="variantIndex <= 0"
                @click="moveVariant(-1)"
              >
                <Icon
                  name="chevron"
                  class="previous"
                  :size="14"
                />
              </button>
              <ThemeSelect
                v-model="selectedId"
                class="sm favorite-seed"
                :options="variantOptions"
                aria-label="按种子选择图片"
              />
              <button
                class="icon-btn sm"
                aria-label="下一张同配置图片"
                title="下一张（→）"
                :disabled="variantIndex >= selectedGroup!.items.length - 1"
                @click="moveVariant(1)"
              >
                <Icon
                  name="chevron"
                  :size="14"
                />
              </button>
            </div>
          </div>
        </div>
        <aside
          class="favorite-details"
          aria-label="收藏的生成配置"
        >
          <div class="favorite-detail-content scroll">
            <form
              v-if="editing"
              class="favorite-edit"
              @submit.prevent="saveEdit"
              @keydown.esc.stop="editing = false"
            >
              <label
                >名称<input
                  v-model="draft.name"
                  class="input"
                  maxlength="100"
                  required
              /></label>
              <label
                >标签<input
                  v-model="draft.tags"
                  class="input"
                  placeholder="用逗号分隔，例如：漫画, 黑白"
              /></label>
              <label
                >备注<textarea
                  v-model="draft.note"
                  class="input"
                  rows="3"
                  maxlength="6000"
                ></textarea>
              </label>
              <div class="row">
                <button
                  class="btn primary small"
                  type="submit"
                  :disabled="busy"
                >
                  保存</button
                ><button
                  class="btn ghost small"
                  type="button"
                  @click="editing = false"
                >
                  取消
                </button>
              </div>
            </form>
            <header
              v-else
              class="favorite-head"
            >
              <div>
                <h2 :title="selected.name">{{ selected.name }}</h2>
                <div class="favorite-meta">
                  <span class="pill">{{ request.version.toUpperCase() }}</span
                  ><span class="pill">{{ request.params.width }} × {{ request.params.height }}</span
                  ><span class="pill">种子 {{ request.params.seed ?? '随机' }}</span
                  ><span
                    v-if="selected.recipe.sourceKind === 'inpaint'"
                    class="pill alias"
                    >局部重绘</span
                  >
                </div>
              </div>
              <div class="favorite-head-actions">
                <button
                  class="icon-btn sm"
                  aria-label="导出收藏原图"
                  title="导出原图与生成记录"
                  :disabled="busy || !selected.imageUrl"
                  @click="exportImage"
                >
                  <Icon
                    name="download"
                    :size="15"
                  />
                </button>
                <button
                  class="icon-btn sm"
                  aria-label="编辑收藏名称备注和标签"
                  title="编辑名称、标签和备注"
                  @click="startEdit"
                >
                  <Icon
                    name="edit"
                    :size="15"
                  />
                </button>
              </div>
            </header>
            <template v-if="!editing">
              <div
                v-if="selected.tags.length"
                class="favorite-tags"
              >
                <button
                  v-for="label in selected.tags"
                  :key="label"
                  :title="`查看标签「${label}」下的全部收藏`"
                  @click="filterByTag(label)"
                >
                  #{{ label }}
                </button>
              </div>
              <p
                v-if="selected.note"
                class="favorite-note"
              >
                {{ selected.note }}
              </p>
            </template>
            <p
              v-if="selected.recipe.sourceKind === 'inpaint'"
              class="favorite-hint"
            >
              <Icon
                name="warn"
                :size="13"
              />来自局部重绘：可复用提示词与参数；完整重绘还需要原底图和遮罩。
            </p>
            <section class="favorite-block">
              <h3>
                主提示词
                <button
                  class="icon-btn sm"
                  aria-label="复制完整提示词"
                  title="复制主提示词、角色与负面"
                  @click="copy(sectionText(request))"
                >
                  <Icon
                    name="copy"
                    :size="13"
                  />
                </button>
              </h3>
              <pre :class="{ empty: !request.base }">{{ request.base || '未填写' }}</pre>
            </section>
            <section
              v-for="(character, index) in request.characters"
              :key="index"
              class="favorite-block"
            >
              <h3>
                角色 {{ index + 1 }} <small>{{ character.position || '自动位置' }}</small>
              </h3>
              <pre>{{ character.prompt }}</pre>
              <template v-if="character.negative"
                ><h4>角色负面词</h4>
                <pre>{{ character.negative }}</pre>
              </template>
            </section>
            <section class="favorite-block">
              <h3>负面提示词</h3>
              <pre :class="{ empty: !request.negative }">{{ request.negative || '未填写' }}</pre>
            </section>
            <section class="favorite-block plain">
              <h3>生图参数</h3>
              <dl>
                <div
                  v-for="[label, value] in parameters"
                  :key="String(label)"
                >
                  <dt>{{ label }}</dt>
                  <dd>{{ value }}</dd>
                </div>
              </dl>
              <p class="muted small">收藏于 {{ createdAt }}</p>
            </section>
          </div>
          <footer>
            <label title="不勾选时种子改为随机，其余配置不变"
              ><input
                v-model="keepSeed"
                type="checkbox"
              />保留种子</label
            >
            <Transition name="fade">
              <button
                v-if="loaded"
                class="btn ghost small favorite-go"
                title="前往生图预览"
                @click="shellState.tab = 'generate'"
              >
                去生图<Icon
                  name="arrow"
                  :size="13"
                />
              </button>
            </Transition>
            <button
              class="btn primary"
              :disabled="busy"
              title="载入提示词、模型和全部生成参数，留在当前页"
              @click="load"
            >
              载入配置
            </button>
          </footer>
        </aside>
      </div>
      <div
        v-else
        class="favorites-empty"
      >
        <Mascot
          :mood="favorites.items.length ? 'search' : 'sleep'"
          :size="120"
        />
        <h2>{{ favorites.items.length ? '没有匹配的收藏' : '把喜欢的效果留在这里' }}</h2>
        <p v-if="favorites.items.length">换个关键词，或清除标签筛选再试试。</p>
        <p v-else>
          在生图预览、画师试图或工作台的图片上点击星标，即可保存原图和完整生成记录；也可以在生图页「收藏当前配置」，无需先出图。
        </p>
        <div class="row">
          <button
            v-if="query || tag"
            class="btn small"
            @click="clearFilters"
          >
            清除筛选
          </button>
          <button
            v-else-if="!favorites.items.length"
            class="btn accent small"
            @click="shellState.tab = 'generate'"
          >
            <Icon
              name="image"
              :size="14"
            />去生图
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.favorites-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 18px 24px 20px;
  gap: 12px;
  min-height: 0;
}

/* ---------- 顶部：分类 + 搜索 ---------- */
.favorites-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.favorites-toolbar .seg {
  margin-right: auto;
}

.favorites-toolbar .seg button[data-count]::after {
  content: attr(data-count);
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--line);
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 500;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  transition:
    background-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out);
}

.favorites-toolbar .seg button.on[data-count]::after {
  background: var(--pink-soft);
  color: var(--pink-deep);
}

.favorites-search {
  position: relative;
  display: flex;
  align-items: center;
}

.favorites-search .icon {
  position: absolute;
  left: 11px;
  color: var(--muted);
  pointer-events: none;
}

.favorites-search input {
  width: 260px;
  padding-left: 32px;
}

.favorites-toolbar :deep(.favorites-tag-filter) {
  width: 140px;
}

.favorites-pane {
  flex: 1;
  min-height: 0;
  animation: view-in var(--dur-base) var(--ease-out);
}

/* ---------- 导航条 ---------- */
.favorites-navigation,
.favorite-pager {
  display: flex;
  align-items: center;
  gap: 8px;
}

.favorites-navigation {
  min-height: 28px;
  flex-shrink: 0;
}

.favorites-back {
  margin-left: -8px;
}

.favorites-crumb {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
}

.favorites-crumb::before {
  content: '/';
  margin-right: 8px;
  color: var(--line2);
}

.favorites-active-tag {
  height: 24px;
  padding: 0 8px 0 10px;
  font-size: 11.5px;
}

.favorite-pager {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.previous {
  transform: rotate(180deg);
}

/* ---------- 总览网格 ---------- */
.favorites-overview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  animation: view-in var(--dur-base) var(--ease-out);
}

.favorites-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 18px 16px;
  align-content: start;
  flex: 1;
  min-height: 0;
  padding: 4px 4px 12px;
  margin: -4px;
}

.favorite-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  text-align: left;
  border-radius: 14px;
  animation: fade-up var(--dur-slow) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * 22ms);
}

.favorite-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  display: grid;
  place-items: center;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  transition:
    transform var(--dur-slow) var(--ease-out),
    box-shadow var(--dur-slow) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.favorite-cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--dur-emph) var(--ease-out);
}

.favorite-card:hover .favorite-cover {
  transform: translateY(-3px);
  border-color: var(--pink-line);
  box-shadow: var(--shadow-pop);
}

.favorite-card:hover .favorite-cover img {
  transform: scale(1.035);
}

.favorite-card:active .favorite-cover {
  transform: translateY(-1px) scale(0.985);
  transition-duration: var(--dur-fast);
}

.favorite-card:focus-visible {
  box-shadow: none;
}

.favorite-card:focus-visible .favorite-cover {
  box-shadow: var(--focus-ring);
}

.favorite-count,
.favorite-kind {
  position: absolute;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 500;
  color: #fff;
  background: rgb(20 20 28 / 58%);
  backdrop-filter: blur(6px);
}

.favorite-count {
  right: 8px;
}

.favorite-kind {
  left: 8px;
}

.favorite-config-cover {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
}

.favorite-card-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 2px;
  min-width: 0;
}

.favorite-card strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
  transition: color var(--dur-fast) var(--ease-out);
}

.favorite-card:hover strong {
  color: var(--pink-deep);
}

.favorite-card small {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

/* ---------- 详情 ---------- */
.favorites-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 0.72fr);
  flex: 1;
  min-height: 0;
  gap: 18px;
  animation: view-in var(--dur-base) var(--ease-out);
}

.favorites-gallery {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  min-width: 0;
}

.favorite-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--line);
  background:
    radial-gradient(circle at 50% 40%, var(--bg) 0%, transparent 70%),
    repeating-conic-gradient(var(--panel) 0% 25%, var(--hover) 0% 50%) 0 0 / 20px 20px;
  border-radius: 16px;
  overflow: hidden;
  padding: 18px;
}

.favorite-preview > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 8px 24px rgb(20 20 30 / 12%));
  opacity: 0;
  transform: scale(0.985);
  transition:
    opacity var(--dur-slow) var(--ease-out),
    transform var(--dur-slow) var(--ease-out);
}

.favorite-preview > img.ready {
  opacity: 1;
  transform: none;
}

.favorite-preview :deep(.favorite-remove) {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: var(--bg);
  color: var(--pink-deep);
  box-shadow: var(--shadow-sm);
}

.favorite-variants {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  min-width: 0;
}

.favorite-strip {
  display: flex;
  gap: 6px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-gutter: auto;
  padding: 3px;
}

.favorite-strip button {
  flex-shrink: 0;
  width: 42px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
  border: 1px solid var(--line);
  font-size: 11px;
  color: var(--muted);
  opacity: 0.6;
  transition:
    opacity var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.favorite-strip button:hover {
  opacity: 1;
}

.favorite-strip button.on {
  opacity: 1;
  border-color: var(--pink);
  box-shadow: 0 0 0 2px var(--pink-soft);
}

.favorite-strip button:active {
  transform: scale(var(--press-sm));
}

.favorite-strip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.favorite-variants :deep(.favorite-seed) {
  width: 168px;
  height: 28px;
  font-size: 11.5px;
  padding: 0 10px;
}

.favorite-details {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  min-height: 0;
  background: var(--bg);
}

.favorite-detail-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
  padding: 18px 18px 20px;
}

.favorite-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.favorite-head > div:first-child {
  min-width: 0;
}

.favorite-head h2 {
  display: -webkit-box;
  font-size: 15.5px;
  line-height: 1.5;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  user-select: text;
}

.favorite-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.favorite-head-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.favorite-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.favorite-tags button {
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--pink-soft);
  color: var(--pink-deep);
  font-size: 11.5px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    transform var(--dur-slow) var(--bounce);
}

.favorite-tags button:hover {
  background: color-mix(in srgb, var(--pink-soft) 60%, var(--pink-line));
}

.favorite-tags button:active {
  transform: scale(var(--press-sm));
}

.favorite-note {
  margin: 0;
  padding: 10px 12px;
  border-left: 3px solid var(--pink-line);
  border-radius: 0 8px 8px 0;
  background: var(--panel);
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text2);
  user-select: text;
}

.favorite-hint {
  display: flex;
  gap: 6px;
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--alias);
}

.favorite-hint .icon {
  margin-top: 2px;
}

.favorite-block {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--panel);
  border: 1px solid var(--line);
}

.favorite-block.plain {
  padding: 4px 2px 0;
  background: none;
  border: none;
}

.favorite-block h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  font-size: 12px;
  color: var(--text2);
  margin: 0 0 6px;
}

.favorite-block h3 .icon-btn {
  margin-left: auto;
}

.favorite-block h3 small {
  font-weight: 400;
  color: var(--muted);
  font-size: 11px;
}

.favorite-block h4 {
  margin: 10px 0 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}

.favorite-block pre {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12px/1.7 var(--mono);
  color: var(--text);
  user-select: text;
}

.favorite-block pre.empty {
  color: var(--muted);
  font-family: inherit;
}

dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 4px 0 12px;
}

dl > div {
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--panel);
}

dt {
  color: var(--muted);
  font-size: 10.5px;
}

dd {
  margin: 3px 0 0;
  font-size: 12.5px;
  font-weight: 500;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}

.favorite-edit {
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: fade-in var(--dur-base) var(--ease-out);
}

.favorite-edit label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text2);
}

.favorite-edit textarea {
  resize: vertical;
}

footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  flex-shrink: 0;
  background: var(--bg);
  border-top: 1px solid var(--line);
}

footer .primary {
  margin-left: auto;
}

.favorite-go + .primary {
  margin-left: 0;
}

.favorite-go {
  margin-left: auto;
}

footer label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text2);
  white-space: nowrap;
}

/* ---------- 空状态 ---------- */
.favorite-placeholder,
.favorites-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.favorites-empty {
  flex: 1;
  animation: fade-up var(--dur-slow) var(--ease-out);
}

.favorites-empty h2 {
  font-size: 17px;
  color: var(--text);
}

.favorites-empty p {
  margin: 0;
  max-width: 340px;
  line-height: 1.7;
}

@media (width <= 1100px) {
  .favorites-search input {
    width: 200px;
  }

  .favorites-body {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 1fr);
    gap: 12px;
  }

  .favorite-variants :deep(.favorite-seed) {
    display: none;
  }
}
</style>
