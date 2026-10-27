import type { ComputedRef, Ref, WritableComputedRef } from 'vue'
import { computed, ref, shallowRef } from 'vue'
import { toCanvasPoint } from './canvas-engine'
import { backupRegion } from './history'
import type { Point, Region, RegionBackup, Stroke } from './model'
interface MaskInteractionHost {
  mask: Ref<HTMLCanvasElement | undefined>
  width: Ref<number>
  height: Ref<number>
  editable: ComputedRef<boolean>
  selected: ComputedRef<Region>
  selectedId: Ref<string>
  editingMaskId: Ref<string | null>
  tool: Ref<Stroke['tool']>
  brush: Ref<number>
  strokes: WritableComputedRef<Stroke[]>
  lastRemoval: Ref<{ label: string; restore: () => void } | null>
  confirmingClose: Ref<boolean>
  startFreshRegion: () => boolean
  invalidateRegion: (region: Region) => void
  renderMask: () => void
  measureMask: () => void
  restoreRemoval: () => void
  remember: (label: string, restore: () => void) => void
  restoreRegion: (region: Region, backup: RegionBackup) => void
}
export function useMaskInteraction({
  mask,
  width,
  height,
  editable,
  selected,
  selectedId,
  editingMaskId,
  tool,
  brush,
  strokes,
  lastRemoval,
  confirmingClose,
  startFreshRegion,
  invalidateRegion,
  renderMask,
  measureMask,
  restoreRemoval,
  remember,
  restoreRegion,
}: MaskInteractionHost) {
  const active = shallowRef<Stroke | null>(null)

  const pointer = ref<number | null>(null)

  function point(event: MouseEvent): Point {
    return toCanvasPoint(event, mask.value!.getBoundingClientRect(), width.value, height.value)
  }

  function down(pointerEvent: PointerEvent) {
    if (!editable.value || pointerEvent.button !== 0 || pointer.value !== null) {
      return
    }
    pointerEvent.preventDefault()
    if (
      selected.value.annotated &&
      editingMaskId.value !== selectedId.value &&
      tool.value !== 'erase' &&
      !startFreshRegion()
    ) {
      return
    }
    pointer.value = pointerEvent.pointerId
    active.value = { tool: tool.value, radius: brush.value / 2, points: [point(pointerEvent)] }
    mask.value!.setPointerCapture(pointerEvent.pointerId)
    renderMask()
  }

  function move(pointerEvent: PointerEvent) {
    if (!active.value || pointer.value !== pointerEvent.pointerId) {
      return
    }
    if (active.value.tool === 'rect') {
      active.value.points = [active.value.points[0], point(pointerEvent)]
    } else {
      active.value.points.push(point(pointerEvent))
    }
    renderMask()
  }

  function up(pointerEvent: PointerEvent) {
    if (!active.value || pointer.value !== pointerEvent.pointerId) {
      return
    }
    if (pointerEvent.type !== 'pointercancel') {
      move(pointerEvent)
      strokes.value.push(active.value)
      invalidateRegion(selected.value)
      lastRemoval.value = null
      confirmingClose.value = false
    }
    active.value = null
    pointer.value = null
    if (mask.value?.hasPointerCapture(pointerEvent.pointerId)) {
      mask.value.releasePointerCapture(pointerEvent.pointerId)
    }
    renderMask()
    measureMask()
  }

  function undo() {
    if (!editable.value || active.value) {
      return
    }
    if (lastRemoval.value) {
      return restoreRemoval()
    }
    // 只撤销本次涂抹的笔画；已恢复或拆分得到的底层遮罩（baseMask）不是一笔操作，不能被一次 Ctrl+Z 整块清掉
    if (!strokes.value.length) {
      return
    }
    strokes.value.pop()
    invalidateRegion(selected.value)
    renderMask()
    measureMask()
  }

  function cancelDraw() {
    const id = pointer.value
    active.value = null
    pointer.value = null
    if (id !== null && mask.value?.hasPointerCapture(id)) {
      mask.value.releasePointerCapture(id)
    }
    renderMask()
    measureMask()
  }

  function clearMask() {
    if (active.value) {
      return
    }
    strokes.value = []
    selected.value.baseMask = null
    invalidateRegion(selected.value)
    renderMask()
    measureMask()
  }

  function userClearMask() {
    if (!editable.value || active.value) {
      return
    }
    const region = selected.value
    const saved = backupRegion(region)
    clearMask()
    remember(`已清空${region.annotated ? `区域 ${region.label} 的` : '当前'}遮罩`, () =>
      restoreRegion(region, saved),
    )
  }

  const canUndo = computed(() => !!lastRemoval.value || selected.value.strokes.length > 0)
  return { active, point, down, move, up, undo, cancelDraw, clearMask, userClearMask, canUndo }
}
