import { shallowRef } from 'vue'
import type { CanvasGalleryAsset, CanvasPoint, CanvasTool } from './session'
import type { FavoriteMaterial } from './use-canvas-favorites'

export type CanvasDragItem =
  | { kind: 'tool'; tool: CanvasTool }
  | { kind: 'gallery'; asset: CanvasGalleryAsset }
  | { kind: 'favorite'; material: FavoriteMaterial }

export const activeCanvasDrag = shallowRef<CanvasDragItem | null>(null)
export const canvasDragPointer = shallowRef<CanvasPoint | null>(null)

function trackCanvasDrag(event: DragEvent) {
  canvasDragPointer.value = { x: event.clientX, y: event.clientY }
}

function handleDragLeaveWindow(event: DragEvent) {
  if (!event.relatedTarget) {
    canvasDragPointer.value = null
  }
}

export function hideNativeDragImage(transfer: DataTransfer) {
  const transparent = document.createElement('canvas')
  transparent.width = 1
  transparent.height = 1
  transparent.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none'
  document.body.append(transparent)
  transfer.setDragImage(transparent, 0, 0)
  requestAnimationFrame(() => transparent.remove())
}

export function clearCanvasDrag() {
  activeCanvasDrag.value = null
  canvasDragPointer.value = null
  window.removeEventListener('dragover', trackCanvasDrag, true)
  window.removeEventListener('dragleave', handleDragLeaveWindow, true)
  window.removeEventListener('dragend', clearCanvasDrag, true)
}

export function writeCanvasDrag(event: DragEvent, item: CanvasDragItem) {
  const transfer = event.dataTransfer
  if (!transfer) {
    return
  }
  activeCanvasDrag.value = item
  trackCanvasDrag(event)
  transfer.effectAllowed = 'copy'
  hideNativeDragImage(transfer)
  window.addEventListener('dragover', trackCanvasDrag, true)
  window.addEventListener('dragleave', handleDragLeaveWindow, true)
  window.addEventListener('dragend', clearCanvasDrag, true)
}
