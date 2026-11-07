import { markRaw, onBeforeUnmount, ref, type Ref } from 'vue'
import type { Region, Stroke } from './model'
import { drawStroke, createMaskCanvas, encodeMask, createRegionLayer } from './canvas-engine'

interface MaskRasterHost {
  mask: Ref<HTMLCanvasElement | undefined>
  previewMask: Ref<HTMLCanvasElement | undefined>
  width: Ref<number>
  height: Ref<number>
  regions: Ref<Region[]>
  selected: Ref<Region>
  selectedId: Ref<string>
  strokes: Ref<Stroke[]>
  active: () => Stroke | null
}

/** One raster per region drives display, hit testing, splitting and export. */
export function useMaskRaster(host: MaskRasterHost) {
  const { mask, previewMask, width, height, regions, selected, selectedId, strokes } = host
  const layerCache = new Map<string, HTMLCanvasElement>()
  const coverage = ref(0)
  const historyCount = ref(0)
  function layer(region: Region): HTMLCanvasElement {
    const cached = layerCache.get(region.id)
    if (cached) {
      return cached
    }
    const canvas = createRegionLayer(region, width.value, height.value)
    layerCache.set(region.id, canvas)
    return canvas
  }
  function maskFromPixels(pixels: Uint8ClampedArray) {
    return markRaw(createMaskCanvas(pixels, width.value, height.value))
  }
  function renderMask() {
    const ctx = mask.value?.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, width.value, height.value)
    ctx.globalCompositeOperation = 'source-over'
    // Display, hit testing, splitting and export all use the same raster. Drawing
    // strokes again on a different canvas can produce different edge coverage.
    ctx.drawImage(layer(selected.value), 0, 0)
    const activeStroke = host.active()
    if (activeStroke) {
      drawStroke(ctx, activeStroke)
    }
    ctx.globalCompositeOperation = 'source-over'
    // Composite every region before applying the user's opacity once. Selection,
    // comments and overlapping masks must never change the preview's strength.
    const preview = previewMask.value?.getContext('2d')
    if (preview) {
      preview.clearRect(0, 0, width.value, height.value)
      // Keep compositing order and source canvases independent of selection.
      // Only the unfinished stroke needs the temporary interaction surface.
      for (const region of regions.value) {
        preview.drawImage(
          activeStroke && region.id === selectedId.value ? mask.value! : layer(region),
          0,
          0,
        )
      }
      preview.globalCompositeOperation = 'source-in'
      preview.fillStyle = '#ff6b9a'
      preview.fillRect(0, 0, width.value, height.value)
      preview.globalCompositeOperation = 'source-over'
    }
  }
  function measureMask() {
    const data = mask.value?.getContext('2d')?.getImageData(0, 0, width.value, height.value).data
    let count = 0
    if (data) {
      for (let i = 3; i < data.length; i += 4) {
        if (data[i]) {
          count++
        }
      }
    }
    coverage.value = data ? (count / (data.length / 4)) * 100 : 0
    selected.value.hasPixels = count > 0
    historyCount.value = strokes.value.length + (selected.value.baseMask ? 1 : 0)
  }
  function exportMask(region = selected.value): string {
    return encodeMask(layer(region), width.value, height.value)
  }

  const invalidateLayer = (id: string) => layerCache.delete(id)
  const clearLayers = () => layerCache.clear()
  onBeforeUnmount(clearLayers)
  return {
    coverage,
    historyCount,
    layer,
    maskFromPixels,
    renderMask,
    measureMask,
    exportMask,
    invalidateLayer,
    clearLayers,
  }
}
