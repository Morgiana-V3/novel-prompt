/**
 * 标签 / 分段按钮行：宽度不够时不换行，改为单行横向滚动。
 * - 隐藏滚动条，鼠标竖向滚轮在这一行上换算成横向滚动；
 * - 还有内容被挡住的一侧加渐隐，提示可以继续滚；
 * - 选中项变化时把它滚进可视范围，不牵动外层页面的滚动。
 */
const SELECTED = '[aria-selected="true"], .on, .active'
const cleanup = new WeakMap<HTMLElement, () => void>()

function updateEdges(el: HTMLElement) {
  const max = el.scrollWidth - el.clientWidth
  el.toggleAttribute('data-fade-start', max > 1 && el.scrollLeft > 1)
  el.toggleAttribute('data-fade-end', max > 1 && el.scrollLeft < max - 1)
}

function revealSelected(el: HTMLElement) {
  const item = el.querySelector<HTMLElement>(SELECTED)
  if (!item || el.scrollWidth <= el.clientWidth) {
    return
  }
  const left = item.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
  const right = left + item.offsetWidth
  if (left < el.scrollLeft + 24) {
    el.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' })
  } else if (right > el.scrollLeft + el.clientWidth - 24) {
    el.scrollTo({ left: right - el.clientWidth + 24, behavior: 'smooth' })
  }
}

export const vScrollRow = {
  mounted(el: HTMLElement) {
    el.classList.add('scroll-row')
    const wheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return
      }
      event.preventDefault()
      el.scrollLeft += event.deltaY
    }
    const edges = () => updateEdges(el)
    const observer = new ResizeObserver(edges)
    observer.observe(el)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('scroll', edges, { passive: true })
    edges()
    cleanup.set(el, () => {
      observer.disconnect()
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('scroll', edges)
    })
  },
  updated(el: HTMLElement) {
    updateEdges(el)
    revealSelected(el)
  },
  unmounted(el: HTMLElement) {
    cleanup.get(el)?.()
    cleanup.delete(el)
  },
}
