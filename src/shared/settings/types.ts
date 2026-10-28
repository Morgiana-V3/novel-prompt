import type { NaiVersion } from '../generation/types'
import type { SkillEntry } from '../skills/types'

export type ReasoningEffort = 'off' | 'low' | 'high' | 'max'

export interface Settings {
  /** Legacy profile data; inpainting now uses the shared AI configuration. */
  inpaintVision?: { apiKey: string; baseUrl: string; model: string }
  apiKey: string
  baseUrl: string
  model: string
  /** DeepSeek 思考强度，off = 关闭思考模式 */
  reasoningEffort: ReasoningEffort
  minPostCount: number
  naiVersion: NaiVersion
  /** AI 补译时只翻译引用数 >= 此值的 tag */
  translateMinCount: number
  /** NovelAI Persistent API Token（pst-...） */
  naiToken: string
  /** 只允许不消耗 Anlas 的生成：生成前检查免费条件，生成后核对余额 */
  naiFreeOnly: boolean
  /** 普通生图按提交时的设置决定整批是否长期留存。 */
  naiAutoSave?: boolean
  /** 允许外部 agent（MCP）调用会消耗 DeepSeek 额度的工具 */
  mcpAllowAi: boolean
  /** 允许外部 agent（MCP）调用 NovelAI 生图（强制只用免费额度） */
  mcpAllowGenerate: boolean
  /** 启用的 Skill 与优先级（数组顺序 = 优先级，靠前的优先）；未设置时用默认组合 */
  skills?: SkillEntry[]
  /** 旧版「可直接修改的内置 Skill」是否已迁移为用户 Skill */
  skillsMigrated?: boolean
  /** 用户删除的随附模板；升级与重启后不重新添加，不影响已复制的 Skill。 */
  deletedSkillTemplates?: string[]
}
