import type { NaiGenParams } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { reactive } from 'vue'

/** 只属于生图的参数；画幅、质量词、UC 预设与画面推测共用（promptState.params） */
export type GenOnly = Omit<NaiGenParams, 'width' | 'height' | 'qualityTags' | 'ucPreset'>

export const GEN_PARAMS_KEY = 'np-gen-params'

export const DEFAULT_GEN: Readonly<GenOnly> = {
  steps: 23,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'native',
  seed: null,
  count: 1,
}

/** 生图页保存的参数（种子不保存）；新建工作台会话也沿用它们 */
export function loadGenParams(): GenOnly {
  try {
    const saved = JSON.parse(localStorage.getItem(GEN_PARAMS_KEY) ?? '{}') as Partial<GenOnly>
    const out = { ...DEFAULT_GEN }
    for (const field of Object.keys(DEFAULT_GEN) as (keyof GenOnly)[]) {
      if (field in saved) {
        ;(out as Record<string, unknown>)[field] = saved[field]
      }
    }
    return { ...out, seed: null }
  } catch {
    return { ...DEFAULT_GEN }
  }
}

export const imageState = reactive({
  /** 生成的图片 → 生成时的提示词 key，用于和推测结果对照 */
  imageKeys: {} as Record<string, string>,

  /** 生图预览当前选中的图片，也是各页面角色位置编辑器的参考底图；仅保留在本次会话 */
  currentImage: null as NaiImage | null,

  positionReference: { visible: true, opacity: 40 },

  /** 生图预览送入新建会话的图片，只暂存，不自动创建记录。 */
  workspaceImage: null as NaiImage | null,
})
