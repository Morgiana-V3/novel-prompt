import { nextTick, onBeforeUnmount } from 'vue'
import type { DesktopState } from '@shared/contracts/desktop'

/** One expiring screenshot lease owns masking and restores it on failure or unmount. */
export function useCapturePrivacy(desktopSnapshot: () => DesktopState) {
  let captureLease = ''
  let captureStyle: HTMLStyleElement | null = null
  let captureTimer: ReturnType<typeof setTimeout> | undefined
  function endCapture(lease = captureLease) {
    if (lease !== captureLease) {
      return
    }
    clearTimeout(captureTimer)
    captureStyle?.remove()
    captureStyle = null
    captureLease = ''
  }
  async function prepareCapture(lease: string) {
    if (!lease || captureLease) {
      throw new Error('截图准备尚未完成，请稍后重试')
    }
    captureLease = lease
    const selector = 'input[type="password"], [data-mcp-private]'
    const privateElements = [...document.querySelectorAll(selector)].filter(
      (el) => el.getClientRects().length > 0,
    )
    const redactedFields = privateElements.length
    const redactions = privateElements
      .flatMap((el) => [el, ...el.querySelectorAll('*')])
      .flatMap((el) =>
        [...el.getClientRects()].map((bounds) => ({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        })),
      )
    captureStyle = document.createElement('style')
    captureStyle.id = 'np-mcp-capture-privacy'
    captureStyle.textContent = `${selector}, [data-mcp-private] * { visibility: hidden !important; }`
    document.head.append(captureStyle)
    const expiresAt = Date.now() + 10000
    captureTimer = setTimeout(() => endCapture(lease), 10000)
    try {
      await nextTick()
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('界面尚未绘制，请显示窗口后重试')), 1500)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            clearTimeout(timer)
            resolve()
          }),
        )
      })
      return {
        desktop: desktopSnapshot(),
        redactedFields,
        redactions,
        expiresAt,
        viewport: {
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
      }
    } catch (error) {
      endCapture(lease)
      throw error
    }
  }
  onBeforeUnmount(() => endCapture())
  return { prepareCapture, endCapture }
}
