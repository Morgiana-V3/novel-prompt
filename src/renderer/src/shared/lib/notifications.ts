import type { ToastAction } from '../state/shell'
import { shellState } from '../state/shell'
import { cleanErr } from './format'

export let toastTimer: ReturnType<typeof setTimeout> | undefined

/** 显示时长随字数增加；带操作按钮时停留更久，给用户反应时间 */
export function toast(msg: string, action?: ToastAction): void {
  shellState.toast = msg
  shellState.toastAction = action ?? null
  clearTimeout(toastTimer)
  const ms = Math.min(8000, Math.max(1800, 1200 + msg.length * 60)) + (action ? 3000 : 0)
  toastTimer = setTimeout(dismissToast, ms)
}

export function dismissToast(): void {
  clearTimeout(toastTimer)
  shellState.toast = ''
  shellState.toastAction = null
}

export function runToastAction(): void {
  const toastAction = shellState.toastAction
  dismissToast()
  toastAction?.run()
}

export async function copy(text: string): Promise<void> {
  await window.api.copy(text)
  toast('已复制')
}

/** Event callbacks have no caller awaiting them; keep failures visible. */
export function reportError(error: unknown): void {
  console.error(error)
  toast(cleanErr(error))
}
