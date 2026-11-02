import { existsSync, readFileSync } from 'node:fs'
import { dataFile } from '../../infrastructure/paths'
import { quarantine, writeFileAtomic } from '../../infrastructure/atomic-file'
import {
  setUsageRecorder,
  usageFeature,
  type UsageReport,
} from '../../infrastructure/usage-context'
import {
  emptyTotals,
  type StatisticsData,
  type StatisticsTotals,
} from '../../../shared/statistics/model'
import type { TaskKind, TaskStatus } from '../../../shared/tasks/model'

export class StatisticsStore {
  private state?: StatisticsData
  private error = ''
  constructor(
    private path: () => string,
    private now = () => new Date(),
  ) {}
  private load(): StatisticsData {
    if (this.state) {
      return this.state
    }
    const file = this.path()
    if (existsSync(file)) {
      try {
        const value = JSON.parse(readFileSync(file, 'utf8')) as StatisticsData
        if (value.schema !== 1 || !Number.isFinite(value.startedAt) || !Array.isArray(value.days)) {
          throw new Error('统计文件格式无效')
        }
        // Validate aggregates so a damaged file cannot silently turn counters into NaN.
        for (const day of value.days) {
          const totals = [
            day.totals,
            ...Object.values(day.features),
            ...day.models.map((model) => model.totals),
          ]
          // Older statistics did not track Anlas. Preserve all existing counters.
          for (const row of totals) {
            row.anlasSpent ??= 0
            row.anlasMeasured ??= 0
            row.anlasUnknown ??= 0
          }
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
            totals.some((row) =>
              Object.keys(emptyTotals()).some(
                (key) =>
                  !Number.isSafeInteger(row[key as keyof StatisticsTotals]) ||
                  row[key as keyof StatisticsTotals] < 0,
              ),
            )
          ) {
            throw new Error('统计计数无效')
          }
        }
        this.state = value
      } catch (error) {
        if (!quarantine(file)) {
          throw error
        }
        this.error = '原统计文件损坏，已另存保留，现重新开始记录。'
      }
    }
    if (!this.state) {
      this.state = { schema: 1, startedAt: this.now().getTime(), days: [] }
      try {
        writeFileAtomic(file, JSON.stringify(this.state))
      } catch {
        this.error = '统计尚未保存，请检查数据目录。'
      }
    }
    return this.state
  }
  snapshot(): StatisticsData {
    return structuredClone({ ...this.load(), ...(this.error ? { error: this.error } : {}) })
  }
  clear(): StatisticsData {
    const state: StatisticsData = { schema: 1, startedAt: this.now().getTime(), days: [] }
    writeFileAtomic(this.path(), JSON.stringify(state))
    this.state = state
    this.error = ''
    return this.snapshot()
  }
  record(
    feature: string,
    update: (totals: StatisticsTotals) => void,
    model?: { provider: string; model: string },
  ): void {
    try {
      const state = this.load()
      const now = this.now()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      let day = state.days.find((row) => row.date === date)
      if (!day) {
        day = { date, totals: emptyTotals(), features: {}, models: [] }
        state.days.push(day)
      }
      day.features[feature] ??= emptyTotals()
      update(day.totals)
      update(day.features[feature])
      if (model) {
        let row = day.models.find(
          (row) => row.provider === model.provider && row.model === model.model,
        )
        if (!row) {
          row = { ...model, totals: emptyTotals() }
          day.models.push(row)
        }
        update(row.totals)
      }
      writeFileAtomic(this.path(), JSON.stringify(state))
      this.error = ''
    } catch (error) {
      this.error = '统计未能保存，请检查数据目录；当前进程内的计数会在后续写入时重试。'
      console.warn('[statistics]', error)
    }
  }
  ai(report: UsageReport): void {
    this.record(
      report.feature,
      (totals) => {
        for (const key of Object.keys(report.usage) as (keyof typeof report.usage)[]) {
          totals[key] += report.usage[key]
        }
      },
      { provider: report.provider, model: report.model },
    )
  }
}
export const statistics = new StatisticsStore(() => dataFile('statistics.json'))
setUsageRecorder((report) => statistics.ai(report))
export function recordTask(kind: TaskKind, status: TaskStatus): void {
  statistics.record(kind, (totals) => {
    totals.runs++
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      totals[status]++
    }
  })
}
export function recordGeneratedImage(model: string): void {
  statistics.record(
    usageFeature(),
    (totals) => {
      totals.images++
    },
    { provider: 'NovelAI', model },
  )
}
export function recordAnlas(model: string, change?: { fixed: number; purchased: number }): void {
  statistics.record(
    usageFeature(),
    (totals) => {
      if (change && Number.isSafeInteger(change.fixed) && Number.isSafeInteger(change.purchased)) {
        totals.anlasSpent += Math.max(0, -change.fixed) + Math.max(0, -change.purchased)
        totals.anlasMeasured++
      } else {
        totals.anlasUnknown++
      }
    },
    { provider: 'NovelAI', model },
  )
}
