import { createTextareaMirror } from './textarea-highlights'

/** Measure the selected text, not the whole (potentially very tall) input. */
export function revealTextareaRange(input: HTMLTextAreaElement, start: number, end: number) {
  const mirror = createTextareaMirror(input)
  const marker = document.createElement('span')
  marker.textContent = input.value.slice(start, end) || '\u200b'
  mirror.append(input.value.slice(0, start), marker, input.value.slice(end))
  document.body.append(mirror)
  const measured = marker.getBoundingClientRect()
  const origin = mirror.getBoundingClientRect()
  const bounds = input.getBoundingClientRect()
  let top = bounds.top + input.clientTop + measured.top - origin.top - input.scrollTop
  let bottom = top + measured.height
  mirror.remove()

  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  for (let node: HTMLElement | null = input; node; node = node.parentElement) {
    if (
      node.scrollHeight <= node.clientHeight ||
      !/(auto|scroll|hidden)/.test(getComputedStyle(node).overflowY)
    ) {
      continue
    }
    const box = node.getBoundingClientRect()
    const visibleTop = box.top + node.clientTop + 8
    const visibleBottom = box.top + node.clientTop + node.clientHeight - 8
    let delta = 0
    if (top < visibleTop || bottom > visibleBottom) {
      delta = (top + bottom) / 2 - (visibleTop + visibleBottom) / 2
      if (bottom - top > visibleBottom - visibleTop) {
        delta = top - visibleTop
      }
    }
    const next = Math.max(
      0,
      Math.min(node.scrollHeight - node.clientHeight, node.scrollTop + delta),
    )
    const movement = next - node.scrollTop
    if (movement) {
      node.scrollTo({ top: next, behavior })
      top -= movement
      bottom -= movement
    }
  }
}
