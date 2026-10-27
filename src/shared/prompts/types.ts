import type { NaiVersion, UcPreset } from '../generation/types'
import type { TagInfo } from '../tags/types'

export type TokenKind =
  | 'tag' // 普通 tag
  | 'text' // Text: 块 / 引号文字
  | 'natural' // 自然语言句子
  | 'action'
// source#/target#/mutual# 动作 tag

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
 * - rule  硬规则：tag 存在性、别名、版本、语法、正负面重复、人数/角色数、位置写法
 * - data  Danbooru 统计：引用数、共现、包含关系、wiki 释义
 * - doc   Skill 文档：官方文档或经验（evidence 中注明【官方】/【经验】）
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
  /** 原提示词里有、结果里被删掉且 changes 没有说明的内容（semantic 模式没有原提示词可比，为 null） */
  dropped: string[] | null
  /** 必须逐字保留却被改写的内容（画面文字），无论 changes 是否说明 */
  fidelity: string[]
  evidence: EvidenceInfo
}

export interface AiProgress {
  step: string
}

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

export type PreviewIssueKind =
  'unknown' | 'alias' | 'weak' | 'weight' | 'conflict' | 'warn' | 'redundant' | 'trait'

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

/* ---------- AI 局部重绘协作 ---------- */
export interface InpaintDraft {
  base: string
  negative: string
  characters: AiCharacter[]
}

export interface InpaintRegionInput {
  id: string
  /** Stable display label; responses must still match the full id. */
  label?: string
  instruction: string
  /** null = 自动识别；数字为从 0 开始的角色索引 */
  target: number | null
  mask: string
}

export interface AiInpaintRequest {
  imageName: string
  width: number
  height: number
  version: NaiVersion
  draft: InpaintDraft
  regions: InpaintRegionInput[]
}

export interface InpaintChange {
  field: 'base' | 'negative' | 'character' | 'characterNegative'
  characterIndex?: number
  before: string
  after: string
  reason: string
}

export interface InpaintPlan {
  id: string
  summary: string
  warning: string
  changes: InpaintChange[]
}

export interface AiInpaintResult {
  plans: InpaintPlan[]
  mode: 'vision'
  skills: string[]
}
