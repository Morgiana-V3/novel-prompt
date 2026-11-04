<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { NaiImage } from '@shared/images/types'
import { DEFAULT_COLLECTION } from '@shared/images/collections'
import {
  collections,
  galleryCollection as collection,
  refreshCollections,
} from './collections-state'
import { shellState } from '../../shared/state/shell'
import { toast, reportError } from '../../shared/lib/notifications'
import { cleanErr } from '../../shared/lib/format'
import { importGenerationRequest } from '../prompts/actions'
import Icon from '../../shared/ui/Icon.vue'
import ImageViewer from '../../shared/ui/ImageViewer.vue'
import ThemeSelect from '../../shared/ui/ThemeSelect.vue'
import ConfirmDialog from '../../shared/ui/ConfirmDialog.vue'

const images = ref<NaiImage[]>([])
const api = window.api
const retention = ref('all')
const selected = ref('')
const page = ref(1)
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
const visible = computed(() => filtered.value.slice((page.value - 1) * 60, page.value * 60))
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 60)))
const index = computed(() => filtered.value.findIndex((image) => image.name === selected.value))
const storageLabel = (image: NaiImage) =>
  ({ temporary: '临时', saved: '已留存', workspace: '精修存档' })[image.storage || 'saved']
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
watch([collection, retention], () => {
  page.value = 1
  selected.value = ''
  lightbox.value = false
})
watch(pages, (value) => {
  page.value = Math.min(page.value, value)
})
onMounted(() => {
  void refresh().catch(reportError)
  unsubscribe = window.api.onGalleryChanged(() => {
    void refresh().catch(reportError)
  })
})
onBeforeUnmount(() => {
  unsubscribe?.()
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
    await importGenerationRequest(recipe.request, '图库载入')
    shellState.tab = 'creation'
  })
}
function step(delta: number) {
  const image = filtered.value[index.value + delta]
  if (image) {
    selected.value = image.name
    page.value = Math.floor(index.value / 60) + 1
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
        <span>全部图片</span><small>{{ images.length }}</small>
      </button>
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
    </aside>
    <main class="library-main">
      <header class="library-toolbar">
        <h2>
          {{ activeCollection?.name || '全部图片' }} <small>{{ filtered.length }}</small>
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
        <div class="library-browser scroll">
          <p
            v-if="!filtered.length"
            class="library-empty"
          >
            {{ loading ? '正在读取图库…' : '这个图集还没有图片' }}
          </p>
          <div class="library-grid">
            <button
              v-for="image in visible"
              :key="image.name"
              class="library-thumb"
              :class="{ selected: selected === image.name }"
              :aria-label="`查看图片 ${image.name}`"
              @click="selected = image.name"
              @dblclick="lightbox = true"
            >
              <img
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
          <div
            v-if="pages > 1"
            class="library-pagination"
          >
            <button
              class="btn ghost small"
              :disabled="page === 1"
              @click="page--"
            >
              上一页</button
            ><span>{{ page }} / {{ pages }}</span
            ><button
              class="btn ghost small"
              :disabled="page === pages"
              @click="page++"
            >
              下一页
            </button>
          </div>
        </div>
        <aside
          v-if="current"
          class="library-inspector scroll"
        >
          <button
            class="library-preview"
            aria-label="放大图片"
            @click="lightbox = true"
          >
            <img
              :src="current.url"
              alt="当前图片"
            />
          </button>
          <p>{{ new Date(current.createdAt).toLocaleString('zh-CN') }}</p>
          <p>{{ current.width }} × {{ current.height }} · {{ storageLabel(current) }}</p>
          <p v-if="current.seed !== undefined">Seed {{ current.seed }}</p>
          <label>所属图集</label
          ><ThemeSelect
            :model-value="current.collectionId || DEFAULT_COLLECTION"
            :options="options"
            :disabled="busy"
            aria-label="图片所属图集"
            @update:model-value="move"
          />
          <p
            v-if="current.storage === 'temporary'"
            class="muted"
          >
            临时图片退出后清理，分类不会自动留存。
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
            <button
              class="btn"
              :disabled="busy"
              @click="reuse"
            >
              载入提示词与参数
            </button>
            <button
              class="btn ghost"
              :disabled="busy"
              @click="
                act(async () => {
                  if (await api.naiSaveAs(current!.name)) toast('已保存')
                })
              "
            >
              另存为
            </button>
            <button
              class="btn ghost"
              :disabled="busy"
              @click="act(() => api.naiReveal(current!.name))"
            >
              打开文件位置
            </button>
            <button
              class="btn ghost"
              :disabled="busy || current.storage === 'workspace'"
              @click="confirming = 'image'"
            >
              删除图片
            </button>
          </div>
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
  padding: 18px 10px;
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
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
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
  display: flex;
  flex: 1;
  min-height: 0;
}

.library-browser {
  flex: 1;
  min-width: 0;
  padding: 18px;
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

.library-inspector {
  width: 250px;
  flex-shrink: 0;
  padding: 16px;
  border-left: 1px solid var(--line);
  font-size: 12px;
}

.library-inspector p {
  overflow-wrap: anywhere;
}

.library-preview {
  width: 100%;
  background: var(--panel);
  padding: 0;
}

.library-preview img {
  display: block;
  width: 100%;
  max-height: 280px;
  object-fit: contain;
}

.library-inspector label {
  display: block;
  margin: 18px 0 8px;
}

.library-actions {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.library-error {
  color: var(--bad);
  padding: 0 20px;
}

.library-empty {
  color: var(--text2);
  text-align: center;
  padding: 70px 10px;
}

.library-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 18px;
  font-size: 12px;
}

@media (width < 1150px) {
  .library-collections {
    width: 145px;
  }

  .library-inspector {
    width: 220px;
  }
}
</style>
