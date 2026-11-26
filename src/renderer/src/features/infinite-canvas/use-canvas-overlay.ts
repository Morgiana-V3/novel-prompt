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

function useMeasuredSize(elementRef: Ref<HTMLElement | null>) {
  const measured = shallowRef<BoxSize>()

  watch(
    elementRef,
    (element, _previous, onCleanup) => {
      measured.value = undefined
      if (!element) {
        return
      }
      const update = () => {
        measured.value = {
          width: element.offsetWidth,
          height: element.offsetHeight,
        }
      }
      update()
      const observer = new ResizeObserver(update)
      observer.observe(element)
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
  const panelSize = useMeasuredSize(panelRef)

  return computed(() => {
    const anchor = getAnchor()
    const viewport = getViewportSize()
    const safeLeft = Math.min(70, viewport.width / 5)
    const safeRight = Math.max(safeLeft + 1, viewport.width - 14)
    const safeTop = 54
    const safeBottom = Math.max(safeTop + 1, viewport.height - 54)
    const maxW = Math.max(120, safeRight - safeLeft)
    const maxH = Math.max(120, safeBottom - safeTop)
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
    const belowY = anchor.top + anchor.height + 12
    const belowRoom = safeBottom - belowY
    if (belowRoom >= Math.min(desiredHeight, 220)) {
      const candidate: ScreenRect = {
        left: centeredPanelLeft,
        top: belowY,
        width: panelWidth,
        height: Math.min(desiredHeight, belowRoom),
      }
      if (!overlaps(candidate, barRect)) {
        return {
          bar: barStyle,
          panel: {
            left: `${Math.round(candidate.left)}px`,
            top: `${Math.round(candidate.top)}px`,
            maxWidth: `${Math.round(maxW)}px`,
            maxHeight: `${Math.round(belowRoom)}px`,
          },
        }
      }
    }

    // 2. Try opening to the right or left of the box
    const sideTop = clamp(anchor.top, safeTop, safeBottom - desiredHeight)
    const sideCandidates: ScreenRect[] = [
      {
        left: anchor.left + anchor.width + 12,
        top: sideTop,
        width: panelWidth,
        height: desiredHeight,
      },
      {
        left: anchor.left - panelWidth - 12,
        top: sideTop,
        width: panelWidth,
        height: desiredHeight,
      },
    ]

    for (const candidate of sideCandidates) {
      const fitsHorizontally =
        candidate.left >= safeLeft && candidate.left + candidate.width <= safeRight
      if (fitsHorizontally && !overlaps(candidate, barRect)) {
        return {
          bar: barStyle,
          panel: {
            left: `${Math.round(candidate.left)}px`,
            top: `${Math.round(candidate.top)}px`,
            maxWidth: `${Math.round(maxW)}px`,
            maxHeight: `${Math.round(maxH)}px`,
          },
        }
      }
    }

    // 3. Guaranteed fallback: open directly below (or above) the toolbar itself
    const roomBelowBar = safeBottom - (barTop + barHeight + 8)
    const roomAboveBar = barTop - 8 - safeTop
    const placeBelowBar = roomBelowBar >= roomAboveBar || roomBelowBar >= 220
    const fallbackRoom = Math.max(140, placeBelowBar ? roomBelowBar : roomAboveBar)
    const fallbackTop = placeBelowBar
      ? barTop + barHeight + 8
      : Math.max(safeTop, barTop - 8 - Math.min(desiredHeight, fallbackRoom))

    return {
      bar: barStyle,
      panel: {
        left: `${Math.round(centeredPanelLeft)}px`,
        top: `${Math.round(fallbackTop)}px`,
        maxWidth: `${Math.round(maxW)}px`,
        maxHeight: `${Math.round(fallbackRoom)}px`,
      },
    }
  })
}
