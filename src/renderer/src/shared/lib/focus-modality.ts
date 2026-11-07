/**
 * 聚焦框只在 Tab 键导航时显示：按 Tab（含 Shift+Tab）后给根元素加 data-focus-ring，
 * 任何鼠标 / 触控按下即移除。方向键、Enter、弹窗自动聚焦、程序聚焦都不会单独让聚焦框出现。
 * 样式见 base.css。
 */
export function installFocusModality(): () => void {
  const root = document.documentElement

  const enableRing = (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      root.dataset.focusRing = ''
    }
  }
  const disableRing = () => {
    delete root.dataset.focusRing
  }

  window.addEventListener('keydown', enableRing, true)
  window.addEventListener('pointerdown', disableRing, true)

  return () => {
    window.removeEventListener('keydown', enableRing, true)
    window.removeEventListener('pointerdown', disableRing, true)
    disableRing()
  }
}
