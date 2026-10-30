<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { groupFavorites, type FavoriteGroup } from '@shared/images/favorite-groups'
import { favorites, refreshFavorites } from '../../shared/state/favorites'
import { shellState } from '../../shared/state/shell'
import { importGenerationRequest, sectionText } from '../prompts/actions'
import { copy, toast } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import Icon from '../../shared/ui/Icon.vue'
import FavoriteButton from '../../shared/ui/FavoriteButton.vue'
import RecipeLibrary from './components/RecipeLibrary.vue'

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
const tags = computed(() => [...new Set(favorites.items.flatMap((item) => item.tags))].sort())
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
function openGroup(group: FavoriteGroup) {
  if (grid.value) {
    browseScroll = grid.value.scrollTop
  }
  selectedGroupKey.value = group.key
  selectedId.value = group.cover.id
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
const request = computed(() => selected.value?.recipe.request)
watch(
  () => selected.value?.id,
  (id) => {
    if (id) {
      selectedId.value = id
    }
    failedImage.value = false
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
const parameters = computed(() =>
  request.value
    ? [
        ['模型', request.value.version.toUpperCase()],
        ['尺寸', `${request.value.params.width} × ${request.value.params.height}`],
        ['采样器', request.value.params.sampler],
        ['步数', request.value.params.steps],
        ['引导强度', request.value.params.scale],
        ['引导重缩放', request.value.params.cfgRescale],
        ['噪声调度', request.value.params.noiseSchedule],
        ['种子', request.value.params.seed ?? '随机'],
        ['生成张数', request.value.params.count],
        ['自动质量词', request.value.params.qualityTags ? '开启' : '关闭'],
        ['负面预设', request.value.params.ucPreset],
      ]
    : [],
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
    await importGenerationRequest(snapshot, '已载入收藏，可在生图预览中使用')
    loaded.value = true
  } catch (e) {
    error.value = cleanErr(e)
  } finally {
    busy.value = false
  }
}
async function closeEditor() {
  editing.value = false
  try {
    await refreshFavorites()
  } catch (e) {
    error.value = cleanErr(e)
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
</script>

<template>
  <section
    class="favorites-view"
    aria-label="收藏图片与生成记录"
  >
    <header class="favorites-toolbar">
      <div>
        <strong>收藏</strong
        ><span>{{ groups.length }} 组配置 · {{ favorites.items.length }} 个收藏</span>
      </div>
      <input
        v-model="query"
        class="input"
        type="search"
        placeholder="搜索名称、标签或提示词"
        aria-label="搜索收藏"
      />
      <select
        v-model="tag"
        class="input favorites-tag-filter"
        aria-label="按标签筛选收藏"
      >
        <option value="">全部标签</option>
        <option
          v-for="label in tags"
          :key="label"
        >
          {{ label }}
        </option>
      </select>
    </header>
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
      <button
        v-if="!overview"
        class="btn small"
        @click="browse"
      >
        <Icon
          name="layers"
          :size="14"
        />全部收藏
      </button>
      <span class="muted small">{{
        overview ? '相同配置自动归组，保留每张图片的种子' : '浏览不会修改当前提示词'
      }}</span>
      <button
        v-if="loaded"
        class="btn ghost small"
        @click="shellState.tab = 'generate'"
      >
        前往生图<Icon
          name="arrow"
          :size="14"
        />
      </button>
      <div
        v-if="!overview"
        class="favorite-pager"
      >
        <button
          class="icon-btn sm"
          aria-label="上一组收藏"
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
          :disabled="groupIndex >= filtered.length - 1"
          @click="moveGroup(1)"
        >
          <Icon
            name="chevron"
            :size="14"
          />
        </button>
      </div>
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
          v-for="group in filtered"
          :key="group.key"
          class="favorite-card"
          :title="group.cover.name"
          @click="openGroup(group)"
        >
          <div class="favorite-cover">
            <img
              v-if="group.cover.thumbnail"
              :src="group.cover.thumbnail"
              alt=""
              loading="lazy"
            /><Icon
              v-else
              name="book"
              :size="28"
            /><span
              v-if="group.items.length > 1"
              class="favorite-count"
              >{{ group.items.length }} 个版本</span
            >
          </div>
          <strong>{{ group.cover.name }}</strong>
          <small
            >{{ group.cover.recipe.request.version.toUpperCase() }} ·
            {{ group.cover.recipe.request.params.width }} ×
            {{ group.cover.recipe.request.params.height }}</small
          >
        </button>
      </div>
    </div>
    <div
      v-else-if="selected && request"
      class="favorites-body"
    >
      <div class="favorites-gallery">
        <div class="favorite-variants">
          <span>{{ selectedGroup!.items.length > 1 ? '同配置图片' : '收藏预览' }}</span>
          <div
            v-if="selectedGroup!.items.length > 1"
            class="favorite-pager"
          >
            <button
              class="icon-btn sm"
              aria-label="上一张同配置图片"
              :disabled="variantIndex <= 0"
              @click="moveVariant(-1)"
            >
              <Icon
                name="chevron"
                class="previous"
                :size="14"
              />
            </button>
            <select
              v-model="selectedId"
              class="input"
              aria-label="按种子选择图片"
            >
              <option
                v-for="(item, index) in selectedGroup!.items"
                :key="item.id"
                :value="item.id"
              >
                {{ index + 1 }} / {{ selectedGroup!.items.length }} · 种子
                {{ item.recipe.request.params.seed ?? '随机' }}
              </option>
            </select>
            <button
              class="icon-btn sm"
              aria-label="下一张同配置图片"
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
        <div class="favorite-preview">
          <img
            v-if="selected.imageUrl && !failedImage"
            :key="selected.id"
            :src="selected.imageUrl"
            :alt="selected.name"
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
              selected.imageUrl ? '收藏图片无法读取，生成记录仍可查看' : '旧版配置收藏 · 无独立原图'
            }}</span>
          </div>
          <FavoriteButton
            :key="selected.id"
            :item="selected"
            class="favorite-remove"
          />
        </div>
      </div>
      <aside
        class="favorite-details"
        aria-label="收藏的生成配置"
      >
        <div class="favorite-detail-content scroll">
          <header>
            <div>
              <small>生成记录</small>
              <h2>{{ selected.name }}</h2>
            </div>
            <button
              class="icon-btn"
              aria-label="编辑收藏名称备注和标签"
              @click="editing = true"
            >
              <Icon
                name="edit"
                :size="16"
              />
            </button>
          </header>
          <div class="favorite-tags">
            <span
              v-for="label in selected.tags"
              :key="label"
              >{{ label }}</span
            >
          </div>
          <p
            v-if="selected.note"
            class="favorite-note"
          >
            {{ selected.note }}
          </p>
          <p
            v-if="selected.recipe.sourceKind === 'inpaint'"
            class="favorite-note"
          >
            来自局部重绘：可复用提示词与参数；完整重绘还需要原底图和遮罩。
          </p>
          <section>
            <h3>
              主提示词
              <button
                class="icon-btn sm"
                aria-label="复制完整提示词"
                @click="copy(sectionText(request))"
              >
                <Icon
                  name="copy"
                  :size="14"
                />
              </button>
            </h3>
            <pre>{{ request.base || '未填写' }}</pre>
          </section>
          <section
            v-for="(character, index) in request.characters"
            :key="index"
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
          <section>
            <h3>负面提示词</h3>
            <pre>{{ request.negative || '未填写' }}</pre>
          </section>
          <section>
            <h3>生图参数</h3>
            <dl>
              <template
                v-for="[label, value] in parameters"
                :key="String(label)"
                ><dt>{{ label }}</dt>
                <dd>{{ value }}</dd></template
              >
            </dl>
          </section>
        </div>
        <footer>
          <button
            class="icon-btn sm"
            aria-label="导出收藏原图"
            title="导出原图与生成记录"
            :disabled="busy || !selected.imageUrl"
            @click="exportImage"
          >
            <Icon
              name="download"
              :size="16"
            />
          </button>
          <label
            ><input
              v-model="keepSeed"
              type="checkbox"
            />保留种子</label
          >
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
      <Icon
        name="star"
        :size="44"
      />
      <h2>{{ favorites.items.length ? '没有匹配的收藏' : '把喜欢的效果留在这里' }}</h2>
      <p>在生图预览、画师试图或工作台的图片旁点击星星，即可保存原图和生成记录。</p>
    </div>
    <RecipeLibrary
      v-if="editing && selected"
      manage-only
      :initial-id="selected.id"
      @close="closeEditor"
    />
  </section>
</template>

<style scoped>
.favorites-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
  gap: 14px;
  min-height: 0;
}

.favorites-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.favorites-toolbar > div {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
}

.favorites-toolbar span {
  font-size: 11px;
  color: var(--muted);
}

.favorites-toolbar > input {
  width: 240px;
}

.favorites-tag-filter {
  width: 130px;
}

.favorites-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.8fr);
  flex: 1;
  min-height: 0;
  gap: 20px;
}

.favorites-gallery {
  display: flex;
  flex-direction: column;
  gap: 14px;
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
  background: var(--panel);
  border-radius: 14px;
  overflow: hidden;
  padding: 16px;
}

.favorite-preview > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.favorite-preview :deep(.favorite-remove) {
  position: absolute;
  right: 12px;
  top: 12px;
  background: var(--bg);
  color: var(--pink-deep);
}

.favorites-navigation,
.favorite-variants,
.favorite-pager {
  display: flex;
  align-items: center;
  gap: 10px;
}

.favorites-navigation {
  min-height: 28px;
}

.favorite-pager {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
}

.previous {
  transform: rotate(180deg);
}

.favorite-variants {
  height: 32px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text2);
}

.favorite-variants select {
  width: 210px;
  height: 30px;
  font-size: 11px;
}

.favorites-overview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 16px;
}

.favorites-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
  align-content: start;
  flex: 1;
  min-height: 0;
  padding: 2px;
}

.favorite-card {
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  text-align: left;
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
}

.favorite-card:hover {
  border-color: var(--pink-line);
  background: var(--panel);
}

.favorite-cover {
  position: relative;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  background: var(--panel);
  border-radius: 8px;
  overflow: hidden;
}

.favorite-cover img {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.favorite-count {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 3px 6px;
  font-size: 10px;
}

.favorite-card strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  margin: 10px 0 5px;
}

.favorite-card small {
  font-size: 10px;
  color: var(--muted);
}

.favorite-details {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  min-height: 0;
}

.favorite-detail-content {
  flex: 1;
  min-height: 0;
  padding: 20px;
}

.favorite-details header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.favorite-details h2 {
  font-size: 17px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  margin: 8px 0;
}

.favorite-details small,
dt {
  color: var(--muted);
  font-size: 11px;
}

.favorite-details h3 {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  margin: 20px 0 10px;
}

.favorite-details h4 {
  font-size: 11px;
  color: var(--muted);
}

.favorite-details pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.8;
  user-select: text;
}

.favorite-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.favorite-tags span {
  padding: 4px 8px;
  border-radius: 5px;
  background: var(--panel);
  font-size: 10px;
}

.favorite-note {
  white-space: pre-wrap;
  font-size: 11px;
  line-height: 1.8;
  color: var(--text2);
}

dl {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 9px;
}

dd {
  margin: 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}

footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  flex-shrink: 0;
  background: var(--bg);
  border-top: 1px solid var(--line);
}

footer .primary {
  margin-left: auto;
}

footer label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text2);
}

.favorite-placeholder,
.favorites-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--muted);
  font-size: 12px;
}

.favorites-empty {
  flex: 1;
}

.favorites-empty h2 {
  font-size: 18px;
  color: var(--text);
}

@media (width <= 1100px) {
  .favorites-toolbar {
    flex-wrap: wrap;
  }

  .favorites-toolbar > div {
    flex-basis: 100%;
  }

  .favorites-body {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 1fr);
    gap: 12px;
  }
}
</style>
