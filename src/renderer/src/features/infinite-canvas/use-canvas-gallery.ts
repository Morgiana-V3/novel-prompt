import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { DEFAULT_COLLECTION, type ImageCollection } from '@shared/images/collections'
import type { NaiImage } from '@shared/images/types'
import { cleanErr } from '../../shared/lib/format'
import { reportError } from '../../shared/lib/notifications'
import type { CanvasGalleryAsset, CanvasSession } from './session'

const BATCH_SIZE = 24

export function useCanvasGallery(getSession: () => CanvasSession, isBrowsing: () => boolean) {
  const loading = ref(false)
  const error = ref('')
  const images = shallowRef<NaiImage[]>([])
  const collections = shallowRef<ImageCollection[]>([])
  const collection = ref('')
  const visibleCount = ref(BATCH_SIZE)
  let isActive = true
  let reloadRequested = false
  let unsubscribe: (() => void) | undefined

  const collectionOptions = computed(() => [
    { value: '', label: '全部图集' },
    ...collections.value.map(({ id, name }) => ({ value: id, label: name })),
  ])
  const filteredImages = computed(() =>
    images.value.filter(
      (image) =>
        !collection.value || (image.collectionId ?? DEFAULT_COLLECTION) === collection.value,
    ),
  )
  const totalCount = computed(() => filteredImages.value.length)
  const hasMore = computed(() => visibleCount.value < filteredImages.value.length)
  const displayedAssets = computed(() =>
    filteredImages.value.slice(0, visibleCount.value).map((image): CanvasGalleryAsset => ({
      kind: 'gallery',
      name: image.name,
      modifiedAt: image.createdAt,
      width: image.width,
      height: image.height,
    })),
  )

  function loadMore() {
    if (visibleCount.value < filteredImages.value.length) {
      visibleCount.value = Math.min(filteredImages.value.length, visibleCount.value + BATCH_SIZE)
    }
  }

  async function refreshGallery() {
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
      const [library, imageCollections] = await Promise.all([
        window.canvasApi.naiList(),
        window.canvasApi.collectionsList(),
      ])
      if (!isActive) {
        return
      }

      const validImages = library.filter((image) => !image.missing)
      const placedImages = new Map(validImages.map((image) => [image.name, image.createdAt]))
      for (const image of getSession().images) {
        if (image.asset.kind !== 'gallery') {
          continue
        }
        image.asset.modifiedAt = placedImages.get(image.asset.name)
      }
      collections.value = imageCollections
      images.value = validImages
      if (collection.value && !imageCollections.some(({ id }) => id === collection.value)) {
        selectCollection('')
      }
    } catch (reason) {
      if (isActive) {
        error.value = cleanErr(reason)
      }
    } finally {
      if (isActive) {
        loading.value = false
        if (reloadRequested) {
          reloadRequested = false
          refreshGallery().catch(reportError)
        }
      }
    }
  }

  function selectCollection(id: string) {
    collection.value = id
    visibleCount.value = BATCH_SIZE
  }

  watch(isBrowsing, (browsing) => {
    if (browsing) {
      refreshGallery().catch(reportError)
    }
  })

  onMounted(() => {
    unsubscribe = window.canvasApi.onGalleryChanged(() => {
      if (isBrowsing() || getSession().images.some(({ asset }) => asset.kind === 'gallery')) {
        refreshGallery().catch(reportError)
      }
    })
  })

  onBeforeUnmount(() => {
    isActive = false
    unsubscribe?.()
  })

  return {
    loading,
    error,
    refreshGallery,
    displayedAssets,
    hasMore,
    totalCount,
    loadMore,
    collection,
    collectionOptions,
    selectCollection,
  }
}
