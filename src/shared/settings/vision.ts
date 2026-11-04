import type { AiPreset } from './ai-presets'

/**
 * 模型能否识图（接收 image_url）。图片精修的 AI 讨论和局部重绘方案需要看图。
 * 按模型 ID 规则判断，2026-11 对照各家文档：
 * - DeepSeek：deepseek-flash（V4.1-Flash）原生支持；deepseek-v4-pro 仅文本
 * - OpenAI：GPT-4o 之后的 GPT 系列均支持
 * - 通义千问：qwen3.5 及以后的 plus / flash / max 与 VL、Omni 系列支持；qwen-plus 等旧别名未确认
 * - 智谱：GLM-5.x 文本模型不支持，需要 glm-5v-turbo 等带 v 的视觉模型
 * - Kimi：K3 系列支持（只接收 base64，软件发送的就是 base64）
 */
export type VisionSupport = 'yes' | 'no' | 'unknown'

const YES: RegExp[] = [
  /^deepseek-flash/,
  /vision/,
  /^gpt-(4o|4\.1|5|6)/,
  /^o[34](-|$)/,
  /^qwen3\.\d+-(plus|flash|max)/,
  /^qwen.*-(vl|omni)/,
  /^qvq/,
  /^glm-\d+(\.\d+)?v/,
  /^kimi-k3/,
  /^claude/,
  /^gemini/,
]

const NO: RegExp[] = [
  /^deepseek-(v4-pro|chat|reasoner|v3|r1|coder)/,
  /^glm-\d+(\.\d+)?(-(turbo|air|airx|flash|plus|long))?$/,
  /^qwen3-(?!vl|omni)/,
  /^gpt-3\.5/,
]

export function modelVision(model: string): VisionSupport {
  // 兼容「厂商/模型」写法（如 openai/gpt-6-luna）
  const id = model.trim().toLowerCase().split('/').pop() ?? ''
  if (!id) {
    return 'unknown'
  }
  if (NO.some((rule) => rule.test(id))) {
    return 'no'
  }
  return YES.some((rule) => rule.test(id)) ? 'yes' : 'unknown'
}

/** 各预设推荐的识图模型，用于提示与识图模型的占位 */
export const VISION_SUGGESTIONS: Record<AiPreset, string> = {
  deepseek: 'deepseek-flash',
  openai: 'gpt-6-luna',
  qwen: 'qwen3.7-plus',
  glm: 'glm-5v-turbo',
  kimi: 'kimi-k3.1-pro',
  custom: '',
}

export interface VisionProvider {
  apiKey: string
  baseUrl: string
  model: string
}

/** 识图模型：只填模型 ID 时沿用主接口的地址和 Key；未配置或与主模型相同时返回 null */
export function visionProvider(settings: {
  apiKey: string
  baseUrl: string
  model: string
  visionModel?: string
  visionBaseUrl?: string
  visionApiKey?: string
}): VisionProvider | null {
  const model = settings.visionModel?.trim() ?? ''
  const baseUrl = settings.visionBaseUrl?.trim() || settings.baseUrl
  if (!model || (model === settings.model.trim() && baseUrl === settings.baseUrl)) {
    return null
  }
  return { apiKey: settings.visionApiKey?.trim() || settings.apiKey, baseUrl, model }
}
