import type { NaiGenResult } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import type { Ref } from 'vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { cleanErr } from '../../shared/lib/format'
import { reportError, toast } from '../../shared/lib/notifications'
import { shellState } from '../../shared/state/shell'
import { imageState } from './state'
import { DEFAULT_COLLECTION } from '@shared/images/collections'
import { collections, galleryCollection } from '../gallery/collections-state'
export function useGallery(last: Ref<NaiGenResult | null>) {
  const gallery = ref<NaiImage[]>([])

  const galleryFilter = ref('all')
  const galleryCollections = computed(() => [
    { value: 'all', label: '全部图集' },
    ...collections.value.map((collection) => ({ value: collection.id, label: collection.name })),
  ])

  const visibleGallery = computed(() =>
    gallery.value.filter(
      (image) =>
        (galleryCollection.value === 'all' ||
          (image.collectionId || DEFAULT_COLLECTION) === galleryCollection.value) &&
        (galleryFilter.value === 'all' || (image.storage || 'saved') === galleryFilter.value),
    ),
  )

  async function retain(images: NaiImage[]) {
    try {
      for (const img of images) {
        await window.api.naiRetain(img.name)
      }
      await refreshGallery()
      toast('已留存到图库')
    } catch (error2) {
      toast(cleanErr(error2))
    }
  }

  const current = computed({
    get: () => imageState.currentImage,
    set: (image: NaiImage | null) => {
      imageState.currentImage = image
    },
  })

  const latestBatchTemporary = computed(() => {
    if (!current.value || !last.value?.images.some((image) => image.name === current.value!.name)) {
      return []
    }
    const names = new Set(last.value.images.map((image) => image.name))
    return gallery.value.filter((image) => names.has(image.name) && image.storage === 'temporary')
  })

  const lightbox = ref(false)

  function reconcileSelection() {
    if (
      current.value &&
      !visibleGallery.value.some((image) => image.name === current.value!.name)
    ) {
      current.value = visibleGallery.value[0] ?? null
      if (!current.value) {
        lightbox.value = false
      }
    }
  }
  watch([galleryCollection, galleryFilter], reconcileSelection, { flush: 'sync' })

  function showGenerated(image: NaiImage) {
    const collectionId = image.collectionId || DEFAULT_COLLECTION
    if (galleryCollection.value !== 'all' && galleryCollection.value !== collectionId) {
      galleryCollection.value = collectionId
    }
    if (galleryFilter.value !== 'all' && galleryFilter.value !== (image.storage || 'saved')) {
      galleryFilter.value = 'all'
    }
    current.value = image
  }

  async function refreshGallery() {
    gallery.value = await window.api.naiList()
    if (current.value) {
      current.value = gallery.value.find((image) => image.name === current.value!.name) ?? null
    }
    reconcileSelection()
    if (!current.value) {
      lightbox.value = false
    }
  }

  /* ---------- 图片操作 ---------- */
  async function saveAs(img: NaiImage) {
    if (await window.api.naiSaveAs(img.name)) {
      toast('已保存')
    }
  }

  async function copyImage(img: NaiImage) {
    if (await window.api.naiCopyImage(img.name)) {
      toast('图片已复制')
    }
  }

  /** 删除需要在 3 秒内再点一次确认，避免和旁边的「下载」误触 */
  const pendingDelete = ref<string | null>(null)

  const deleting = ref<string | null>(null)

  let pendingTimer: ReturnType<typeof setTimeout> | undefined

  function resetDelete() {
    clearTimeout(pendingTimer)
    pendingDelete.value = null
  }

  async function remove(img: NaiImage) {
    if (deleting.value || img.storage === 'workspace') {
      return
    }
    if (pendingDelete.value !== img.name) {
      pendingDelete.value = img.name
      clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => (pendingDelete.value = null), 3000)
      return
    }
    resetDelete()
    deleting.value = img.name
    const index = visibleGallery.value.findIndex((image) => image.name === img.name)
    const adjacent =
      index < 0 ? undefined : (visibleGallery.value[index + 1] ?? visibleGallery.value[index - 1])
    try {
      if (!(await window.api.naiDelete(img.name))) {
        toast('图片已不存在，请刷新图库')
        return
      }
      toast('已移到回收站')
      gallery.value = gallery.value.filter((image) => image.name !== img.name)
      if (last.value) {
        last.value.images = last.value.images.filter((image) => image.name !== img.name)
      }
      if (current.value?.name === img.name) {
        current.value = adjacent ?? null
        if (!current.value) {
          lightbox.value = false
        }
      }
      await refreshGallery()
    } catch (error2) {
      toast(cleanErr(error2))
    } finally {
      deleting.value = null
    }
  }

  const reveal = (img: NaiImage) => window.api.naiReveal(img.name)

  const openFolder = () => window.api.naiReveal()

  const galleryIndex = computed(() =>
    visibleGallery.value.findIndex((image) => image.name === current.value?.name),
  )

  function changeImage(delta: number) {
    const next = visibleGallery.value[galleryIndex.value + delta]
    if (next) {
      current.value = next
    }
  }
  let unsubscribe: (() => void) | undefined
  watch(
    [() => current.value?.name, galleryCollection, galleryFilter, lightbox, () => shellState.tab],
    resetDelete,
  )
  onMounted(() => {
    unsubscribe = window.api.onGalleryChanged(() => {
      void refreshGallery().catch(reportError)
    })
    void refreshGallery().catch(reportError)
  })
  onBeforeUnmount(() => {
    unsubscribe?.()
    clearTimeout(pendingTimer)
  })
  return {
    gallery,
    current,
    galleryFilter,
    galleryCollection,
    galleryCollections,
    showGenerated,
    visibleGallery,
    latestBatchTemporary,
    refreshGallery,
    pendingDelete,
    deleting,
    remove,
    changeImage,
    galleryIndex,
    saveAs,
    copyImage,
    reveal,
    openFolder,
    retain,
    lightbox,
  }
}
