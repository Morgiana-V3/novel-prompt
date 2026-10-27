import type { NaiGenResult } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import type { Ref } from 'vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { cleanErr } from '../../shared/lib/format'
import { reportError, toast } from '../../shared/lib/notifications'
import { shellState } from '../../shared/state/shell'
import { imageState } from './state'
export function useGallery(last: Ref<NaiGenResult | null>) {
  const gallery = ref<NaiImage[]>([])

  const galleryFilter = ref('all')

  const visibleGallery = computed(() =>
    gallery.value.filter(
      (image) => galleryFilter.value === 'all' || image.storage === galleryFilter.value,
    ),
  )

  const galleryHint = computed(
    () =>
      ({
        all: '临时未留存：退出软件后清理；已留存与工作台归档：持续保留。',
        temporary: '仅临时保存，软件完全退出后清理。满意的图片可点击「留存图片」。',
        saved: '手动留存或开启自动留存后的图片，退出软件后仍保留。',
        workspace: '工作台的版本图片，随会话保留。',
      })[galleryFilter.value],
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

  async function refreshGallery() {
    gallery.value = await window.api.naiList()
    if (current.value) {
      current.value = gallery.value.find((image) => image.name === current.value!.name) ?? null
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
  watch([() => current.value?.name, galleryFilter, lightbox, () => shellState.tab], resetDelete)
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
    visibleGallery,
    galleryHint,
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
