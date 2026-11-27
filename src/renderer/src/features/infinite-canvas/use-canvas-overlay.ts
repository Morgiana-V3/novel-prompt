import { computed, shallowRef, watch, type CSSProperties, type Ref } from 'vue'

export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

export interface ViewportExtent {
  width: number
  height: number
}

interface BoxSize {
  width: number
  height: number
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min
  }
  return Math.max(min, Math.min(value, max))
}

function overlaps(first: ScreenRect, second: ScreenRect, padding = 6) {
  return !(
    first.left + first.width + padding <= second.left ||
    first.left >= second.left + second.width + padding ||
    first.top + first.height + padding <= second.top ||
    first.top >= second.top + second.height + padding
  )
}

function useMeasuredSize(elementRef: Ref<HTMLElement | null>, panel = false) {
  const measured = shallowRef<BoxSize>()

  watch(
    elementRef,
    (element, _previous, onCleanup) => {
      measured.value = undefined
      if (!element) {
        return
      }
      const scroller = element.querySelector<HTMLElement>('.tool-panel-scroll')
      const update = () => {
        let height = element.offsetHeight
        if (scroller) {
          height += Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        } else if (panel) {
          height = Math.max(height, element.scrollHeight)
        }
        const width = Math.round(element.offsetWidth)
        height = Math.round(height)
        if (
          !measured.value ||
          width !== measured.value.width ||
          Math.abs(height - measured.value.height) >= 2
        ) {
          measured.value = { width, height }
        }
      }
      update()
      const observer = new ResizeObserver(update)
      observer.observe(element)
      if (scroller?.firstElementChild) {
        observer.observe(scroller.firstElementChild)
      }
      onCleanup(() => observer.disconnect())
    },
    { flush: 'post' },
  )

  return measured
}

export function useCanvasOverlayPlacement(
  getAnchor: () => ScreenRect | null,
  getViewportSize: () => ViewportExtent,
  getCaptionHeight: () => number,
  barRef: Ref<HTMLElement | null>,
  panelRef: Ref<HTMLElement | null>,
) {
  const barSize = useMeasuredSize(barRef)
  const panelSize = useMeasuredSize(panelRef, true)

  return computed(() => {
    const anchor = getAnchor()
    const viewport = getViewportSize()
    const safeLeft = Math.round(Math.min(70, viewport.width / 5))
    const safeRight = Math.max(safeLeft + 1, Math.round(viewport.width) - 14)
    const safeTop = Math.round(Math.min(54, viewport.height / 4))
    const safeBottom = Math.max(safeTop + 1, Math.round(viewport.height) - safeTop)
    const maxW = safeRight - safeLeft
    const maxH = safeBottom - safeTop
    const hidden: CSSProperties = {
      visibility: 'hidden',
      maxWidth: `${maxW}px`,
      maxHeight: `${maxH}px`,
    }

    if (
      !anchor ||
      !barSize.value ||
      anchor.left + anchor.width < 0 ||
      anchor.top + anchor.height < 0 ||
      anchor.left > viewport.width ||
      anchor.top > viewport.height
    ) {
      return { bar: hidden, panel: hidden }
    }

    const barWidth = Math.min(barSize.value.width, maxW)
    const barHeight = barSize.value.height
    const centerX = anchor.left + anchor.width / 2
    const barLeft = clamp(centerX - barWidth / 2, safeLeft, safeRight - barWidth)
    const aboveTop = anchor.top - getCaptionHeight() - 10 - barHeight
    const belowBoxTop = anchor.top + anchor.height + 10

    let barTop = safeTop
    if (aboveTop >= safeTop) {
      barTop = aboveTop
    } else if (belowBoxTop + barHeight <= safeBottom) {
      barTop = belowBoxTop
    }

    barTop = clamp(Math.round(barTop), safeTop, safeBottom - barHeight)
    const barRect: ScreenRect = {
      left: barLeft,
      top: barTop,
      width: barWidth,
      height: barHeight,
    }
    const barStyle: CSSProperties = {
      left: `${Math.round(barLeft)}px`,
      top: `${Math.round(barTop)}px`,
      maxWidth: `${Math.round(maxW)}px`,
    }

    if (!panelSize.value) {
      return { bar: barStyle, panel: hidden }
    }

    const panelWidth = Math.min(panelSize.value.width, maxW)
    const desiredHeight = Math.min(panelSize.value.height, maxH)
    const centeredPanelLeft = clamp(centerX - panelWidth / 2, safeLeft, safeRight - panelWidth)

    // 1. Prefer opening downward directly below the selected box
    const belowY = clamp(Math.round(anchor.top + anchor.height + 12), safeTop, safeBottom)
    const belowRoom = safeBottom - belowY
    if (belowRoom >= Math.min(desiredHeight, 220)) {
      const candidate: ScreenRect = {
        left: centeredPanelLeft,
        top: belowY,
        width: panelWidth,
        height: Math.min(desiredHeight, belowRoom),
      }
      if (!overlaps(candidate, barRect)) {
        return placePanel(candidate.left, candidate.top, safeBottom)
      }
    }

    function placePanel(left: number, top: number, bottom: number) {
      const y = clamp(Math.round(top), safeTop, safeBottom)
      return {
        bar: barStyle,
        panel: {
          left: `${clamp(Math.round(left), safeLeft, safeRight - panelWidth)}px`,
          top: `${y}px`,
          maxWidth: `${maxW}px`,
          maxHeight: `${clamp(Math.round(bottom) - y, 0, safeBottom - y)}px`,
        },
      }
    }

    const belowBar = barTop + barHeight + 8
    const aboveBar = barTop - 8
    for (const left of [anchor.left + anchor.width + 12, anchor.left - panelWidth - 12]) {
      if (left < safeLeft || left + panelWidth > safeRight) {
        continue
      }
      let minTop = safeTop
      let bottom = safeBottom
      if (left < barLeft + barWidth + 6 && left + panelWidth + 6 > barLeft) {
        const minimumRoom = Math.min(180, desiredHeight)
        const preferBelow = barTop <= anchor.top || aboveBar - safeTop < minimumRoom
        if (preferBelow && safeBottom - belowBar >= minimumRoom) {
          minTop = belowBar
        } else {
          bottom = aboveBar
        }
        if (bottom - minTop < minimumRoom) {
          continue
        }
      }
      const top = clamp(anchor.top, minTop, bottom - desiredHeight)
      return placePanel(left, top, bottom)
    }

    const roomBelow = safeBottom - belowBar
    if (roomBelow >= aboveBar - safeTop || roomBelow >= 220) {
      return placePanel(centeredPanelLeft, belowBar, safeBottom)
    }
    return placePanel(centeredPanelLeft, Math.max(safeTop, aboveBar - desiredHeight), aboveBar)
  })
}
