import { onBeforeUnmount, shallowReactive, watch } from 'vue'
import { reportError } from '../../shared/lib/notifications'
import type { CanvasGalleryAsset } from './session'

const PREVIEW_SIDE = 480
const PREVIEW_LIMIT = 120
const READ_CONCURRENCY = 4

export type CanvasPreview = { state: 'loading' | 'failed' } | { state: 'ready'; url: string }

function assetKey(asset: CanvasGalleryAsset): string {
  return `${asset.name}:${asset.modifiedAt ?? 'unlisted'}`
}

function previewSize(bytes: Uint8Array) {
  if (bytes.length < 24) {
    throw new Error('图片缺少尺寸')
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = header.getUint32(16)
  const height = header.getUint32(20)
  if (!width || !height) {
    throw new Error('图片尺寸无效')
  }
  const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function readPreview(asset: CanvasGalleryAsset, isWanted: () => boolean) {
  const bytes = await window.canvasApi.naiReadImage(asset.name)
  if (!isWanted()) {
    return
  }
  const { width, height } = previewSize(bytes)
  const source = new Blob([Uint8Array.from(bytes)], { type: 'image/png' })
  const bitmap = await createImageBitmap(source, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: 'high',
  })
  try {
    if (!isWanted()) {
      return
    }
    const surface = new OffscreenCanvas(width, height)
    const context = surface.getContext('2d')
    if (!context) {
      throw new Error('无法建立图片预览')
    }
    context.drawImage(bitmap, 0, 0)
    return await surface.convertToBlob({ type: 'image/webp', quality: 0.88 })
  } finally {
    bitmap.close()
  }
}

export function useCanvasPreviews(getAssets: () => readonly CanvasGalleryAsset[]) {
  const previews = shallowReactive(new Map<string, CanvasPreview>())
  const reading = new Set<string>()
  let wanted = new Map<string, CanvasGalleryAsset>()
  let active = true

  function removePreview(key: string) {
    const preview = previews.get(key)
    if (preview?.state === 'ready') {
      URL.revokeObjectURL(preview.url)
    }
    previews.delete(key)
  }

  async function loadPreview(key: string, asset: CanvasGalleryAsset) {
    const isWanted = () => active && wanted.has(key)
    reading.add(key)
    previews.set(key, { state: 'loading' })
    try {
      const blob = await readPreview(asset, isWanted)
      if (isWanted()) {
        if (blob) {
          previews.set(key, { state: 'ready', url: URL.createObjectURL(blob) })
        } else {
          removePreview(key)
        }
      }
    } catch {
      if (isWanted()) {
        previews.set(key, { state: 'failed' })
      }
    } finally {
      reading.delete(key)
      scheduleReads()
    }
  }

  function scheduleReads() {
    if (!active) {
      return
    }
    for (const [key, asset] of wanted) {
      if (reading.size >= READ_CONCURRENCY) {
        break
      }
      if (!previews.has(key) && !reading.has(key)) {
        loadPreview(key, asset).catch(reportError)
      }
    }
  }

  watch(
    getAssets,
    (assets) => {
      const next = new Map<string, CanvasGalleryAsset>()
      for (const asset of assets) {
        next.set(assetKey(asset), asset)
        if (next.size >= PREVIEW_LIMIT) {
          break
        }
      }
      wanted = next
      for (const key of previews.keys()) {
        if (!wanted.has(key)) {
          removePreview(key)
        }
      }
      scheduleReads()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    active = false
    wanted.clear()
    for (const key of previews.keys()) {
      removePreview(key)
    }
  })

  function previewFor(asset: CanvasGalleryAsset) {
    return previews.get(assetKey(asset))
  }

  return { previewFor }
}
