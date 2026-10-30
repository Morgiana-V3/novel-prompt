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
    singles.push(`1::artist:${names[0]}::, 0.7::artist:${names[1]}::`)
  }
  if (names.length > 2) {
    singles.push(`1::artist:${names[0]}::, 0.7::artist:${names[2]}::`)
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
