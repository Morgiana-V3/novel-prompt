import type { UcPreset } from '@shared/generation/types'
import type { AiPreviewResult } from '@shared/prompts/types'
import { reactive } from 'vue'

/** 输入框里的角色提示词（字段都是字符串，便于 v-model） */
export interface CharDraft {
  prompt: string
  negative: string
  position: string
}

export const toDrafts = (
  list: { prompt: string; negative?: string; position?: string }[],
): CharDraft[] =>
  list.map((character) => ({
    prompt: character.prompt ?? '',
    negative: character.negative ?? '',
    position: character.position ?? '',
  }))

/** 推测和生图共用的参数：两边必须一致，推测结果才能和实际出图对得上 */
export interface WorkParams {
  width: number
  height: number
  /** Add Quality Tags */
  qualityTags: boolean
  ucPreset: UcPreset
}

/** 当前提示词中的某个输入框 */
export type FieldRef =
  { kind: 'base' } | { kind: 'negative' } | { kind: 'char'; index: number; neg?: boolean }

export interface Snapshot {
  base: string
  negative: string
  characters: CharDraft[]
  /** 这份快照是在什么操作之前保存的 */
  label: string
  at: number
}

export const STORE_KEY = 'np-workspace-v1'

export const MAX_HISTORY = 30

export const DEFAULT_PARAMS: Readonly<WorkParams> = {
  width: 832,
  height: 1216,
  qualityTags: true,
  ucPreset: 'heavy',
}

export interface Persisted {
  prompt?: string
  negative?: string
  characters?: CharDraft[]
  params?: Partial<WorkParams>
  history?: Snapshot[]
}

export function load(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Persisted
  } catch {
    return {}
  }
}

export const saved = load()

export const promptState = reactive({
  /* ---- 当前提示词：所有页面共用，自动保存 ---- */
  prompt: saved.prompt ?? '',

  negative: saved.negative ?? '',

  characters: toDrafts(saved.characters ?? []),

  params: { ...DEFAULT_PARAMS, ...saved.params } as WorkParams,

  history: (saved.history ?? []) as Snapshot[],

  /** 最近编辑的输入框，Tag 搜索会把 tag 加到这里 */
  focus: { kind: 'base' } as FieldRef,

  /** 最近一次画面推测（key = 推测时的提示词与参数） */
  lastPreview: null as { key: string; result: AiPreviewResult } | null,

  /** 画面推测「带着建议去 AI 优化」时带过去的修改要求，AI 页取走后清空 */
  aiHandoff: null as { text: string; count: number } | null,
})
