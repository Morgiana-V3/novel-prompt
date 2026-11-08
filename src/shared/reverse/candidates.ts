import type { ReverseResult } from './types'

export interface ArtistRecommendation {
  name: string
  score: number
  sources: { model: string; rank: number; score: number }[]
}

/** Rank-only fusion. k=2 emphasizes the heads of these short lists; not a calibrated probability. */
export function rankArtists(result: Pick<ReverseResult, 'artists'>): ArtistRecommendation[] {
  const candidates = new Map<string, ArtistRecommendation>()
  const models = new Set<string>()
  for (const group of result.artists) {
    if (models.has(group.model)) {
      continue
    }
    models.add(group.model)
    const seen = new Set<string>()
    const tags = [...group.tags]
      .filter((tag) => Number.isFinite(tag.score) && tag.name.trim())
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en'))
    for (const [index, tag] of tags.entries()) {
      const name = tag.name.replaceAll('_', ' ').trim().replace(/\s+/g, ' ')
      const key = name.toLowerCase()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      const candidate = candidates.get(key) ?? { name, score: 0, sources: [] }
      const rank = index + 1
      candidate.score += 1 / (2 + rank)
      candidate.sources.push({ model: group.model, rank, score: tag.score })
      candidates.set(key, candidate)
    }
  }
  return [...candidates.values()].sort(
    (a, b) =>
      b.score - a.score ||
      Math.min(...a.sources.map((s) => s.rank)) - Math.min(...b.sources.map((s) => s.rank)) ||
      a.name.localeCompare(b.name, 'en'),
  )
}

/** Scores from different classifiers are not calibrated; merge by rank, not score. */
export function proposeArtistStrings(result: ReverseResult): string[] {
  const names = rankArtists(result)
    .slice(0, 3)
    .map((candidate) => candidate.name)
  const singles = names.slice(0, 3).map((name) => `artist:${name}`)
  if (names.length > 1) {
    singles.push(
      mixString([
        { name: names[0], weight: 1 },
        { name: names[1], weight: 0.7 },
      ]),
    )
  }
  if (names.length > 2) {
    singles.push(
      mixString([
        { name: names[0], weight: 1 },
        { name: names[2], weight: 0.7 },
      ]),
    )
  }
  return singles
}

export function styleSimilarity(a: number[], b: number[]): number {
  for (const vector of [a, b]) {
    if (
      !Array.isArray(vector) ||
      vector.length !== 256 ||
      vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw new Error('风格特征无效，请重新识别参考图')
    }
  }
  const norm = (vector: number[]) => Math.hypot(...vector)
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb || !Number.isFinite(na) || !Number.isFinite(nb)) {
    throw new Error('风格特征无效，请重新识别参考图')
  }
  const dot = a.reduce((sum, value, i) => sum + (value / na) * (b[i] / nb), 0)
  return Math.max(-1, Math.min(1, dot))
}

export interface ArtistMixPart {
  name: string
  /** 合并后的接近程度（各模型概率的平均，模型没给出的记 0） */
  probability: number
  /** 在本组合里的占比，四舍五入到整数百分比，合计约 100 */
  share: number
  /** NovelAI 提示词权重；1 为正常强度 */
  weight: number
}

export interface ArtistMix {
  kind: 'single' | 'mix'
  parts: ArtistMixPart[]
}

const MIX_MIN_RATIO = 0.25
const MIX_MAX_PARTS = 4
const MIX_WEIGHT_MIN = 0.3
const MIX_WEIGHT_MAX = 1.6

function roundWeight(value: number) {
  return Math.round(Math.min(MIX_WEIGHT_MAX, Math.max(MIX_WEIGHT_MIN, value)) * 20) / 20
}

/**
 * 估算画风组成：各画风模型的输出是各自的 softmax 概率，同一模型内可比、不同模型间不校准，
 * 所以按模型取平均（没给出的记 0，奖励多个模型一致的候选）。
 * 第一名明显领先时视为单一画风；否则取达到第一名 25% 的前 2～4 位，
 * 按相对概率映射为 0.8～1.2 的权重。这只是风格接近程度的估算，不是原作者判定或真实比例。
 */
export function estimateArtistMix(result: Pick<ReverseResult, 'artists'>): ArtistMix | null {
  const fused = new Map<string, { name: string; probability: number }>()
  const models = new Set<string>()
  for (const group of result.artists) {
    if (models.has(group.model)) {
      continue
    }
    models.add(group.model)
    const seen = new Set<string>()
    for (const tag of group.tags) {
      const name = tag.name.replaceAll('_', ' ').trim().replace(/\s+/g, ' ')
      const key = name.toLowerCase()
      if (!name || seen.has(key) || !Number.isFinite(tag.score) || tag.score <= 0) {
        continue
      }
      seen.add(key)
      const entry = fused.get(key) ?? { name, probability: 0 }
      entry.probability += tag.score
      fused.set(key, entry)
    }
  }
  if (!models.size) {
    return null
  }
  const ranked = [...fused.values()]
    .map((entry) => ({ ...entry, probability: entry.probability / models.size }))
    .sort((a, b) => b.probability - a.probability || a.name.localeCompare(b.name, 'en'))
  const top = ranked[0]
  if (!top) {
    return null
  }
  const second = ranked[1]?.probability ?? 0
  if (top.probability >= 0.45 && second < top.probability * 0.35) {
    return { kind: 'single', parts: [{ ...top, share: 100, weight: 1 }] }
  }
  const chosen = ranked
    .filter((entry) => entry.probability >= top.probability * MIX_MIN_RATIO)
    .slice(0, MIX_MAX_PARTS)
  if (chosen.length < 2) {
    return { kind: 'single', parts: [{ ...top, share: 100, weight: 1 }] }
  }
  const total = chosen.reduce((sum, entry) => sum + entry.probability, 0)
  return {
    kind: 'mix',
    parts: chosen.map((entry) => ({
      ...entry,
      share: Math.round((entry.probability / total) * 100),
      weight: roundWeight(0.8 + 0.4 * (entry.probability / top.probability)),
    })),
  }
}

/** 组合写成画师串；权重为 1 时不加权重语法 */
export function mixString(parts: Pick<ArtistMixPart, 'name' | 'weight'>[]): string {
  return parts
    .map((part) =>
      // 数字结尾的名字必须与结束符隔开，否则 m0311:: 会被供应商识别为新权重。
      part.weight === 1 ? `artist:${part.name}` : `${part.weight}::artist:${part.name} ::`,
    )
    .join(', ')
}

/**
 * 围绕一个组合生成权重变体（自动优化每一轮的候选）：
 * 逐位加强 / 减弱 step，限制在 0.3～1.6；多位画师时再试一次去掉最弱的一位。
 * 结果去重且不含原组合，最多 limit 个。
 */
export function mixVariants(
  parts: Pick<ArtistMixPart, 'name' | 'weight'>[],
  step: number,
  limit = 3,
): Pick<ArtistMixPart, 'name' | 'weight'>[][] {
  const base = mixString(parts)
  const seen = new Set([base])
  const variants: Pick<ArtistMixPart, 'name' | 'weight'>[][] = []
  const push = (candidate: Pick<ArtistMixPart, 'name' | 'weight'>[]) => {
    const key = mixString(candidate)
    if (candidate.length && !seen.has(key)) {
      seen.add(key)
      variants.push(candidate)
    }
  }
  const adjust = (index: number, delta: number) =>
    parts.map((part, i) =>
      i === index ? { ...part, weight: roundWeight(part.weight + delta) } : part,
    )
  for (const [index] of parts.entries()) {
    push(adjust(index, step))
  }
  if (parts.length > 2) {
    push(parts.slice(0, -1))
  }
  for (const [index] of parts.entries()) {
    push(adjust(index, -step))
  }
  return variants.slice(0, limit)
}
