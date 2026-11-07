import type { Directive } from 'vue'

/**
 * 分段按钮（.seg）的滑动底块：选中项不再瞬间换底色，而是由一块白色底块滑过去。
 * 只读取 `.on` 按钮的位置写进 CSS 变量，动画完全由 motion.css 的 transform 过渡完成。
 * 首次定位不播放动画（避免页面进入时底块从左侧飞入），之后的切换才平滑过渡。
 */
interface SegState {
  observer: ResizeObserver
  frame: number
}

const states = new WeakMap<HTMLElement, SegState>()

function selectedButton(segment: HTMLElement): HTMLElement | null {
  return segment.querySelector<HTMLElement>(':scope > button.on, :scope > [aria-pressed="true"]')
}

function sync(segment: HTMLElement): void {
  const button = selectedButton(segment)

  // 找不到选中项（或尚未布局）时退回按钮自身的选中底色，保证选中态始终可见
  if (!button || button.offsetWidth === 0) {
    delete segment.dataset.segActive
    return
  }

  segment.style.setProperty('--seg-x', `${button.offsetLeft}px`)
  segment.style.setProperty('--seg-y', `${button.offsetTop}px`)
  segment.style.setProperty('--seg-w', `${button.offsetWidth}px`)
  segment.style.setProperty('--seg-h', `${button.offsetHeight}px`)
  segment.dataset.segActive = ''
}

export const vSegIndicator: Directive<HTMLElement> = {
  mounted(segment) {
    segment.dataset.segIndicator = ''
    sync(segment)

    const observer = new ResizeObserver(() => sync(segment))
    observer.observe(segment)

    // 首次定位完成后的下一帧才开启过渡
    const frame = requestAnimationFrame(() => {
      segment.dataset.segAnimate = ''
    })
    states.set(segment, { observer, frame })
  },
  updated(segment) {
    sync(segment)
  },
  unmounted(segment) {
    const state = states.get(segment)

    if (state) {
      cancelAnimationFrame(state.frame)
      state.observer.disconnect()
      states.delete(segment)
    }
  },
}
