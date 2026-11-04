import type { NaiGenParams, NaiSubscription, NaiVersion } from './types'

/** Official web client pricing, verified 2026-11-04; see docs/novelai-pricing.md. */
export interface GenerationPriceInput {
  params: Pick<NaiGenParams, 'width' | 'height' | 'steps' | 'count'>
  version: NaiVersion
  img2img?: { strength: number }
  inpaint?: { strength: number }
}

export interface AnlasEstimate {
  /** Price of one request without the Opus allowance. */
  paidPerImage: number
  /** undefined means membership or allowance could not be verified. */
  perImage?: number
  minimum: number
  maximum: number
}

export function estimateGeneration(
  request: GenerationPriceInput,
  subscription?: NaiSubscription | null,
): AnlasEstimate | undefined {
  const { width, height, steps, count } = request.params
  const strength = request.inpaint?.strength ?? request.img2img?.strength ?? 1
  if (
    ![width, height, steps, count].every((value) => Number.isInteger(value) && value > 0) ||
    steps > 50 ||
    width * height > 4 * 1024 * 1024 ||
    !['v4.5', 'v5'].includes(request.version) ||
    !Number.isFinite(strength) ||
    strength < 0.01 ||
    strength > 1
  ) {
    return undefined
  }
  const pixels = width * height
  const base = Math.ceil(2.951823174884865e-6 * pixels + 5.753298233447344e-7 * pixels * steps)
  const paidPerImage = Math.max(
    Math.ceil(base * (request.version === 'v5' ? 1.5 : 1) * strength),
    2,
  )
  // The official calculator rejects prices above 140; never interpret its sentinel as free.
  if (paidPerImage > 140) {
    return undefined
  }
  let perImage: number | undefined
  if (
    pixels > 1048576 ||
    steps > 28 ||
    subscription?.active === false ||
    (subscription?.tier !== undefined && subscription.tier < 3)
  ) {
    perImage = paidPerImage
  } else if (subscription?.active === true && (subscription.tier ?? 0) >= 3) {
    if (request.version === 'v4.5') {
      perImage = 0
    } else if (subscription.usageNegative === true) {
      perImage = paidPerImage
    } else if (subscription.usageNegative === false) {
      perImage = 0
    }
  }
  // We send n_samples=1 repeatedly. V5 allowance can run out between requests.
  let maximum = paidPerImage * count
  if (perImage === 0) {
    maximum = request.version === 'v5' ? paidPerImage * (count - 1) : 0
  }
  return {
    paidPerImage,
    perImage,
    minimum: (perImage ?? 0) * count,
    maximum,
  }
}

export function estimateUpscale(width: number, height: number): number | undefined {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0)) {
    return undefined
  }
  const pixels = width * height
  return [
    [1048576, 1],
    [1747627, 2],
    [2446678, 3],
    [3145728, 4],
  ].find(([limit]) => pixels <= limit)?.[1]
}

export function estimateLabel(estimate?: AnlasEstimate): string {
  if (!estimate) {
    return '费用待确认'
  }
  if (estimate.minimum !== estimate.maximum) {
    return `预计 ${estimate.minimum}～${estimate.maximum} Anlas`
  }
  return `预计 ${estimate.maximum} Anlas`
}

export interface AnlasOutcome {
  anlasDelta?: number
  usageDelta?: number
  subscription?: NaiSubscription
}

/** Balance observations, not a provider-issued per-request receipt. */
export function anlasOutcomeText(result: AnlasOutcome): string {
  const delta = result.anlasDelta
  let balance = 'Anlas 变化未知'
  if (delta !== undefined) {
    balance = '余额未变（0 Anlas）'
    if (delta < 0) {
      balance = `余额减少 ${-delta} Anlas`
    }
    if (delta > 0) {
      balance = `余额增加 ${delta} Anlas`
    }
  }
  const parts = [balance]
  if (result.usageDelta !== undefined) {
    const value = Math.round(Math.abs(result.usageDelta) * 100) / 100
    parts.push(`V5 免费额度${result.usageDelta <= 0 ? '减少' : '增加'} ${value} 个百分点`)
  }
  const sub = result.subscription
  if (sub?.anlasFixed !== undefined && sub.anlasPurchased !== undefined) {
    parts.push(`剩余 ${sub.anlasFixed + sub.anlasPurchased} Anlas`)
  }
  return parts.join(' · ')
}
