import type { Directive } from 'vue'

/**
 * 图片加载完成后再淡入（样式见 motion.css 的 img[data-fade]）。
 * 加载前露出容器的占位底色，不再「空白 → 突然出现」；已缓存的图片直接显示，不做多余动画。
 */
function arm(img: HTMLImageElement): void {
  img.dataset.fade = ''
  if (img.complete && img.naturalWidth > 0) {
    img.classList.add('img-ready')
    return
  }
  img.classList.remove('img-ready')
  const ready = () => img.classList.add('img-ready')
  img.addEventListener('load', ready, { once: true })
  img.addEventListener('error', ready, { once: true })
}

export const vFadeImg: Directive<HTMLImageElement> = {
  mounted: arm,
  updated(img, _binding, vnode, previous) {
    if (vnode.props?.src !== previous.props?.src) {
      arm(img)
    }
  },
}
