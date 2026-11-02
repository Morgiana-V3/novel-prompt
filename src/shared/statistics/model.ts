export interface TokenUsage {
  requests: number
  reported: number
  input: number
  output: number
  total: number
  cached: number
  cacheReported: number
  reasoning: number
}
export const emptyUsage = (): TokenUsage => ({
  requests: 0,
  reported: 0,
  input: 0,
  output: 0,
  total: 0,
  cached: 0,
  cacheReported: 0,
  reasoning: 0,
})
export function addUsage(target: TokenUsage, value: TokenUsage): void {
  for (const key of Object.keys(target) as (keyof TokenUsage)[]) {
    target[key] += value[key]
  }
}
/** Cache and reasoning tokens are subsets, never added to total a second time. */
export function readTokenUsage(raw: unknown): TokenUsage {
  const result = { ...emptyUsage(), requests: 1 }
  if (!raw || typeof raw !== 'object') {
    return result
  }
  const u = raw as Record<string, unknown>
  const number = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
  const details = (value: unknown) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const hit =
    number(u.prompt_cache_hit_tokens) ?? number(details(u.prompt_tokens_details).cached_tokens)
  const miss = number(u.prompt_cache_miss_tokens)
  const input =
    number(u.prompt_tokens) ?? (hit !== undefined && miss !== undefined ? hit + miss : undefined)
  const output = number(u.completion_tokens)
  const total = number(u.total_tokens) ?? (input ?? 0) + (output ?? 0)
  result.input = input ?? 0
  result.output = output ?? 0
  result.total = total ?? 0
  result.reported = input !== undefined && output !== undefined ? 1 : 0
  result.cached = hit ?? 0
  result.cacheReported = hit === undefined ? 0 : 1
  result.reasoning = number(details(u.completion_tokens_details).reasoning_tokens) ?? 0
  return result
}
export interface StatisticsTotals extends TokenUsage {
  anlasSpent: number
  anlasMeasured: number
  anlasUnknown: number
  images: number
  runs: number
  completed: number
  failed: number
  cancelled: number
}
export const emptyTotals = (): StatisticsTotals => ({
  ...emptyUsage(),
  anlasSpent: 0,
  anlasMeasured: 0,
  anlasUnknown: 0,
  images: 0,
  runs: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
})
export function addTotals(target: StatisticsTotals, value: StatisticsTotals): void {
  for (const key of Object.keys(target) as (keyof StatisticsTotals)[]) {
    target[key] += value[key]
  }
}
export interface StatisticsDay {
  date: string
  totals: StatisticsTotals
  features: Record<string, StatisticsTotals>
  models: { provider: string; model: string; totals: StatisticsTotals }[]
}
export interface StatisticsData {
  schema: 1
  startedAt: number
  days: StatisticsDay[]
  error?: string
}
