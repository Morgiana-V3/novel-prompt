import type { NaiImage } from '../images/types'
import type { AiCharacter } from '../prompts/types'

export const NAI_VERSIONS = ['v4.5', 'v5'] as const
export type NaiVersion = (typeof NAI_VERSIONS)[number]
export function isNaiVersion(value: unknown): value is NaiVersion {
  return NAI_VERSIONS.some((version) => version === value)
}

/* ---------- NovelAI 生图 ---------- */

export interface NaiSubscription {
  active?: boolean
  tier?: number
  /** 订阅附带的 Anlas */
  anlasFixed?: number
  /** 购买的 Anlas */
  anlasPurchased?: number
  /** V5 免费额度剩余百分比 */
  usagePercent?: number
  usageNegative?: boolean
  /** 免费额度恢复相关的秒数 */
  usageNextSeconds?: number
}

export const NAI_SAMPLERS = [
  'k_euler_ancestral',
  'k_euler',
  'k_dpmpp_2s_ancestral',
  'k_dpmpp_2m_sde',
  'k_dpmpp_2m',
  'k_dpmpp_sde',
] as const
export type NaiSampler = (typeof NAI_SAMPLERS)[number]
export function isNaiSampler(value: unknown): value is NaiSampler {
  return NAI_SAMPLERS.some((sampler) => sampler === value)
}

export const NAI_NOISE_SCHEDULES = ['native', 'karras', 'exponential', 'polyexponential'] as const
export type NaiNoiseSchedule = (typeof NAI_NOISE_SCHEDULES)[number]
export function isNaiNoiseSchedule(value: unknown): value is NaiNoiseSchedule {
  return NAI_NOISE_SCHEDULES.some((schedule) => schedule === value)
}

export interface NaiGenParams {
  width: number
  height: number
  steps: number
  /** Prompt Guidance */
  scale: number
  cfgRescale: number
  sampler: NaiSampler
  noiseSchedule: NaiNoiseSchedule
  /** 空 = 随机 */
  seed: number | null
  /** 连续生成张数（每次请求 1 张） */
  count: number
  /** 由本工具把质量词拼进主提示词（不交给服务端处理） */
  qualityTags: boolean
  /** 由本工具把 UC 预设拼进负面（不交给服务端处理） */
  ucPreset: UcPreset
}

export interface NaiGenRequest {
  base: string
  negative: string
  characters: AiCharacter[]
  params: NaiGenParams
  version: NaiVersion
}

/** 局部重绘使用图库原图的尺寸，遮罩为同尺寸 PNG（白色重绘，黑色保留）。 */
export interface NaiInpaintRequest extends NaiGenRequest {
  inpaint: {
    imageName: string
    mask: string
    strength: number
  }
}

export interface NaiGenResult {
  images: NaiImage[]
  /** 本次生成前后的 Anlas 变化（负数 = 扣除），查询失败时为 undefined */
  anlasDelta?: number
  /** 中途停止的原因（扣费、额度不足、请求失败等） */
  stopped?: string
  subscription?: NaiSubscription
}

export interface NaiFreeCheck {
  ok: boolean
  /** 不满足免费条件的原因 */
  reasons: string[]
  /** 不阻止生成的提醒 */
  notes: string[]
}

/* ---------- 画面推测 ---------- */

/** NAI 前端自动注入的 UC 预设 */
export const UC_PRESET_NAMES = ['heavy', 'light', 'human', 'none'] as const
export type UcPreset = (typeof UC_PRESET_NAMES)[number]

export function isUcPreset(value: unknown): value is UcPreset {
  return UC_PRESET_NAMES.some((preset) => preset === value)
}
