import type { NaiGenParams } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { reactive, watch } from 'vue'

/** 只属于生图的参数；画幅、质量词、UC 预设与画面推测共用（promptState.params） */
export type GenOnly = Omit<
  NaiGenParams,
  'width' | 'height' | 'qualityTags' | 'qualityMode' | 'ucPreset'
>

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

/** 图片预览保存的生图参数（种子不保存）；新建图片精修会话也沿用它们 */
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

/** Shared by every import entry point, including imports before the generation view opens. */
export const generationParams = reactive<GenOnly>(loadGenParams())
watch(
  generationParams,
  (params) => {
    localStorage.setItem(GEN_PARAMS_KEY, JSON.stringify({ ...params, seed: null }))
  },
  { deep: true },
)

export const imageState = reactive({
  generating: false,
  /** 生成的图片 → 生成时的提示词 key，用于和推测结果对照 */
  imageKeys: {} as Record<string, string>,

  /** 图片预览当前选中的图片，也是各页面角色位置编辑器的参考底图；仅保留在本次会话 */
  currentImage: null as NaiImage | null,

  positionReference: { visible: true, opacity: 40 },

  /** 图片预览送入新建会话的图片，只暂存，不自动创建记录。 */
  workspaceImage: null as NaiImage | null,
})

export function setGenerationBusy(value: boolean): void {
  imageState.generating = value
}
export function selectReferenceImage(image: NaiImage): void {
  imageState.currentImage = { ...image }
}
export function clearWorkspaceImage(): void {
  imageState.workspaceImage = null
}

/** Import only generation-owned fields, preserving the shared prompt parameters. */
export function applyGenerationParams(params: GenOnly): void {
  for (const field of Object.keys(DEFAULT_GEN) as (keyof GenOnly)[]) {
    ;(generationParams as Record<string, unknown>)[field] = params[field]
  }
}

const LOAD_KEEP_SEED_KEY = 'np-load-keep-seed'

/**
 * 从图片 / 收藏 / 图库载入配置时是否沿用原种子。
 * 默认不沿用：载入多半是想用这组提示词再试几张，固定种子只会反复出同一张图。
 */
export const loadPreferences = reactive({
  keepSeed: localStorage.getItem(LOAD_KEEP_SEED_KEY) === '1',
})

export function setLoadKeepSeed(keepSeed: boolean): void {
  loadPreferences.keepSeed = keepSeed
  localStorage.setItem(LOAD_KEEP_SEED_KEY, keepSeed ? '1' : '0')
}

export function setPreviewImage(image: NaiImage | null): void {
  imageState.currentImage = image
}
