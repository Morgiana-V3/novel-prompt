import { onBeforeUnmount, ref } from 'vue'
import { IMAGE_IMPORT_LIMIT, IMAGE_IMPORT_TYPES } from '@shared/images/import'
import { REFERENCE_MODES, type PreciseReference } from '@shared/generation/references'
import { readPngPrompt } from '../features/prompts/public/import-export'
import { cleanErr } from '../shared/lib/format'
import { toast } from '../shared/lib/notifications'

type ImageRecord = Awaited<ReturnType<typeof readPngPrompt>>
export type ImageUse =
  'decode' | 'reverse' | 'workspace' | 'img2img' | 'reference' | 'vibe' | 'gallery'

interface IncomingImage {
  file: File
  url: string
  width: number
  height: number
  metadata: 'checking' | 'available' | 'absent'
  record?: ImageRecord
}

interface ImageIntakeHandlers {
  blocked: () => boolean
  onOpen: () => void
  decode: (record: ImageRecord) => Promise<void>
  reverse: (file: File) => void
  workspace: (file: File) => Promise<void>
  img2img: (file: File) => Promise<void>
  vibe: (file: File) => Promise<void>
  reference: (file: File, mode: PreciseReference['mode']) => Promise<void>
  gallery: (file: File, collection: string) => Promise<void>
}

export function useImageIntake(handlers: ImageIntakeHandlers) {
  const dragging = ref(false)
  const image = ref<IncomingImage>()
  const busy = ref(false)
  const error = ref('')
  let opening = false
  let disposed = false

  function reset() {
    if (image.value) {
      URL.revokeObjectURL(image.value.url)
      image.value = undefined
    }
    error.value = ''
  }

  function close() {
    if (!busy.value) {
      reset()
    }
  }

  function modalOpen() {
    return !!document.querySelector('dialog:modal')
  }

  function hasFiles(event: DragEvent) {
    return !!event.dataTransfer?.types.includes('Files')
  }

  function onDragOver(event: DragEvent) {
    if (!hasFiles(event)) {
      return
    }
    const handled = event.defaultPrevented
    event.preventDefault()
    dragging.value = !handled && !opening && !image.value && !handlers.blocked() && !modalOpen()
    if (!handled && event.dataTransfer) {
      event.dataTransfer.dropEffect = dragging.value ? 'copy' : 'none'
    }
  }

  function onDragLeave(event: DragEvent) {
    const target = event.relatedTarget
    if (!(target instanceof Node && (event.currentTarget as HTMLElement).contains(target))) {
      dragging.value = false
    }
  }

  async function onDrop(event: DragEvent) {
    if (!hasFiles(event)) {
      return
    }
    const handled = event.defaultPrevented
    event.preventDefault()
    dragging.value = false
    if (handled || opening || image.value || handlers.blocked() || modalOpen()) {
      return
    }
    const files = event.dataTransfer?.files
    const file = files?.[0]
    if (!file) {
      return
    }
    if (files.length !== 1) {
      toast('一次拖入一张图片，再选择用途')
      return
    }
    if (!IMAGE_IMPORT_TYPES.some((type) => file.type === type) || file.size > IMAGE_IMPORT_LIMIT) {
      toast('请选择不超过 25 MB 的 PNG、JPEG 或 WebP 图片')
      return
    }
    opening = true
    try {
      const bitmap = await createImageBitmap(file)
      const { width, height } = bitmap
      bitmap.close()
      if (disposed || handlers.blocked() || modalOpen()) {
        return
      }
      image.value = {
        file,
        url: URL.createObjectURL(file),
        width,
        height,
        metadata: file.type === 'image/png' ? 'checking' : 'absent',
      }
      const incoming = image.value
      handlers.onOpen()
      if (incoming.metadata === 'checking') {
        try {
          incoming.record = await readPngPrompt(file)
          incoming.metadata = 'available'
        } catch {
          incoming.metadata = 'absent'
        }
      }
    } catch {
      toast('无法打开这张图片，请检查文件是否损坏')
    } finally {
      opening = false
    }
  }

  async function choose(action: ImageUse, choice?: string) {
    const incoming = image.value
    if (!incoming || busy.value || handlers.blocked()) {
      return
    }
    busy.value = true
    error.value = ''
    try {
      switch (action) {
        case 'decode':
          if (!incoming.record) {
            throw new Error('图片没有可读取的生成记录')
          }
          await handlers.decode(incoming.record)
          break
        case 'reverse':
          handlers.reverse(incoming.file)
          break
        case 'workspace':
          await handlers.workspace(incoming.file)
          break
        case 'img2img':
          await handlers.img2img(incoming.file)
          break
        case 'vibe':
          await handlers.vibe(incoming.file)
          break
        case 'reference': {
          const mode = REFERENCE_MODES.find((mode) => mode === choice)
          if (!mode) {
            throw new Error('请选择参考图用途')
          }
          await handlers.reference(incoming.file, mode)
          break
        }
        case 'gallery':
          if (!choice) {
            throw new Error('请选择要保存的图集')
          }
          await handlers.gallery(incoming.file, choice)
          break
      }
      reset()
    } catch (cause) {
      error.value = cleanErr(cause)
    } finally {
      busy.value = false
    }
  }

  onBeforeUnmount(() => {
    disposed = true
    reset()
  })

  return { dragging, image, busy, error, close, choose, onDragOver, onDragLeave, onDrop }
}
