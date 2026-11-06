import { isUcPreset } from '../../../shared/generation/types'
import type { NaiVersion, UcPreset } from '../../../shared/generation/types'
import { NAI_VERSIONS, UC_PRESET_NAMES } from '../../../shared/generation/types'
import type { AiCharacter } from '../../../shared/prompts/types'
import { getSettings } from '../../modules/settings/service'

/* ---------- 参数解析 ---------- */

export const str = (value: unknown) => (typeof value === 'string' ? value : '')

export const bool = (value: unknown, value2: boolean) =>
  typeof value === 'boolean' ? value : value2

export const num = (value: unknown, fallback: number, min: number, max: number) => {
  const resolveN = () => {
    if (typeof value === 'number') {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      return Number(value)
    }
    return NaN
  }
  const numericValue = resolveN()
  return Number.isFinite(numericValue) ? Math.min(max, Math.max(min, numericValue)) : fallback
}

export const version = (value: unknown): NaiVersion =>
  value === 'v5' || value === 'v4.5' ? value : getSettings().naiVersion

export const ucPreset = (value: unknown): UcPreset =>
  isUcPreset(value as string) ? (value as UcPreset) : 'heavy'

export function characters(value: unknown): AiCharacter[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((character) => character && typeof character === 'object')
    .map((character) => ({
      prompt: str(character.prompt),
      negative: str(character.negative),
      position: str(character.position),
    }))
    .filter((character) => character.prompt.trim())
}

export const json = (value: unknown) => JSON.stringify(value, null, 2)

/** 宽高的原始输入被改动（无效、越界、非整数）时，说明实际使用的值 */
export function sizeNotes(argumentsRecord: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const [key, d] of [
    ['width', 832],
    ['height', 1216],
  ] as const) {
    const raw = argumentsRecord[key]
    if (raw === undefined || raw === null || raw === '') {
      continue
    }
    const used = num(raw, d, 64, 4096)
    const numericValue = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(numericValue)) {
      out.push(`${key}=${JSON.stringify(raw)} 不是有效数字，按默认值 ${d} 检查`)
    } else if (used !== numericValue) {
      out.push(
        `${key}=${numericValue} 超出 64~4096，按 ${used} 检查（原参数无效，不能直接用于生图）`,
      )
    }
  }
  return out
}

/* ---------- 公共 schema ---------- */

export const CHARACTERS_SCHEMA = {
  type: 'array',
  description:
    '角色/区域提示词，可描述人物、物件、招牌或局部背景。只拆分需要独立属性或定位的视觉单元；共享风格、环境和关系放 base。无独立定位需求时可留空。V5 最多 22 条，V4.5 最多 6 条；位置是引导而非硬分区。',
  items: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'girl/boy/other（不加数字）及该视觉单元的属性、动作；人物互动可配合 source#/target#/mutual#。Text: 放字段末尾，Base 和区域均支持；按文字归属选择，实际落点需看图确认。',
      },
      negative: { type: 'string', description: '角色负面，只放与其他角色相区分的特征，防止串色' },
      position: {
        type: 'string',
        description:
          '只支持两种写法：5×5 网格 A1~E5（列左→右，行上→下，C3 中心），或归一化坐标 "0.3,0.5"（0~1，原点左上，V5 用）。其他写法（如自然语言）会被忽略并自动排布',
      },
    },
    required: ['prompt'],
  },
}

export const PROMPT_PROPS = {
  base: { type: 'string', description: '主提示词（Base Prompt）' },
  negative: { type: 'string', description: '负面提示词（Undesired Content）' },
  characters: CHARACTERS_SCHEMA,
  version: {
    type: 'string',
    enum: NAI_VERSIONS,
    description: '目标模型（Full），默认使用软件里的设置',
  },
}

export const PARAM_PROPS = {
  quality_mode: {
    type: 'string',
    enum: ['standard', 'light'],
    description:
      '质量词档位，默认 standard；light 仅 V5，V4.5 使用 standard。quality_tags=false 时关闭。',
  },
  width: { type: 'integer', description: '宽，64 的倍数，默认 832' },
  height: { type: 'integer', description: '高，64 的倍数，默认 1216' },
  quality_tags: {
    type: 'boolean',
    description: '是否追加 NAI 的 Add Quality Tags（Standard 档，默认 true）',
  },
  uc_preset: {
    type: 'string',
    enum: UC_PRESET_NAMES,
    description: '追加到负面的 UC 预设，默认 heavy',
  },
}

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false }

export function aiGate(): string | null {
  const settings = getSettings()
  if (!settings.mcpAllowAi) {
    return '需要在 NovelPrompt「设置 → AI 服务 → Agent」中开启「允许调用 AI 服务」'
  }
  if (!settings.apiKey) {
    return '需要先在 NovelPrompt「设置 → AI 服务 → 模型接口」填写 API Key'
  }
  return null
}
