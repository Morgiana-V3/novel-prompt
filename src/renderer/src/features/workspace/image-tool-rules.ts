import type { PageImageTool } from '@shared/workspace/model'
import { pageImageToolSize } from '@shared/workspace/model'

/** 官方免费生成的尺寸上限，超过即消耗 Anlas */
export const FREE_PIXELS = 1024 * 1024
/** 放大接口的输入上限 */
export const UPSCALE_MAX_PIXELS = 3_145_728
/** 扩图、精修结果与局部重绘共用的总像素上限 */
const MAX_RESULT_PIXELS = 4 * 1024 * 1024
const FREE_MAX_STEPS = 28

export interface ToolSource {
  width: number
  height: number
  /** 每次生成张数（放大固定 1 张） */
  count: number
  steps: number
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

/** 预计花费说明：是否免费由服务端决定，这里只按尺寸与步数给出提醒 */
export function toolCostNote(tool: PageImageTool, source: ToolSource): string {
  if (tool.kind === 'upscale') {
    return source.width * source.height <= FREE_PIXELS
      ? '放大从不免费 · 约 1 Anlas'
      : '原图超过 1024×1024 · 放大价格高于 1 Anlas'
  }
  const size = pageImageToolSize(tool, source.width, source.height)
  if (size.width * size.height > FREE_PIXELS || source.steps > FREE_MAX_STEPS) {
    return `超过免费尺寸或步数 · ${source.count} 张都会消耗 Anlas`
  }
  return `Opus 免费额度内 · ${source.count} 张`
}
