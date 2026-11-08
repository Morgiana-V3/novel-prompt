import { reactive, watch } from 'vue'

/** 生图创作「图片预览」最多显示的最近图片数；只影响界面，存本机 localStorage，不进入主进程设置 */
export const PREVIEW_LIMIT_OPTIONS = [30, 60, 100, 200] as const
const KEY = 'np-preview-limit'
const DEFAULT_LIMIT = 60

function load(): number {
  const saved = Number(localStorage.getItem(KEY))
  return (PREVIEW_LIMIT_OPTIONS as readonly number[]).includes(saved) ? saved : DEFAULT_LIMIT
}

export const previewPreferences = reactive({ recentLimit: load() })

watch(
  () => previewPreferences.recentLimit,
  (value) => {
    try {
      localStorage.setItem(KEY, String(value))
    } catch {
      // 存不下时本次会话仍按所选数量显示
    }
  },
)
