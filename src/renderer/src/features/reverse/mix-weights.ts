import type { ReverseResult } from '@shared/reverse/types'

export interface MixMember {
  name: string
  /** NovelAI 提示词权重；1 为正常强度 */
  weight: number
  /** 在本组合里的占比（整数百分比） */
  share: number
}

function normalizeName(name: string) {
  return name.replaceAll('_', ' ').trim().replace(/\s+/g, ' ')
}

/**
 * 合并各画风模型的概率：同一模型内可比、不同模型间不校准，所以按模型取平均，
 * 模型没给出的画师记 0（与共享模块 estimateArtistMix 的融合方式一致）。键为小写名称。
 */
export function fusedProbabilities(result: Pick<ReverseResult, 'artists'>): Map<string, number> {
  const fused = new Map<string, number>()
  const models = new Set<string>()
  for (const group of result.artists) {
    if (models.has(group.model)) {
      continue
    }
    models.add(group.model)
    const seen = new Set<string>()
    for (const tag of group.tags) {
      const key = normalizeName(tag.name).toLowerCase()
      if (!key || seen.has(key) || !Number.isFinite(tag.score) || tag.score <= 0) {
        continue
      }
      seen.add(key)
      fused.set(key, (fused.get(key) ?? 0) + tag.score)
    }
  }
  for (const [key, value] of fused) {
    fused.set(key, value / Math.max(1, models.size))
  }
  return fused
}

/**
 * 任意一组成员的比例：按各自合并概率相对组内最高者换算权重（0.8～1.2，最高者 1.2），
 * 占比为概率占组内总和的比例；只有一位成员时权重为 1。
 */
export function memberWeights(names: string[], probabilities: Map<string, number>): MixMember[] {
  if (!names.length) {
    return []
  }
  if (names.length === 1) {
    return [{ name: names[0], weight: 1, share: 100 }]
  }
  const values = names.map((name) => probabilities.get(normalizeName(name).toLowerCase()) ?? 0)
  const positive = values.filter((value) => value > 0)
  // 模型没给出概率的成员：按组内最低概率的一半算，保证弱于所有有概率的成员
  const floor = positive.length ? Math.min(...positive) / 2 : 1
  const adjusted = values.map((value) => (value > 0 ? value : floor))
  const top = Math.max(...adjusted)
  const total = adjusted.reduce((sum, value) => sum + value, 0)
  return names.map((name, index) => ({
    name,
    weight: Math.round((0.8 + 0.4 * (adjusted[index] / top)) * 20) / 20,
    share: Math.round((adjusted[index] / total) * 100),
  }))
}
