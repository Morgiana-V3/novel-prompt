import { computed, ref } from 'vue'
import { toast } from '../../shared/lib/notifications'
import { checkUpdate, settingsState } from './state'
import { updateLabel } from './updates'

export function useUpdateSettings() {
  /* ---------- 版本与更新 ---------- */
  const checking = ref(false)

  const versionText = computed(() => updateLabel(settingsState.update))

  const updateSub = computed(() => {
    const update = settingsState.update
    if (!update) {
      return ''
    }
    if (update.error) {
      return `更新失败：${update.error}`
    }
    if (update.manualReason) {
      return update.manualReason
    }
    const at = update.checkedAt
      ? new Date(update.checkedAt).toLocaleString(undefined, {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : ''
    const parts = [`当前 v${update.current}`, at && `检查于 ${at}`]
    return parts.filter(Boolean).join(' · ')
  })

  async function runCheck() {
    checking.value = true
    await checkUpdate(true)
    checking.value = false
    const resolveValue = () => {
      if (settingsState.update?.error) {
        return '检查失败，可能是网络问题' as const
      }
      if (settingsState.update?.newer) {
        return `发现新版本 ${settingsState.update.latest}`
      }
      return '已是最新版本' as const
    }
    toast(resolveValue())
  }
  return { checking, versionText, updateSub, runCheck }
}
