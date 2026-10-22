/** Danbooru 分类：0 通用 1 画师 3 版权 4 角色 5 元数据；100 = NovelAI 专用 tag */
export type TagCategory = 0 | 1 | 3 | 4 | 5 | 100

export const CATEGORY_LABEL: Record<TagCategory, string> = {
  0: '通用',
  1: '画师',
  3: '作品',
  4: '角色',
  5: '元数据',
  100: 'NAI'
}

export type NaiVersion = 'v4.5' | 'v5'

export interface TagInfo {
  /** danbooru 原始名（下划线） */
  name: string
  /** NAI 书写形式（空格，括号转义） */
  display: string
  category: TagCategory
  count: number
  zh?: string
  /** 仅对 NAI 专用 tag：适用版本 */
  versions?: NaiVersion[]
}

export interface SearchHit extends TagInfo {
  /** 命中的别名（如果是通过别名搜到的） */
  viaAlias?: string
  score: number
}

export interface SearchOptions {
  query: string
  categories?: TagCategory[]
  limit?: number
}

export type TokenKind =
  | 'tag' // 普通 tag
  | 'text' // Text: 块 / 引号文字
  | 'natural' // 自然语言句子
  | 'action' // source#/target#/mutual# 动作 tag

export type TokenStatus = 'valid' | 'alias' | 'unknown' | 'natural' | 'text'

export interface PromptToken {
  /** 在原文中的起止位置 */
  start: number
  end: number
  raw: string
  /** 去掉权重语法后的核心文本 */
  core: string
  kind: TokenKind
  /** 叠加后的权重 (1 = 无权重) */
  weight: number
  /** 前缀：artist: / source# 等 */
  prefix?: string
  /** 所属段落：0 = 主提示词，>=1 = 第 n 个 | 分段 */
  section: number
}

export interface AnalyzedToken extends PromptToken {
  status: TokenStatus
  tag?: TagInfo
  /** 别名指向的标准 tag */
  aliasOf?: TagInfo
  suggestions?: TagInfo[]
  warning?: string
}

export interface AnalysisResult {
  tokens: AnalyzedToken[]
  stats: {
    total: number
    valid: number
    alias: number
    unknown: number
    natural: number
    text: number
  }
}

export interface DbStatus {
  loaded: boolean
  tagCount: number
  aliasCount: number
  zhCount: number
  /** 包含关系条数（0 = 尚未下载） */
  implicationCount: number
  fetchedAt?: string
  minCount?: number
  /** 当前 tag 数据来自安装包内置（default）还是用户自己下载（user） */
  source?: 'default' | 'user'
}

export interface UpdateProgress {
  stage: 'tags' | 'aliases' | 'implications' | 'translations' | 'index' | 'done' | 'error' | 'ai-translate'
  message: string
  current?: number
  total?: number
}

export type ReasoningEffort = 'off' | 'low' | 'high' | 'max'

export interface Settings {
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

export type NaiSampler =
  | 'k_euler_ancestral'
  | 'k_euler'
  | 'k_dpmpp_2s_ancestral'
  | 'k_dpmpp_2m_sde'
  | 'k_dpmpp_2m'
  | 'k_dpmpp_sde'

export type NaiNoiseSchedule = 'native' | 'karras' | 'exponential' | 'polyexponential'

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

export interface NaiImage {
  /** 文件名（位于本地图库目录） */
  name: string
  /** 渲染进程可直接使用的地址 */
  url: string
  seed?: number
  width?: number
  height?: number
  createdAt: number
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

export interface AiOptimizeRequest {
  mode: 'optimize' | 'semantic'
  /** 现有提示词 */
  prompt: string
  /** 现有负面提示词（可空） */
  negative: string
  /** 现有角色提示词（可空） */
  characters: AiCharacter[]
  /** 语义描述 / 额外要求 */
  instruction: string
  version: NaiVersion
}

export interface AiCharacter {
  prompt: string
  position?: string
  /** 角色专属负面提示词，用于防止其他角色的特征串过来 */
  negative?: string
}

/**
 * 建议的依据，按可靠程度从高到低：
 * - rule  硬规则：tag 存在性、别名、版本、语法、正负面重复、人数/角色数、位置格式
 * - data  Danbooru 统计：引用数、共现、包含关系、wiki 释义
 * - doc   官方文档 / 社区经验（Skill 文档）
 * - taste 审美偏好：只能作为可选建议，不能直接改动提示词
 */
export type Basis = 'rule' | 'data' | 'doc' | 'taste'

export type ChangeScope = 'positive' | 'character' | 'negative' | 'optional'

export interface AiChange {
  scope: ChangeScope
  text: string
  basis: Basis
  /** 具体依据：引用的数据、规则或文档章节 */
  evidence: string
}

/** 本次参考了哪些 Danbooru 统计数据 */
export interface EvidenceInfo {
  /** 查到共现数据的角色 / 画师 / 作品 tag */
  related: string[]
  /** 查到释义的 tag */
  wiki: string[]
  /** 因网络问题没拿到的 tag */
  failed: string[]
  /** 本地是否有包含关系数据 */
  implications: boolean
}

export interface AiOptimizeResult {
  positive: string
  negative: string
  characters: AiCharacter[]
  /** 整体评估 */
  notes: string
  /** 逐条修改与建议（带依据） */
  changes: AiChange[]
  /** 本地校验仍不存在的 tag */
  invalid: string[]
  evidence: EvidenceInfo
}

export interface AiProgress {
  step: string
}

/* ---------- 画面推测 ---------- */

/** NAI 前端自动注入的 UC 预设 */
export type UcPreset = 'heavy' | 'light' | 'human' | 'none'

export interface PreviewParams {
  width: number
  height: number
  /** NAI 前端「Add Quality Tags」是否开启 */
  qualityTags: boolean
  ucPreset: UcPreset
}

export interface AiPreviewRequest {
  base: string
  negative: string
  characters: AiCharacter[]
  params: PreviewParams
  /** 用户想要的效果（可空），填写后对比差距 */
  expectation: string
  version: NaiVersion
}

export type Confidence = 'high' | 'medium' | 'low'

export interface PreviewPoint {
  text: string
  /** 产生该效果的关键 tag */
  tags: string[]
  confidence: Confidence
}

export interface PreviewCharacter extends PreviewPoint {
  name: string
  position?: string
}

export interface PreviewEffect {
  tag: string
  effect: string
}

export interface PreviewRisk {
  level: 'high' | 'medium' | 'low'
  text: string
  tags: string[]
  basis: Basis
  evidence: string
}

export interface PreviewSuggestion {
  text: string
  basis: Basis
  evidence: string
}

export type PreviewIssueKind = 'unknown' | 'alias' | 'weak' | 'weight' | 'conflict' | 'warn' | 'redundant' | 'trait'

/** 本地预检发现的问题（不经过 AI） */
export interface PreviewIssue {
  kind: PreviewIssueKind
  /** 所在位置：主提示词 / 角色 1 / 负面 … */
  where: string
  text: string
  basis: Basis
}

export interface AiPreviewResult {
  summary: string
  confidence: Confidence
  style: PreviewPoint
  composition: PreviewPoint
  scene: PreviewPoint
  lighting: PreviewPoint
  characters: PreviewCharacter[]
  /** 被权重强调的元素 */
  emphasis: PreviewEffect[]
  /** 被负面压制的元素 */
  suppressed: PreviewEffect[]
  risks: PreviewRisk[]
  /** 与期望效果的差距（未填写期望时为空） */
  gap: string
  suggestions: PreviewSuggestion[]
  issues: PreviewIssue[]
  tagCount: number
  evidence: EvidenceInfo
}
