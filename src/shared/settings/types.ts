import type { NaiVersion } from '../generation/types'
import type { SkillEntry } from '../skills/types'
import type { AiPreset } from './ai-presets'

/** 设置页「测试识图」的结果 */
export interface VisionTestResult {
  ok: boolean
  message: string
}

export type ReasoningEffort = 'off' | 'low' | 'high' | 'max'

export interface Settings {
  aiPreset?: AiPreset
  workspaceAiCollapsed?: boolean
  /** Legacy profile data; ignored. The optional vision model is visionModel / visionBaseUrl / visionApiKey. */
  inpaintVision?: { apiKey: string; baseUrl: string; model: string }
  /** 识图模型：主模型不能识图时，带图片的请求改走它。为空表示未配置 */
  visionModel?: string
  /** 识图模型的接口地址，为空时沿用主接口 */
  visionBaseUrl?: string
  /** 识图模型的 API Key，为空时沿用主接口 */
  visionApiKey?: string
  apiKey: string
  baseUrl: string
  model: string
  /** DeepSeek 思考强度，off = 关闭思考模式 */
  reasoningEffort: ReasoningEffort
  /** 自动补全与 / 搜索共用的候选数量，默认 20。 */
  tagCompletionLimit?: number
  minPostCount: number
  naiVersion: NaiVersion
  /** AI 补译时只翻译引用数 >= 此值的 tag */
  translateMinCount: number
  /** NovelAI Persistent API Token（pst-...） */
  naiToken: string
  /** Agent 的非免费或费用未知操作需要用户逐次授权。默认开启。 */
  agentFreeOnly?: boolean
  /** 旧版手动生图设置，仅保留用于读取旧数据，不再决定权限。 */
  naiFreeOnly?: boolean
  /** 窗口不在前台时，生图、AI 等需要等待的任务完成后发系统通知并闪烁任务栏；默认开启 */
  notifyOnComplete?: boolean
  /** 普通生图按提交时的设置决定整批是否长期留存。 */
  naiAutoSave?: boolean
  /** 允许外部 agent（MCP）调用会消耗模型接口额度的工具 */
  mcpAllowAi: boolean
  /** 允许外部 agent（MCP）调用 NovelAI 生图（付费操作另行授权） */
  mcpAllowGenerate: boolean
  /** 启用的 Skill 与优先级（数组顺序 = 优先级，靠前的优先）；未设置时用默认组合 */
  skills?: SkillEntry[]
  /** 旧版「可直接修改的内置 Skill」是否已迁移为用户 Skill */
  skillsMigrated?: boolean
  /** 已处理的附带用户 Skill；删除或修改后不重新添加、不覆盖。 */
  initializedUserSkills?: string[]
  /** 旧版模板删除记录，仅用于迁移时尊重已有删除选择。 */
  deletedSkillTemplates?: string[]
}
