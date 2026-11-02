import { AsyncLocalStorage } from 'node:async_hooks'
import type { TokenUsage } from '../../shared/statistics/model'
import type { TaskKind } from '../../shared/tasks/model'
export interface UsageContext {
  kind: TaskKind
  onUsage: (usage: TokenUsage) => void
}
export interface UsageReport {
  provider: string
  model: string
  usage: TokenUsage
  feature: string
}
const context = new AsyncLocalStorage<UsageContext>()
let recorder: ((report: UsageReport) => void) | undefined
export const setUsageRecorder = (callback: (report: UsageReport) => void) => {
  recorder = callback
}
export const withUsageContext = <T>(value: UsageContext, work: () => Promise<T>): Promise<T> =>
  context.run(value, work)
export const usageFeature = () => context.getStore()?.kind ?? 'other'
export function reportUsage(provider: string, model: string, usage: TokenUsage): void {
  // Accounting must not discard a successful model response if the disk is unavailable.
  try {
    recorder?.({ provider, model, usage, feature: usageFeature() })
  } catch (error) {
    console.warn('[statistics]', error)
  }
  try {
    context.getStore()?.onUsage(usage)
  } catch (error) {
    console.warn('[task usage]', error)
  }
}
