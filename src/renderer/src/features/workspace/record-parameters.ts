import type { NaiGenParams, NaiVersion } from '@shared/generation/types'

export type RecordParameter = readonly [label: string, value: string | number]

/** 生成记录里展示的参数清单；只读记录页与输入上下文共用同一组标签与取值 */
export function recordParameters(
  params: NaiGenParams,
  model: NaiVersion | undefined,
): RecordParameter[] {
  return [
    ['模型', model ?? '未记录'],
    ['尺寸', `${params.width} × ${params.height}`],
    ['步数', params.steps],
    ['引导强度', params.scale],
    ['CFG Rescale', params.cfgRescale],
    ['采样器', params.sampler],
    ['噪声调度', params.noiseSchedule],
    ['种子', params.seed ?? '随机'],
    ['张数', params.count],
    ['质量词', params.qualityTags ? '开启' : '关闭'],
    ['质量模式', params.qualityMode ?? '未记录'],
    ['负面预设', params.ucPreset],
  ]
}
