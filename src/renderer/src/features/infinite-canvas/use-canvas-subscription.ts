import { computed, reactive } from 'vue'
import type { NaiSubscription } from '@shared/generation/types'
import { cleanErr } from '../../shared/lib/format'

export const canvasSubscriptionState = reactive({
  subscription: null as NaiSubscription | null,
  loading: false,
  error: '',
  updatedAt: 0,
})

let activeRequest: Promise<void> | undefined

export function refreshCanvasSubscription(force = false): Promise<void> {
  if (typeof window.canvasApi?.naiSubscription !== 'function') {
    return Promise.resolve()
  }
  if (activeRequest && !force) {
    return activeRequest
  }
  canvasSubscriptionState.loading = true
  canvasSubscriptionState.error = ''
  const request = window.canvasApi
    .naiSubscription()
    .then((account) => {
      canvasSubscriptionState.subscription = account
      canvasSubscriptionState.updatedAt = Date.now()
    })
    .catch((reason) => {
      canvasSubscriptionState.error = cleanErr(reason)
    })
    .finally(() => {
      canvasSubscriptionState.loading = false
      if (activeRequest === request) {
        activeRequest = undefined
      }
    })
  activeRequest = request
  return request
}

export function useCanvasSubscription() {
  const balance = computed(() => {
    const account = canvasSubscriptionState.subscription
    if (!account || (account.anlasFixed === undefined && account.anlasPurchased === undefined)) {
      return null
    }
    return (account.anlasFixed ?? 0) + (account.anlasPurchased ?? 0)
  })

  const freePercent = computed(() => canvasSubscriptionState.subscription?.usagePercent)

  const tooltip = computed(() => {
    const account = canvasSubscriptionState.subscription
    if (!account) {
      return canvasSubscriptionState.error
        ? `余额读取失败：${canvasSubscriptionState.error}（点击重试）`
        : '点击刷新 Anlas 与免费额度'
    }
    const parts: string[] = []
    if (account.tier === 3) {
      parts.push('Opus 会员')
    } else if (account.tier !== undefined) {
      parts.push(`会员等级 ${account.tier}`)
    }
    if (balance.value !== null) {
      parts.push(`Anlas：${balance.value.toLocaleString()}`)
    }
    if (account.usagePercent !== undefined) {
      parts.push(`V5 免费额度：${account.usagePercent}%`)
    }
    if (account.usageNextSeconds) {
      const duration =
        account.usageNextSeconds >= 3600
          ? `${(account.usageNextSeconds / 3600).toFixed(1)} 小时`
          : `${Math.ceil(account.usageNextSeconds / 60)} 分钟`
      parts.push(`约 ${duration}后恢复 1%`)
    }
    parts.push('点击刷新')
    return parts.join('\n')
  })

  return {
    state: canvasSubscriptionState,
    balance,
    freePercent,
    tooltip,
    refresh: refreshCanvasSubscription,
  }
}
