import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { CanvasAsset, CanvasImage, CanvasPoint, CanvasSession, CanvasBox } from './session'
import { runningCards } from './operations'

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4
const GRID_STEP_PX = 24
const VIEWPORT_PADDING_PX = 120

interface CanvasGesture {
  mode: 'pan' | 'move' | 'resize'
  pointerId: number
  start: CanvasPoint
  origin: CanvasPoint
  originSize?: { width: number; height: number }
  aspectRatio?: number
  minWidth?: number
  maxWidth?: number
  image?: CanvasBox
}

export function useCanvasViewport(getSession: () => CanvasSession) {
  const viewport = ref<HTMLElement>()
  const size = reactive({ width: 0, height: 0 })
  const gestureType = ref<'pan' | 'move' | 'resize'>()
  let resizeObserver: ResizeObserver | undefined
  let gesture: CanvasGesture | undefined
  let pendingPoint: CanvasPoint | undefined
  let frame = 0

  const center = computed(() => ({ x: size.width / 2, y: size.height / 2 }))
  const zoom = computed(() => getSession().camera.zoom)
  const origin = computed(() => ({
    x: center.value.x + getSession().camera.x,
    y: center.value.y + getSession().camera.y,
  }))
  const canvasBackground = computed(() => {
    const gridZoom = Math.pow(2, Math.floor(Math.log2(zoom.value)))
    const step = (GRID_STEP_PX * zoom.value) / gridZoom
    return {
      backgroundSize: `${step}px ${step}px`,
      backgroundPosition: `${origin.value.x % step}px ${origin.value.y % step}px`,
    }
  })

  function getImageBounds(image: CanvasBox) {
    return {
      left: image.x * zoom.value + origin.value.x,
      top: image.y * zoom.value + origin.value.y,
      width: image.width * zoom.value,
      height: image.height * zoom.value,
    }
  }

  const visibleImages = computed(() =>
    getSession().images.flatMap((image) => {
      const bounds = getImageBounds(image)
      const isVisible =
        bounds.left <= size.width + VIEWPORT_PADDING_PX &&
        bounds.top <= size.height + VIEWPORT_PADDING_PX &&
        bounds.left + bounds.width >= -VIEWPORT_PADDING_PX &&
        bounds.top + bounds.height >= -VIEWPORT_PADDING_PX
      return isVisible ? [{ image, bounds }] : []
    }),
  )

  function focusViewport() {
    viewport.value?.focus({ preventScroll: true })
  }

  function localPoint(event: MouseEvent): CanvasPoint {
    const bounds = viewport.value?.getBoundingClientRect()
    return {
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    }
  }

  function worldPoint(event?: MouseEvent) {
    const point = event ? localPoint(event) : center.value
    return {
      x: (point.x - origin.value.x) / zoom.value,
      y: (point.y - origin.value.y) / zoom.value,
    }
  }

  function setZoom(next: number, anchor = center.value) {
    if (gesture) {
      return
    }
    const camera = getSession().camera
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    const ratio = nextZoom / camera.zoom
    camera.x += (anchor.x - origin.value.x) * (1 - ratio)
    camera.y += (anchor.y - origin.value.y) * (1 - ratio)
    camera.zoom = nextZoom
  }

  function zoomBy(factor: number) {
    setZoom(zoom.value * factor)
  }

  function zoomAtPointer(event: WheelEvent) {
    let delta = event.deltaY
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      delta *= 16
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      delta *= size.height
    }
    const factor = Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.0015)
    setZoom(zoom.value * factor, localPoint(event))
  }

  function fitImages(availableWidth: number, selection?: CanvasBox[]) {
    const session = getSession()
    const camera = session.camera
    const boxes = selection ?? [...session.images, ...session.operations]
    if (!boxes.length) {
      Object.assign(camera, { x: 0, y: 0, zoom: 1 })
      return
    }

    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    for (const image of boxes) {
      left = Math.min(left, image.x)
      right = Math.max(right, image.x + image.width)
      top = Math.min(top, image.y - 32)
      bottom = Math.max(bottom, image.y + image.height)
    }
    const margin = 96
    const fitZoom = Math.min(
      1,
      (availableWidth - margin) / (right - left),
      (size.height - margin) / (bottom - top),
    )
    camera.zoom = Math.max(MIN_ZOOM, fitZoom)
    camera.x = (availableWidth - size.width) / 2 - ((left + right) / 2) * camera.zoom
    camera.y = (-(top + bottom) / 2) * camera.zoom
  }

  function selectImage(image?: CanvasBox) {
    getSession().selectedId = image?.id ?? null
  }

  function addImage(asset: CanvasAsset, availableWidth = size.width, atPoint?: CanvasPoint) {
    const session = getSession()
    const widthPx = asset.width ?? 0
    const heightPx = asset.height ?? 0
    const aspectRatio = widthPx > 0 && heightPx > 0 ? widthPx / heightPx : 1
    const maxSide = 300
    const width = maxSide * Math.min(1, aspectRatio)
    const height = maxSide / Math.max(1, aspectRatio)
    const offset = (session.images.length % 6) * 24
    const x = atPoint
      ? atPoint.x - width / 2
      : (availableWidth / 2 + offset - origin.value.x) / zoom.value - width / 2
    const y = atPoint
      ? atPoint.y - height / 2
      : (center.value.y + offset - origin.value.y) / zoom.value - height / 2
    const image: CanvasImage = { id: session.nextImageId, asset, x, y, width, height }

    session.nextImageId += 1
    session.images.push(image)
    selectImage(image)
  }

  function removeSelected() {
    const session = getSession()
    if (
      session.operations.some(
        (node) =>
          runningCards.has(node) &&
          (node.id === session.selectedId || node.sourceId === session.selectedId),
      )
    ) {
      return
    }
    session.operations = session.operations.filter((node) => node.id !== session.selectedId)
    for (const node of session.operations) {
      if (node.sourceId === session.selectedId) {
        node.sourceId = null
        node.strokes = []
      }
    }
    session.images = session.images.filter((image) => image.id !== session.selectedId)
    selectImage()
    focusViewport()
  }

  function beginGesture(event: PointerEvent, image?: CanvasBox) {
    if (!viewport.value || gesture || (event.button !== 0 && event.button !== 1)) {
      return
    }
    event.preventDefault()
    focusViewport()
    const start = localPoint(event)
    const session = getSession()
    const movingImage = event.button === 0 ? image : undefined
    const target = movingImage ?? session.camera
    if (event.button === 0) {
      selectImage(movingImage)
    }
    gesture = {
      mode: movingImage ? 'move' : 'pan',
      pointerId: event.pointerId,
      start,
      origin: { x: target.x, y: target.y },
      image: movingImage,
    }
    gestureType.value = gesture.mode
    viewport.value.setPointerCapture(event.pointerId)
  }

  function beginResize(
    event: PointerEvent,
    box: CanvasBox,
    aspectRatio: number,
    minWidth = 120,
    maxWidth = 1400,
  ) {
    if (!viewport.value || gesture || event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    focusViewport()
    selectImage(box)
    const safeRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
    gesture = {
      mode: 'resize',
      pointerId: event.pointerId,
      start: localPoint(event),
      origin: { x: box.x, y: box.y },
      originSize: { width: box.width, height: box.height },
      aspectRatio: safeRatio,
      minWidth,
      maxWidth,
      image: box,
    }
    gestureType.value = 'resize'
    viewport.value.setPointerCapture(event.pointerId)
  }

  function applyGesture(point: CanvasPoint) {
    if (!gesture) {
      return
    }
    if (gesture.mode === 'resize' && gesture.image && gesture.originSize && gesture.aspectRatio) {
      const deltaX = (point.x - gesture.start.x) / zoom.value
      const minW = gesture.minWidth ?? 120
      const maxW = gesture.maxWidth ?? 1400
      const nextWidth = Math.max(
        minW,
        Math.min(maxW, Math.round(gesture.originSize.width + deltaX)),
      )
      gesture.image.width = nextWidth
      gesture.image.height = nextWidth / gesture.aspectRatio
      return
    }
    const target = gesture.image ?? getSession().camera
    const scale = gesture.image ? zoom.value : 1
    target.x = gesture.origin.x + (point.x - gesture.start.x) / scale
    target.y = gesture.origin.y + (point.y - gesture.start.y) / scale
  }

  function trackGesture(event: PointerEvent) {
    if (gesture?.pointerId !== event.pointerId) {
      return
    }
    pendingPoint = localPoint(event)
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0
        if (pendingPoint) {
          applyGesture(pendingPoint)
        }
      })
    }
  }

  function clearGesture() {
    const pointerId = gesture?.pointerId
    gesture = undefined
    gestureType.value = undefined
    pendingPoint = undefined
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    if (pointerId !== undefined && viewport.value?.hasPointerCapture(pointerId)) {
      viewport.value.releasePointerCapture(pointerId)
    }
  }

  function finishGesture(event: PointerEvent) {
    if (gesture?.pointerId === event.pointerId) {
      applyGesture(localPoint(event))
      clearGesture()
    }
  }

  function cancelGesture(event?: PointerEvent) {
    if (gesture && (!event || event.pointerId === gesture.pointerId)) {
      if (gesture.mode === 'resize' && gesture.image && gesture.originSize) {
        Object.assign(gesture.image, gesture.originSize)
      } else {
        applyGesture(gesture.start)
      }
      clearGesture()
      return true
    }
    return false
  }

  onMounted(() => {
    if (!viewport.value) {
      return
    }
    size.width = viewport.value.clientWidth
    size.height = viewport.value.clientHeight
    resizeObserver = new ResizeObserver(([entry]) => {
      size.width = entry.contentRect.width
      size.height = entry.contentRect.height
    })
    resizeObserver.observe(viewport.value)
    focusViewport()
  })

  onBeforeUnmount(() => {
    clearGesture()
    resizeObserver?.disconnect()
  })

  return {
    viewport,
    size,
    zoom,
    canvasBackground,
    visibleImages,
    worldPoint,
    getImageBounds,
    gestureType,
    focusViewport,
    setZoom,
    zoomBy,
    zoomAtPointer,
    fitImages,
    selectImage,
    addImage,
    removeSelected,
    beginGesture,
    beginResize,
    trackGesture,
    finishGesture,
    cancelGesture,
  }
}
