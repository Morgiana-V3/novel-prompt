<script setup lang="ts">
import { backdropCloser, DIALOG_EXIT_MS } from '../../shared/lib/dialog-motion'
import IconSwap from '../../shared/ui/IconSwap.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { NaiVersion } from '@shared/generation/types'
import {
  artistCatalogUrl,
  artistNameKey,
  type ArtistCatalogPage,
  type ArtistReference,
} from '@shared/artists/catalog'
import Icon from '../../shared/ui/Icon.vue'
import { reportError } from '../../shared/lib/notifications'

const props = defineProps<{
  selected: string[]
  favorites: string[]
  busy: boolean
  version: NaiVersion
}>()
defineEmits<{ add: [name: string]; favorite: [name: string] }>()
const dialog = ref<HTMLDialogElement>()
const opened = ref(false)
const query = ref('')
const favoritesOnly = ref(false)
const failed = ref<string[]>([])
const enlargedArtist = ref<ArtistReference | null>(null)
const data = ref<ArtistCatalogPage | null>(null)
const page = ref(0)
const scrollRoot = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | undefined
const loading = ref(false)
const error = ref('')
const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 24)))
let serial = 0
let timer: ReturnType<typeof setTimeout> | undefined

async function loadPage(reset = true) {
  clearTimeout(timer)
  if (!opened.value || (!reset && (loading.value || page.value >= pageCount.value))) {
    return
  }
  const requestId = ++serial
  loading.value = true
  error.value = ''
  if (reset) {
    data.value = null
    page.value = 0
    failed.value = []
    scrollRoot.value?.scrollTo({ top: 0 })
  }
  enlargedArtist.value = null
  try {
    const result = await window.api.artistCatalog({
      version: props.version,
      query: query.value,
      page: page.value + 1,
      favorites: favoritesOnly.value ? [...props.favorites] : undefined,
    })
    if (requestId === serial) {
      const previous = data.value?.entries ?? []
      const ids = new Set(previous.map((entry) => entry.id))
      data.value = {
        ...result,
        entries: [...previous, ...result.entries.filter((entry) => !ids.has(entry.id))],
      }
      page.value = result.page
    }
  } catch (cause) {
    if (requestId === serial) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    if (requestId === serial) {
      loading.value = false
      await nextTick()
      fillViewport()
    }
  }
}

watch(
  [
    query,
    favoritesOnly,
    () => props.version,
    () => (favoritesOnly.value ? props.favorites.join('\n') : ''),
  ],
  () => {
    page.value = 0
    serial++
    data.value = null
    failed.value = []
    error.value = ''
    enlargedArtist.value = null
    clearTimeout(timer)
    if (opened.value) {
      loading.value = true
      timer = setTimeout(() => {
        loadPage().catch(reportError)
      }, 250)
    }
  },
)

async function open(scope: 'all' | 'favorites' = 'all') {
  query.value = ''
  favoritesOnly.value = scope === 'favorites'
  await nextTick()
  opened.value = true
  dialog.value?.showModal()
  loadPage().catch(reportError)
}
function close() {
  dialog.value?.close()
  onClose()
}
const backdrop = backdropCloser(() => close())
function onClose() {
  // Native close events are queued; a previous close must not clear a reopened dialog.
  if (dialog.value?.open) {
    return
  }
  loading.value = false
  enlargedArtist.value = null
  serial++
  clearTimeout(timer)
  // 内容保留到退场动画播完再卸载，避免先变成空壳再缩小；期间若已重新打开则保留
  setTimeout(() => {
    if (!dialog.value?.open) {
      opened.value = false
    }
  }, DIALOG_EXIT_MS)
}
function openSource() {
  window.api.openWebUrl(artistCatalogUrl(props.version)).catch(reportError)
}
function isSelected(name: string) {
  return props.selected.some((entry) => artistNameKey(entry) === artistNameKey(name))
}
function isFavorite(name: string) {
  return props.favorites.some((entry) => artistNameKey(entry) === artistNameKey(name))
}
function enlarge(artist: ArtistReference) {
  enlargedArtist.value = artist
}
function fillViewport() {
  const root = scrollRoot.value
  if (
    opened.value &&
    root &&
    !error.value &&
    data.value &&
    root.scrollHeight - root.scrollTop - root.clientHeight < 300
  ) {
    loadPage(false).catch(reportError)
  }
}
function cancel(event: Event) {
  event.preventDefault()
  if (enlargedArtist.value) {
    enlargedArtist.value = null
  } else {
    close()
  }
}
watch([scrollRoot, sentinel], () => {
  observer?.disconnect()
  if (scrollRoot.value && sentinel.value) {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          fillViewport()
        }
      },
      { root: scrollRoot.value, rootMargin: '300px' },
    )
    observer.observe(sentinel.value)
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  serial++
  clearTimeout(timer)
})
defineExpose({ open })
</script>

<template>
  <dialog
    ref="dialog"
    class="artist-catalog-dialog"
    aria-labelledby="artist-catalog-title"
    @close="onClose"
    @pointerdown="backdrop.onPointerdown"
    @click="backdrop.onClick"
    @cancel="cancel"
  >
    <template v-if="opened">
      <header
        class="catalog-header"
        :inert="!!enlargedArtist"
      >
        <h2 id="artist-catalog-title">画师图鉴 · {{ version.toUpperCase() }}</h2>
        <button
          class="icon-btn"
          aria-label="关闭画师图鉴"
          @click="close"
        >
          <Icon
            name="x"
            :size="20"
          />
        </button>
      </header>
      <div
        class="catalog-toolbar"
        :inert="!!enlargedArtist"
      >
        <label class="catalog-search"
          ><Icon
            name="search"
            :size="16" /><input
            v-model="query"
            maxlength="200"
            aria-label="搜索图鉴画师"
            placeholder="搜索画师…"
        /></label>
        <div
          class="catalog-scope"
          aria-label="画师图鉴范围"
        >
          <button
            class="btn"
            :class="{ 'catalog-favorites-active': !favoritesOnly }"
            :aria-pressed="!favoritesOnly"
            @click="favoritesOnly = false"
          >
            全部画师
          </button>
          <button
            :class="['btn', { 'catalog-favorites-active': favoritesOnly }]"
            :aria-pressed="favoritesOnly"
            aria-label="查看图鉴收藏"
            @click="favoritesOnly = true"
          >
            <Icon
              name="star"
              :size="14"
            />图鉴收藏 {{ favorites.length }}
          </button>
        </div>
        <button
          class="catalog-link"
          @click="openSource"
        >
          法典图鉴原站 ↗
        </button>
      </div>
      <div
        ref="scrollRoot"
        class="catalog-scroll"
        :inert="!!enlargedArtist"
        @scroll="fillViewport"
      >
        <div
          v-if="data?.entries.length"
          class="catalog-grid"
        >
          <article
            v-for="artist in data.entries"
            :key="artist.id"
            class="catalog-card"
          >
            <button
              v-if="!failed.includes(artist.id)"
              class="catalog-preview"
              :aria-label="`查看 ${artist.name} 例图`"
              @click="enlarge(artist)"
            >
              <img
                :src="artist.image"
                :alt="`${artist.name} · ${version.toUpperCase()} 参考图`"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="failed.push(artist.id)"
              />
            </button>
            <div
              v-else
              class="catalog-image-error"
            >
              <Icon
                name="image"
                :size="28"
              /><span>例图暂时无法加载</span
              ><button
                class="catalog-link"
                @click="failed = failed.filter((id) => id !== artist.id)"
              >
                重新加载
              </button>
            </div>
            <div class="catalog-card-content">
              <div class="catalog-card-title">
                <strong :title="artist.title">{{ artist.name }}</strong
                ><button
                  :class="['icon-btn', { 'catalog-starred': isFavorite(artist.name) }]"
                  :aria-pressed="isFavorite(artist.name)"
                  :aria-label="`收藏 ${artist.name}`"
                  :title="isFavorite(artist.name) ? '移出图鉴收藏' : '加入图鉴收藏'"
                  @click="$emit('favorite', artist.name)"
                >
                  <Icon
                    name="star"
                    :size="16"
                  />
                </button>
              </div>
              <p
                class="catalog-card-source"
                :title="artist.source"
              >
                {{ artist.source }}
              </p>
              <button
                class="btn catalog-add"
                :disabled="busy || isSelected(artist.name)"
                @click="$emit('add', artist.name)"
              >
                <IconSwap
                  :name="isSelected(artist.name) ? 'check' : 'plus'"
                  :size="13"
                />{{ isSelected(artist.name) ? '已在当前方案' : '加入画师串' }}
              </button>
            </div>
          </article>
        </div>
        <div
          v-else-if="!loading && !error"
          class="catalog-empty"
        >
          {{ favoritesOnly ? '没有匹配的收藏' : '没有找到对应的单画师例图' }}
        </div>
        <div
          v-if="loading"
          class="catalog-load-state"
          role="status"
        >
          正在加载…
        </div>
        <div
          v-if="error"
          class="catalog-empty"
          role="alert"
        >
          <p>{{ error }}</p>
          <button
            class="btn"
            @click="loadPage(!data)"
          >
            {{ data ? '重试加载更多' : '重新加载图鉴' }}
          </button>
        </div>
        <div
          ref="sentinel"
          class="catalog-sentinel"
          aria-hidden="true"
        ></div>
        <p
          v-if="data && page >= pageCount"
          class="catalog-load-state"
        >
          已显示全部 {{ data.total }} 组参考图
        </p>
      </div>
      <footer
        class="catalog-footer"
        :inert="!!enlargedArtist"
      >
        <span>来源：法典图鉴 · 例图及内容归原作者</span
        ><button
          class="btn"
          @click="close"
        >
          返回调试
        </button>
      </footer>
      <div
        v-if="enlargedArtist"
        class="catalog-lightbox"
        @click.self="enlargedArtist = null"
      >
        <button
          class="btn"
          aria-label="关闭例图放大"
          @click="enlargedArtist = null"
        >
          关闭放大<Icon
            name="x"
            :size="14"
          />
        </button>
        <img
          :src="enlargedArtist.image"
          :alt="`${enlargedArtist.name} 的参考图`"
          referrerpolicy="no-referrer"
        />
        <strong>{{ enlargedArtist.title }}</strong>
        <span>{{ enlargedArtist.source }}</span>
        <code>{{ enlargedArtist.tags }}</code>
      </div>
    </template>
  </dialog>
</template>

<style scoped src="./catalog.css"></style>
