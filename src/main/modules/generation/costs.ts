import type {
  NaiFreeCheck,
  NaiGenParams,
  NaiSubscription,
  NaiVersion,
} from '../../../shared/generation/types'

/** 免费生成的像素上限（总像素，不是单边） */
export const FREE_MAX_PIXELS = 1024 * 1024

export const FREE_MAX_STEPS = 28

/** V5 免费额度剩余低于此百分比时不再提交，避免贴着耗尽边缘生成 */
export const FREE_MIN_PERCENT = 2

/** 调用端的免费资格检查：服务端才是最终决定者，所以生成后还要核对余额 */
export function freeCheck(
  params: Pick<NaiGenParams, 'width' | 'height' | 'steps'>,
  version: NaiVersion,
  sub?: NaiSubscription,
): NaiFreeCheck {
  const reasons: string[] = []
  const notes: string[] = []
  if (params.width * params.height > FREE_MAX_PIXELS) {
    reasons.push(`尺寸 ${params.width}×${params.height} 超过免费上限（总像素不超过 1024×1024）`)
  }
  if (params.steps > FREE_MAX_STEPS) {
    reasons.push(`步数 ${params.steps} 超过免费上限 ${FREE_MAX_STEPS}`)
  }
  if (!sub) {
    reasons.push('还没查询到会员状态')
  } else {
    if (sub.active !== true || sub.tier !== 3) {
      reasons.push('不是有效的 Opus 会员（只有 Opus 有免费生成）')
    }
    if (version === 'v5') {
      if (sub.usageNegative === true) {
        reasons.push('V5 免费额度处于负值')
      } else if (sub.usagePercent === undefined) {
        reasons.push('接口没有返回 V5 免费额度，无法确认免费资格')
      } else if (sub.usagePercent < FREE_MIN_PERCENT) {
        reasons.push(`V5 免费额度只剩约 ${sub.usagePercent}%，为避免贴边扣费已暂停`)
      }
    } else {
      notes.push(
        'V4.5 的免费规则没有像 V5 那样的额度读数，每张生成后都会核对 Anlas，发现扣除立即停止',
      )
    }
  }
  notes.push('是否扣费由服务端决定，生成后会核对两类 Anlas 余额')
  return { ok: !reasons.length, reasons, notes }
}

/** Anlas 分项变化（负数 = 扣除）；任一项缺失则无法判断 */
export function anlasChange(
  before?: NaiSubscription,
  after?: NaiSubscription,
): { fixed: number; purchased: number } | undefined {
  if (before?.anlasFixed === undefined || after?.anlasFixed === undefined) {
    return undefined
  }
  if (before.anlasPurchased === undefined || after.anlasPurchased === undefined) {
    return undefined
  }
  return {
    fixed: after.anlasFixed - before.anlasFixed,
    purchased: after.anlasPurchased - before.anlasPurchased,
  }
}
