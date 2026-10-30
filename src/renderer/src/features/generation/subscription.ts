import { reactive } from 'vue'
import type { NaiSubscription } from '@shared/generation/types'
import { settingsState } from '../settings/state'
import { cleanErr } from '../../shared/lib/format'

export const subscriptionState = reactive({
  subscription: null as NaiSubscription | null,
  loading: false,
  error: '',
  updatedAt: 0,
})

let revision = 0
let pending: Promise<void> | null = null
let refreshQueued = false

export function resetSubscription() {
  revision++
  pending = null
  refreshQueued = false
  Object.assign(subscriptionState, { subscription: null, loading: false, error: '', updatedAt: 0 })
}

/** Share one request; after generation, also refresh any query started before it finished. */
export function refreshSubscription(afterGeneration = false): Promise<void> {
  const token = settingsState.settings?.naiToken?.trim()
  if (!token) {
    return Promise.resolve()
  }
  if (pending) {
    refreshQueued ||= afterGeneration
    return pending
  }
  const requestRevision = ++revision
  subscriptionState.loading = true
  subscriptionState.error = ''
  pending = (async () => {
    try {
      const subscription = await window.api.naiSubscription()
      if (requestRevision === revision && token === settingsState.settings?.naiToken?.trim()) {
        subscriptionState.subscription = subscription
        subscriptionState.updatedAt = Date.now()
      }
    } catch (error) {
      if (requestRevision === revision && token === settingsState.settings?.naiToken?.trim()) {
        subscriptionState.error = cleanErr(error)
      }
    } finally {
      if (requestRevision === revision) {
        pending = null
        subscriptionState.loading = false
        if (refreshQueued) {
          refreshQueued = false
          refreshSubscription().catch((error) => {
            subscriptionState.error = cleanErr(error)
          })
        }
      }
    }
  })()
  return pending
}
