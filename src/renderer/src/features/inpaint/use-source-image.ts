import { onBeforeUnmount, type Ref } from 'vue'
import type { NaiImage } from '@shared/images/types'
import type { NaiGenParams } from '@shared/generation/types'
import type { InpaintDraft } from '@shared/prompts/types'
import type { PageEditorState } from '@shared/workspace/model'
import { readPngPrompt } from '../prompts/public/import-export'
import { toDrafts } from '../prompts/public/draft'
import { cleanErr } from '../../shared/lib/format'

interface SourceImageHost {
  source: Ref<NaiImage>
  sourceUrl: Ref<string>
  loading: Ref<boolean>
  error: Ref<string>
  width: Ref<number>
  height: Ref<number>
  draft: InpaintDraft
  settings: NaiGenParams & { strength: number }
  promptNote: Ref<string>
  initialEditor: () => PageEditorState | undefined
  isAlive: () => boolean
  resetEditor: (readPrompt: boolean) => Promise<void>
}

/** Owns decoding, metadata import and the lifetime of the source object URL. */
export function useSourceImage(host: SourceImageHost) {
  const { source, sourceUrl, loading, error, width, height, draft, settings, promptNote } = host
  async function loadSource(image: NaiImage, readPrompt = true) {
    loading.value = true
    error.value = ''
    let url = ''
    try {
      const bytes = await window.api.naiReadImage(image.name)
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
      url = URL.createObjectURL(blob)
      const img = new Image()
      img.src = url
      await img.decode()
      if (!host.isAlive()) {
        URL.revokeObjectURL(url)
        return
      }
      if (
        img.naturalWidth * img.naturalHeight > 4 * 1024 * 1024 ||
        img.naturalWidth % 64 ||
        img.naturalHeight % 64
      ) {
        throw new Error('原图宽高需为 64 的倍数，总像素不超过 4096×1024；重绘会保持原图尺寸。')
      }
      if (readPrompt) {
        try {
          const meta = await readPngPrompt(blob)
          draft.base = meta.base
          draft.negative = meta.negative
          draft.characters = toDrafts(meta.characters)
          settings.qualityTags = false
          settings.ucPreset = 'none'
          if (meta.request && !host.initialEditor()) {
            Object.assign(settings, meta.request.params, { count: 1 })
            promptNote.value = '已读取原图提示词和生成参数。'
          } else {
            promptNote.value = '已读取原图提示词。'
          }
        } catch {
          promptNote.value = '原图没有可读取的提示词，已使用当前工作区内容，请核对后修改。'
        }
      }
      if (!host.isAlive()) {
        URL.revokeObjectURL(url)
        return
      }
      if (sourceUrl.value) {
        URL.revokeObjectURL(sourceUrl.value)
      }
      sourceUrl.value = url
      source.value = image
      width.value = img.naturalWidth
      height.value = img.naturalHeight
      await host.resetEditor(readPrompt)
    } catch (error2) {
      if (url) {
        URL.revokeObjectURL(url)
      }
      error.value = cleanErr(error2)
    } finally {
      loading.value = false
    }
  }

  onBeforeUnmount(() => {
    if (sourceUrl.value) {
      URL.revokeObjectURL(sourceUrl.value)
    }
  })
  return { loadSource }
}
