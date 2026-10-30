import { reactive } from 'vue'

export type Tab =
  | 'compare'
  | 'ai'
  | 'preview'
  | 'generate'
  | 'reverse'
  | 'workspace'
  | 'search'
  | 'settings'
  | 'favorites'

export const shellState = reactive({
  tab: 'compare' as Tab,

  toast: '',

  /** 提示条上的操作按钮（如「撤销」），提示消失时一起清除 */
  toastAction: null as ToastAction | null,
})

export interface ToastAction {
  label: string
  run: () => void
}
