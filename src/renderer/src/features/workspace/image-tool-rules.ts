import { estimateGeneration, estimateUpscale, estimateLabel } from '@shared/generation/pricing'
import type { NaiSubscription, NaiVersion } from '@shared/generation/types'
import type { PageImageTool } from '@shared/workspace/model'
import { pageImageToolSize } from '@shared/workspace/model'

/** 官方免费生成的尺寸上限，超过即消耗 Anlas */
export const FREE_PIXELS = 1024 * 1024
/** 放大接口的输入上限 */
export const UPSCALE_MAX_PIXELS = 3_145_728
/** 扩图、增强结果与局部重绘共用的总像素上限 */
const MAX_RESULT_PIXELS = 4 * 1024 * 1024

export interface ToolSource {
  width: number
  height: number
  /** 每次生成张数（放大固定 1 张） */
  count: number
  steps: number
  version?: NaiVersion
}

/** 不能执行的原因；可以执行时为空字符串 */
export function toolBlockedReason(tool: PageImageTool, source: ToolSource): string {
  if (tool.kind === 'upscale') {
    return source.width * source.height > UPSCALE_MAX_PIXELS ? '原图超过放大接口的输入上限' : ''
  }
  if (tool.kind === 'outpaint') {
    if (source.width % 64 || source.height % 64) {
      return '原图宽高不是 64 的倍数，无法扩图'
    }
    if (!(tool.left || tool.right || tool.top || tool.bottom)) {
      return '请至少向一个方向扩展'
    }
  }
  const size = pageImageToolSize(tool, source.width, source.height)
  return size.width * size.height > MAX_RESULT_PIXELS ? '结果超过 4096×1024 总像素上限' : ''
}

/** 与主进程使用同一套预估；执行前仍会刷新账户状态。 */
export function toolCostNote(
  tool: PageImageTool,
  source: ToolSource,
  subscription?: NaiSubscription | null,
): string {
  if (tool.kind === 'upscale') {
    const cost = estimateUpscale(source.width, source.height)
    return cost === undefined ? '费用待确认' : `预计 ${cost} Anlas · 1 张`
  }
  if (!source.version) {
    return '费用待确认'
  }
  const size = pageImageToolSize(tool, source.width, source.height)
  return `${estimateLabel(
    estimateGeneration(
      {
        params: { ...source, ...size },
        version: source.version,
        ...(tool.kind === 'enhance' ? { img2img: { strength: tool.strength } } : {}),
      },
      subscription,
    ),
  )} · ${source.count} 张`
}
