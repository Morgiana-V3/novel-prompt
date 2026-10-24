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
  /** 允许外部 agent（MCP）调用会消耗 DeepSeek 额度的工具 */
  mcpAllowAi: boolean
  /** 允许外部 agent（MCP）调用 NovelAI 生图（强制只用免费额度） */
  mcpAllowGenerate: boolean
  /** 启用的 Skill 与优先级（数组顺序 = 优先级，靠前的优先）；未设置时用默认组合 */
  skills?: SkillEntry[]
  /** 旧版「可直接修改的内置 Skill」是否已迁移为用户 Skill */
  skillsMigrated?: boolean
}

/* ---------- Skill ---------- */

/** 作用范围：optimize = AI 优化 / 描述转提示词，preview = 画面推测，inpaint = 局部重绘批注优化 */
export type SkillScope = 'optimize' | 'preview' | 'inpaint' | 'all'
/** 适用模型 */
export type SkillModel = 'all' | 'v4.5' | 'v5'

export interface SkillEntry {
  id: string
  enabled: boolean
}

export interface SkillMeta {
  /** 内置为 builtin:xxx，用户 Skill 为文件名（不含 .md） */
  id: string
  name: string
  description: string
  scope: SkillScope
  model: SkillModel
  builtin: boolean
  /** 正文字数 */
  chars: number
  updatedAt: number
}

export interface SkillDoc extends SkillMeta {
  /** 正文（不含 frontmatter） */
  content: string
}

/** 启用状态与优先级，按优先级排列；包含全部 Skill */
export interface SkillConfigItem extends SkillMeta {
  enabled: boolean
}

export interface SkillInput {
  name: string
  description?: string
  scope?: SkillScope
  model?: SkillModel
  content: string
}

export interface McpLogEntry {
  at: number
  tool: string
  ok: boolean
  ms: number
  summary: string
}

export interface McpInfo {
  command: string
  args: string[]
  env: Record<string, string>
  packaged: boolean
  /** 便携版：路径不固定，无法配置给 agent */
  portable: boolean
  log: McpLogEntry[]
}

export interface UpdateInfo {
  /** 当前安装的版本 */
  current: string
  /** 最新版本号（检查失败时为空） */
  latest: string
  /** latest 是否比 current 新 */
  newer: boolean
  /** release 页面地址 */
  url: string
  /** release 正文（截断后） */
  notes?: string
  /** 上次成功检查的时间戳，0 = 从未检查成功过 */
  checkedAt: number
  /** 本次检查失败的原因（静默展示，不影响使用） */
  error?: string
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

/** 局部重绘使用图库原图的尺寸，遮罩为同尺寸 PNG（白色重绘，黑色保留）。 */
export interface NaiInpaintRequest extends NaiGenRequest {
  inpaint: {
    imageName: string
    mask: string
    strength: number
  }
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

/* ---------- AI 局部重绘协作 ---------- */
export interface InpaintDraft { base: string; negative: string; characters: AiCharacter[] }
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
export interface InpaintPlan { id: string; summary: string; warning: string; changes: InpaintChange[] }
export interface AiInpaintResult { plans: InpaintPlan[]; mode: 'vision'; skills: string[] }
