import type { ReverseResult } from './types'

/** Scores from different classifiers are not calibrated; merge by rank, not score. */
export function proposeArtistStrings(result: ReverseResult): string[] {
  const names: string[] = []
  for (let rank = 0; rank < 3; rank++) {
    for (const group of result.artists) {
      const name = group.tags[rank]?.name
      if (name && !names.includes(name)) {
        names.push(name)
      }
    }
  }
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
