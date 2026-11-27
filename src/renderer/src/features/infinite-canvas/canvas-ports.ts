import type { CanvasPoint } from './session'
import type { ScreenRect } from './use-canvas-overlay'

export const PORT_OFFSET = 14
export const PORT_SIDES = ['left', 'right'] as const
export type PortSide = (typeof PORT_SIDES)[number]
const MAGNET_RADIUS = 38
const MAX_PULL = 11

export interface PortPull extends CanvasPoint {
  id: number
  side: PortSide
}

export function portCenter(bounds: ScreenRect, side: PortSide): CanvasPoint {
  const x = side === 'left' ? bounds.left - PORT_OFFSET : bounds.left + bounds.width + PORT_OFFSET
  return { x, y: bounds.top + bounds.height / 2 }
}

export function edgePoint(bounds: ScreenRect, side: PortSide): CanvasPoint {
  const x = side === 'left' ? bounds.left : bounds.left + bounds.width
  return { x, y: bounds.top + bounds.height / 2 }
}

export function nearestPort(pointer: CanvasPoint, nodes: { id: number; bounds: ScreenRect }[]) {
  let best = MAGNET_RADIUS
  let nearest: PortPull | undefined
  for (const { id, bounds } of nodes) {
    for (const side of PORT_SIDES) {
      const center = portCenter(bounds, side)
      const dx = pointer.x - center.x
      const dy = pointer.y - center.y
      const distance = Math.hypot(dx, dy)
      if (distance >= best) {
        continue
      }
      best = distance
      const t = Math.min(1, (MAGNET_RADIUS - distance) / (MAGNET_RADIUS - MAX_PULL))
      const factor = distance <= MAX_PULL ? 1 : (MAX_PULL / distance) * t * t * (3 - 2 * t)
      nearest = { id, side, x: dx * factor, y: dy * factor }
    }
  }
  return nearest
}
