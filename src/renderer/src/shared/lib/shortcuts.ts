import { onBeforeUnmount, onMounted } from 'vue'
import { shellState, type Tab } from '../state/shell'

/** 有弹窗或浮层打开时，页面级快捷键不生效，避免在弹窗里按键却触发了背后的页面 */
const OVERLAY =
  '[aria-modal="true"], .pos-mask, .ip-mask, .sk-mask, .sp-mask, .theme-select-menu, .task-panel, .history-menu'

export const isMac = navigator.platform.toLowerCase().includes('mac')
export const runKeyLabel = isMac ? '⌘ Enter' : 'Ctrl + Enter'
/** 放在按钮里的简写 */
export const runKeyShort = isMac ? '⌘ ↵' : 'Ctrl ↵'

/**
 * 当前页面的主操作快捷键：Ctrl/⌘ + Enter 执行，Esc 取消正在运行的任务。
 * 只在对应页签可见、且没有弹窗时响应；在输入框里也能用（写完提示词直接执行）。
 */
export function usePageShortcuts(
  tab: Tab,
  actions: { run: () => void; cancel?: () => void; canCancel?: () => boolean },
): void {
  function onKey(event2: KeyboardEvent) {
    if (shellState.tab !== tab || event2.isComposing || document.querySelector(OVERLAY)) {
      return
    }
    if (document.querySelector('.content[inert]')) {
      return
    }
    if (
      event2.key === 'Enter' &&
      (event2.ctrlKey || event2.metaKey) &&
      !event2.shiftKey &&
      !event2.altKey
    ) {
      event2.preventDefault()
      actions.run()
    } else if (event2.key === 'Escape' && actions.cancel && actions.canCancel?.()) {
      event2.preventDefault()
      actions.cancel()
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
