import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { SavedRecipe } from '@shared/images/types'
import { cleanErr } from '../../shared/lib/format'
import { reportError } from '../../shared/lib/notifications'
import type { CanvasFavoriteAsset, CanvasSession } from './session'

const REFERENCED_LIMIT = 40
const BATCH_SIZE = 20

export interface FavoriteMaterial {
  asset: CanvasFavoriteAsset
  imageUrl?: string
  thumbnail: string
  request: SavedRecipe['recipe']['request']
  prompt: string
}

function favoriteMaterial(recipe: SavedRecipe): FavoriteMaterial {
  const request = recipe.recipe.request
  return {
    asset: {
      kind: 'favorite',
      favoriteId: recipe.id,
      label: recipe.name,
      width: request?.params?.width,
      height: request?.params?.height,
    },
    request,
    imageUrl: recipe.imageUrl,
    thumbnail: recipe.thumbnail?.startsWith('data:image/png;') ? recipe.thumbnail : '',
    prompt: request?.base ?? '',
  }
}

export function useCanvasFavorites(getSession: () => CanvasSession, isBrowsing: () => boolean) {
  const loading = ref(false)
  const error = ref('')
  const materials = shallowRef<FavoriteMaterial[]>([])
  const placed = shallowRef(new Map<string, FavoriteMaterial>())
  const selectedId = ref('')
  const visibleCount = ref(BATCH_SIZE)
  let isActive = true
  let reloadRequested = false
  let unsubscribe: (() => void) | undefined

  const totalCount = computed(() => materials.value.length)
  const hasMore = computed(() => visibleCount.value < materials.value.length)
  const displayedFavorites = computed(() => materials.value.slice(0, visibleCount.value))
  const selectedFavorite = computed(() =>
    materials.value.find(({ asset }) => asset.favoriteId === selectedId.value),
  )

  function loadMore() {
    if (visibleCount.value < materials.value.length) {
      visibleCount.value = Math.min(materials.value.length, visibleCount.value + BATCH_SIZE)
    }
  }

  function selectFavorite(id: string) {
    selectedId.value = id
  }

  function favoriteUrlFor(id: string) {
    const material =
      materials.value.find(({ asset }) => asset.favoriteId === id) ?? placed.value.get(id)
    return material?.imageUrl || material?.thumbnail
  }

  async function refreshFavorites() {
    if (!isActive) {
      return
    }
    if (loading.value) {
      reloadRequested = true
      return
    }
    loading.value = true
    error.value = ''
    try {
      const records = await window.canvasApi.recipesList()
      if (!isActive) {
        return
      }

      const byId = new Map(records.map((recipe) => [recipe.id, recipe]))
      const placedMaterials = new Map<string, FavoriteMaterial>()
      for (const { asset } of getSession().images) {
        if (asset.kind !== 'favorite') {
          continue
        }
        const record = byId.get(asset.favoriteId)
        if (!record) {
          continue
        }
        asset.label = record.name
        if (placedMaterials.size < REFERENCED_LIMIT) {
          placedMaterials.set(asset.favoriteId, favoriteMaterial(record))
        }
      }
      materials.value = records.map(favoriteMaterial)
      placed.value = placedMaterials
    } catch (reason) {
      if (isActive) {
        error.value = cleanErr(reason)
      }
    } finally {
      if (isActive) {
        loading.value = false
        if (reloadRequested) {
          reloadRequested = false
          refreshFavorites().catch(reportError)
        }
      }
    }
  }

  watch(isBrowsing, (browsing) => {
    if (browsing) {
      refreshFavorites().catch(reportError)
    }
  })

  onMounted(() => {
    unsubscribe = window.canvasApi.onFavoritesChanged(() => {
      if (isBrowsing() || getSession().images.some(({ asset }) => asset.kind === 'favorite')) {
        refreshFavorites().catch(reportError)
      }
    })
    if (getSession().images.some(({ asset }) => asset.kind === 'favorite')) {
      refreshFavorites().catch(reportError)
    }
  })

  onBeforeUnmount(() => {
    isActive = false
    unsubscribe?.()
  })

  return {
    loading,
    error,
    refreshFavorites,
    displayedFavorites,
    selectedFavorite,
    selectFavorite,
    favoriteUrlFor,
    hasMore,
    totalCount,
    loadMore,
  }
}
