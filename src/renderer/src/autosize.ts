const metrics = ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','textIndent','textTransform','whiteSpace','overflowWrap','wordBreak','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft'] as const
let measure: HTMLTextAreaElement | undefined
const measured = new WeakMap<HTMLTextAreaElement, string>()

/** Measure away from the form: collapsing the live textarea resets its parent's scroll position. */
export function autoSize(el: HTMLTextAreaElement): void {
  if (!el.getClientRects().length || !el.clientWidth) return
  const style = getComputedStyle(el)
  const key = JSON.stringify([el.value, el.placeholder, el.clientWidth, el.wrap, style.boxSizing, style.minHeight, style.maxHeight, ...metrics.map(p => style[p])])
  if (measured.get(el) === key) return
  if (!measure?.isConnected) {
    measure = document.createElement('textarea')
    measure.tabIndex = -1; measure.setAttribute('aria-hidden', 'true')
    measure.style.cssText = 'position:fixed;left:-10000px;top:0;height:0;min-height:0;max-height:none;border:0;box-sizing:border-box;overflow:hidden;visibility:hidden;pointer-events:none;resize:none;'
    document.body.appendChild(measure)
  }
  for (const property of metrics) measure.style[property] = style[property]
  measure.style.width = `${el.clientWidth}px`
  measure.wrap = el.wrap; measure.value = el.value; measure.placeholder = el.placeholder
  const border = style.boxSizing === 'border-box' ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) : 0
  const padding = style.boxSizing === 'content-box' ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0
  el.style.height = `${Math.ceil(measure.scrollHeight + border - padding)}px`
  el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? 'auto' : 'hidden'
  measured.set(el, key)
}

const cleanup = new WeakMap<HTMLTextAreaElement, () => void>()
export const vAutosize = {
  mounted(el: HTMLTextAreaElement) {
    el.classList.add('autosize')
    const input = () => autoSize(el)
    let width = -1, frame = 0
    const observer = new ResizeObserver(() => {
      // Only width changes require rewrapping; observing our own height would loop.
      if (el.clientWidth === width) return
      width = el.clientWidth
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(input)
    })
    el.addEventListener('input', input)
    observer.observe(el)
    autoSize(el)
    cleanup.set(el, () => { el.removeEventListener('input', input); observer.disconnect(); cancelAnimationFrame(frame) })
  },
  updated: autoSize,
  unmounted(el: HTMLTextAreaElement) { cleanup.get(el)?.(); cleanup.delete(el); measured.delete(el) }
}

export function resizeWithin(root?: HTMLElement | null): void {
  root?.querySelectorAll('textarea').forEach(autoSize)
}
