import { nextTick, type Ref } from 'vue'
import type { FrontendRequest, FrontendContext } from '@shared/contracts/desktop'
import type { InpaintDraft } from '@shared/prompts/types'
import type { Region } from './model'
interface RegionCommandHost {
  frontendBusy: Ref<boolean>
  loading: Ref<boolean>
  error: Ref<string>
  sourceUrl: Ref<string>
  regions: Ref<Region[]>
  draft: InpaintDraft
  width: Ref<number>
  height: Ref<number>
  tool: Ref<'brush' | 'erase' | 'rect'>
  panel: Ref<'regions' | 'suggestions' | 'prompt'>
  brush: Ref<number>
  opened: Ref<boolean>
  sourceReady: () => Promise<void> | undefined
  selectionOnly: () => boolean | undefined
  canSave: () => boolean
  nextRegionNumber: () => number
  cancelPendingSave: () => void
  makeRegion: () => Region
  chooseRegion: (region: Region) => void
  renderMask: () => void
  measureMask: () => void
  removeRegion: () => void
  invalidateRegion: (region: Region) => void
  persistEditor: () => Promise<void>
}
export function createRegionCommands(host: RegionCommandHost) {
  const {
    frontendBusy,
    loading,
    error,
    sourceUrl,
    regions,
    draft,
    width,
    height,
    tool,
    panel,
    brush,
    opened,
    makeRegion,
    chooseRegion,
    renderMask,
    measureMask,
    removeRegion,
    invalidateRegion,
    persistEditor,
  } = host
  async function frontendRegion(request: FrontendRequest, ctx: FrontendContext) {
    frontendBusy.value = true
    try {
      await host.sourceReady()
      if (
        loading.value ||
        error.value ||
        !sourceUrl.value ||
        !host.selectionOnly() ||
        !host.canSave()
      ) {
        throw new Error(error.value || '选区编辑器尚未就绪')
      }
      const existing = request.action !== 'region'
      const removing = request.action === 'region-delete'
      if (!existing && regions.value.filter((region) => region.hasPixels).length >= 16) {
        throw new Error('最多保留 16 个区域')
      }
      if (request.target != null && request.target >= draft.characters.length) {
        throw new Error('角色索引超出当前角色数量')
      }
      const rectangles = request.rectangles ?? []
      if (
        rectangles.some(
          (bounds) =>
            bounds.x + bounds.width > width.value || bounds.y + bounds.height > height.value,
        )
      ) {
        throw new Error('选区超出原图边界')
      }
      let region2 = existing
        ? regions.value.find((region) => region.id === request.region_id && region.hasPixels)
        : undefined
      if (existing && !region2) {
        throw new Error('区域不存在')
      }
      if (removing && request.confirm !== true) {
        throw new Error('缺少删除区域授权')
      }
      await ctx.step('已打开原图选区编辑器')
      if (!region2) {
        region2 = makeRegion()
        regions.value.push(region2)
      }
      chooseRegion(region2)
      tool.value = 'rect'
      panel.value = 'regions'
      await nextTick()
      renderMask()
      measureMask()
      if (existing) {
        await ctx.step(`已定位区域 ${region2.label}`)
      }
      if (removing) {
        await ctx.step(`即将删除区域 ${region2.label} 的遮罩与批注`)
        removeRegion()
      } else {
        if (request.rectangles !== undefined) {
          region2.baseMask = null
          region2.strokes = []
          for (const rect of rectangles) {
            region2.strokes.push({
              tool: 'rect',
              radius: brush.value,
              points: [
                { x: rect.x, y: rect.y },
                { x: rect.x + rect.width, y: rect.y + rect.height },
              ],
            })
          }
          region2.anchor = {
            x: rectangles[0].x + rectangles[0].width / 2,
            y: rectangles[0].y + rectangles[0].height / 2,
          }
        }
        invalidateRegion(region2)
        await nextTick()
        renderMask()
        measureMask()
        if (request.rectangles !== undefined) {
          await ctx.step(existing ? '已更新区域遮罩，尚未保存' : '已在原图上绘制遮罩')
        }
        if (request.instruction !== undefined) {
          region2.instruction = request.instruction
        }
        if (request.target !== undefined) {
          region2.target = request.target
        }
        region2.annotated = true
        if (!region2.number) {
          region2.number = host.nextRegionNumber()
        }
        await ctx.step(existing ? '区域批注已更新，尚未保存' : '已填写区域批注')
      }
      if (ctx.signal.aborted) {
        throw new Error('已停止，未保存区域修改')
      }
      host.cancelPendingSave()
      await persistEditor()
      await ctx.step(removing ? '区域已删除' : '区域批注已保存')
      opened.value = false
      return region2.id
    } finally {
      await nextTick()
      host.cancelPendingSave()
      frontendBusy.value = false
    }
  }
  return frontendRegion
}
