import type { CanvasBox, CanvasSession } from './session'
export function freePosition(session: CanvasSession, box: Omit<CanvasBox, 'id'> & { id?: number }) {
  let x = box.x
  const row = [...session.operations, ...session.images]
    .filter((other) => other.id !== box.id)
    .filter((other) => other.y < box.y + box.height + 24 && other.y + other.height + 24 > box.y)
    .sort((a, b) => a.x - b.x)
  for (const other of row) {
    if (x + box.width + 24 <= other.x) {
      break
    }
    if (x < other.x + other.width + 24) {
      x = other.x + other.width + 36
    }
  }
  return x
}
