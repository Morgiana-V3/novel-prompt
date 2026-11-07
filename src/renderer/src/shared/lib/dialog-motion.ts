/**
 * 原生 <dialog> 的退场：motion.css 用 transition + allow-discrete 让 close() 后仍播完缩小淡出。
 * 由父组件 v-if 卸载的对话框（确认框、模型管理）需要先 close() 播放退场，再通知父组件卸载，
 * 否则元素被直接移除，退场动画来不及播放。
 */
/** 与 motion.css 的 --dur-jelly-out（0.26s）保持一致，略留余量 */
export const DIALOG_EXIT_MS = 280

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isOutside(event: MouseEvent): boolean {
  const dialog = event.currentTarget as HTMLElement
  if (event.target !== dialog) {
    return false
  }
  const rect = dialog.getBoundingClientRect()
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
}

/**
 * 点击遮罩（原生 dialog 外部）关闭：按下和松开都落在对话框外才算，
 * 避免点到对话框内边距、或在输入框里拖选文字拖到外面松手时误关。
 * 用法：const backdrop = backdropCloser(close)，模板里绑定 @pointerdown 与 @click。
 */
export function backdropCloser(close: () => void) {
  let pressedOutside = false
  return {
    onPointerdown(event: PointerEvent) {
      pressedOutside = isOutside(event)
    },
    onClick(event: MouseEvent) {
      const releasedOutside = isOutside(event)
      const shouldClose = pressedOutside && releasedOutside
      pressedOutside = false
      if (shouldClose) {
        close()
      }
    },
  }
}

export function closeDialogThen(dialog: HTMLDialogElement | undefined, done: () => void): void {
  if (!dialog?.open) {
    done()
    return
  }

  dialog.close()

  if (prefersReducedMotion()) {
    done()
    return
  }
  setTimeout(done, DIALOG_EXIT_MS)
}
