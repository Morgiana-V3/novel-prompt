/** 多行输入框随内容增高，长表单由外层滚动；max-height 用于聊天等有限高度输入。 */
export function autoSize(el: HTMLTextAreaElement): void {
  if (!el.getClientRects().length || !el.clientWidth) return
  const style = getComputedStyle(el)
  const border = style.boxSizing === 'border-box' ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) : 0
  const padding = style.boxSizing === 'content-box' ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0
  el.style.height = 'auto'
  el.style.height = `${Math.ceil(el.scrollHeight + border - padding)}px`
  el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? 'auto' : 'hidden'
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
  unmounted(el: HTMLTextAreaElement) { cleanup.get(el)?.(); cleanup.delete(el) }
}

export function resizeWithin(root?: HTMLElement | null): void {
  root?.querySelectorAll('textarea').forEach(autoSize)
}
