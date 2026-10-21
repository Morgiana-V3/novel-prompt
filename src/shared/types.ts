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
  fetchedAt?: string
  minCount?: number
  /** 当前 tag 数据来自安装包内置（default）还是用户自己下载（user） */
  source?: 'default' | 'user'
}

export interface UpdateProgress {
  stage: 'tags' | 'aliases' | 'translations' | 'index' | 'done' | 'error' | 'ai-translate'
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
}

export interface AiOptimizeRequest {
  mode: 'optimize' | 'semantic'
  /** 现有提示词 */
  prompt: string
  /** 现有负面提示词（可空） */
  negative: string
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

export interface AiOptimizeResult {
  positive: string
  negative: string
  characters: AiCharacter[]
  notes: string
  /** 本地校验仍不存在的 tag */
  invalid: string[]
}

export interface AiProgress {
  step: string
}
