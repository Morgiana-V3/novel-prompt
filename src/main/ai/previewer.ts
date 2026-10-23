import { readFileSync } from 'node:fs'
import type {
  AiPreviewRequest,
  AiPreviewResult,
  AnalyzedToken,
  Basis,
  Confidence,
  NaiVersion,
  PreviewEffect,
  PreviewIssue,
  PreviewPoint,
  PreviewRisk,
  PreviewSuggestion,
  UcPreset
} from '../../shared/types'
import { CATEGORY_LABEL } from '../../shared/types'
import { QUALITY_TAGS, UC_LABEL, UC_PRESETS, isGridPosition, parsePosition } from '../../shared/nai-presets'
import { skillPath, type SkillFile } from '../paths'
import { analyzePrompt } from '../prompt/analyzer'
import { chat, extractJson, type ChatMessage } from './deepseek'
import { gatherEvidence } from './evidence'

/** 引用数低于此值视为效果弱 */
const WEAK_COUNT = 50
/** 权重高于此值视为过强 */
const HEAVY_WEIGHT = 1.6
const MAX_RETRY = 1


function loadSkill(name: SkillFile, fallback: string): string {
  try {
    return readFileSync(skillPath(name), 'utf8')
  } catch {
    return fallback
  }
}

/** 从优化 Skill 中截取第 1~8 节作为参考知识，截取失败时使用全文 */
function referenceKnowledge(): string {
  const doc = loadSkill('nai-prompt.md', '')
  const start = doc.search(/^## 1\./m)
  const end = doc.search(/^## 9\./m)
  return start >= 0 && end > start ? doc.slice(start, end).trim() : doc
}

function systemPrompt(version: NaiVersion): string {
  const v = version === 'v5' ? 'NAI Diffusion V5' : 'NAI Diffusion V4.5'
  return `${loadSkill('nai-preview.md', '你是 NovelAI 提示词解读专家，根据提示词推测成图效果。')}

---
# 参考知识（摘自提示词编排规范，仅用于理解提示词）
${referenceKnowledge()}

---
# 当前任务环境
- 目标模型：**${v}**
- 只输出一个 JSON 对象（不要多余文字），confidence 取值 high / medium / low，risks.level 取值 high / medium / low，basis 取值 rule / data / doc / taste（含义见上文「依据」一节）：
{"summary":"整体画面描述","confidence":"整体置信度","style":{"text":"画风与上色","tags":["关键 tag"],"confidence":"medium"},"composition":{"text":"构图、镜头、景别","tags":[],"confidence":"medium"},"scene":{"text":"背景与场景","tags":[],"confidence":"medium"},"lighting":{"text":"光影与色调","tags":[],"confidence":"medium"},"characters":[{"name":"角色称呼，如 角色 1 / 主角","position":"在画面中的位置，可空","text":"外貌、服装、表情、动作","tags":[],"confidence":"high"}],"emphasis":[{"tag":"被强调的 tag","effect":"会带来的效果"}],"suppressed":[{"tag":"负面中的 tag","effect":"被压制或推开的效果"}],"risks":[{"level":"medium","text":"风险说明","tags":["相关 tag"],"basis":"data","evidence":"依据"}],"gap":"与想要效果的差距，未提供期望则为空字符串","suggestions":[{"text":"具体修改建议","basis":"rule","evidence":"依据"}]}
- 没有角色提示词但画面里有人物时，characters 仍按画面里的人物逐个描述。`
}

const fmtW = (w: number) => String(Number(w.toFixed(2)))

function tokenLine(t: AnalyzedToken, i: number): string {
  const w = Math.abs(t.weight - 1) > 0.001 ? ` ×${fmtW(t.weight)}` : ''
  const pre = t.prefix ?? ''
  if (t.status === 'valid') {
    const tag = t.tag!
    const nai = tag.category === 100
    const info = [CATEGORY_LABEL[tag.category], nai ? 'NAI 专用' : String(tag.count), tag.zh].filter(Boolean).join('|')
    const weak = !nai && tag.count < WEAK_COUNT ? '，样本少效果弱' : ''
    return `${i}. ${pre}${tag.display}${w} [${info}${weak}]${t.warning ? ` ⚠${t.warning}` : ''}`
  }
  if (t.status === 'alias') {
    const a = t.aliasOf!
    return `${i}. ${pre}${t.core}${w} [非标准写法，标准为 ${a.display}${a.zh ? '|' + a.zh : ''}，识别可能偏弱]`
  }
  if (t.status === 'unknown') return `${i}. ${pre}${t.core}${w} [✗ 库中不存在，模型可能忽略或按字面理解]`
  if (t.status === 'natural') return `${i}. 「${t.core}」${w} [自然语言]`
  return `${i}. ${pre}${t.core} [画面文字]${t.warning ? ` ⚠${t.warning}` : ''}`
}

interface Section {
  label: string
  text: string
  tokens: AnalyzedToken[]
  negative: boolean
}

function section(label: string, text: string, negative: boolean, version: NaiVersion): Section {
  return { label, text: text.trim(), tokens: text.trim() ? analyzePrompt(text, version).tokens : [], negative }
}

function sectionBlock(s: Section, extra = ''): string {
  if (!s.text) return `## ${s.label}${extra}\n（空）`
  return `## ${s.label}${extra}\n原文：${s.text}\n本地解析（按顺序）：\n${s.tokens.map((t, i) => tokenLine(t, i + 1)).join('\n')}`
}

const nameOf = (t: AnalyzedToken) => (t.tag ?? t.aliasOf)?.name

function collectIssues(sections: Section[], presetTokens: AnalyzedToken[]): PreviewIssue[] {
  const issues: PreviewIssue[] = []
  const add = (kind: PreviewIssue['kind'], where: string, text: string, basis: PreviewIssue['basis'] = 'rule') =>
    issues.push({ kind, where, text, basis })
  for (const s of sections) {
    for (const t of s.tokens) {
      const raw = `${t.prefix ?? ''}${t.core}`
      if (t.status === 'unknown') add('unknown', s.label, `${raw} 在库中不存在`)
      else if (t.status === 'alias') add('alias', s.label, `${raw} 是别名，标准写法 ${t.aliasOf!.display}`)
      else if (t.status === 'valid' && t.tag!.category !== 100 && t.tag!.count < WEAK_COUNT)
        add('weak', s.label, `${t.tag!.display} 只有 ${t.tag!.count} 张图，效果可能很弱`, 'data')
      if (t.warning) add('warn', s.label, `${raw}：${t.warning}`)
      if (s.negative && t.weight < 0) add('weight', s.label, `${raw} 在负面里用了负权重（双重否定，结果难以预测）`)
      else if (t.weight > HEAVY_WEIGHT) add('weight', s.label, `${raw} 权重 ×${fmtW(t.weight)}，偏强，可能挤压其他元素（经验值，官方没有规定上限）`, 'doc')
    }
  }

  // 正负面冲突：正向（主 + 角色，忽略负权重）与全局负面 + UC 预设；角色正向与自身的角色负面
  const positiveNames = (list: Section[]) => {
    const map = new Map<string, string>()
    for (const s of list) for (const t of s.tokens) if (t.weight > 0 && nameOf(t)) map.set(nameOf(t)!, s.label)
    return map
  }
  const pos = positiveNames(sections.filter((s) => !s.negative))
  const globalNeg = sections.find((s) => s.label === '负面')
  const report = (tokens: AnalyzedToken[], where: string, against: Map<string, string>) => {
    const seen = new Set<string>()
    for (const t of tokens) {
      const n = nameOf(t)
      if (!n || seen.has(n) || !against.has(n)) continue
      seen.add(n)
      issues.push({ kind: 'conflict', where, basis: 'rule', text: `${(t.tag ?? t.aliasOf)!.display} 同时出现在${against.get(n)}和${where}，会互相抵消` })
    }
  }
  if (globalNeg) report(globalNeg.tokens, '负面', pos)
  report(presetTokens, 'UC 预设', pos)
  for (const s of sections) {
    const m = /^角色 (\d+) 负面$/.exec(s.label)
    if (!m) continue
    const own = sections.find((x) => x.label === `角色 ${m[1]}`)
    if (own) report(s.tokens, s.label, positiveNames([own]))
  }
  return issues
}

/** 位置写法：解析不了的在生图时会被忽略 */
function positionIssues(chars: AiPreviewRequest['characters'], version: NaiVersion): PreviewIssue[] {
  const out: PreviewIssue[] = []
  chars.forEach((c, i) => {
    const p = c.position?.trim()
    if (!p || !c.prompt?.trim()) return
    const where = `角色 ${i + 1}`
    if (!parsePosition(p))
      out.push({ kind: 'warn', where, basis: 'rule', text: `位置「${p}」无法解析，生图时会被忽略并自动排布；请写成 A1~E5 网格或 0.3,0.5 坐标` })
    else if (version === 'v4.5' && !isGridPosition(p))
      out.push({ kind: 'warn', where, basis: 'doc', text: `位置「${p}」是坐标写法；V4.5 官方只支持 5×5 网格，建议改成 A1~E5` })
  })
  return out
}

function paramsBlock(req: AiPreviewRequest): string {
  const { width, height, qualityTags, ucPreset } = req.params
  const shape = width > height * 1.1 ? '横图' : height > width * 1.1 ? '竖图' : '方图'
  const preset = UC_PRESETS[req.version][ucPreset]
  return [
    `## 生成参数`,
    `- 模型：${req.version === 'v5' ? 'V5' : 'V4.5'}`,
    `- 画幅：${width}×${height}（${shape}）`,
    `- Add Quality Tags：${qualityTags ? `开启，主提示词末尾隐式追加 \`${QUALITY_TAGS[req.version]}\`` : '关闭'}`,
    `- UC 预设：${UC_LABEL[ucPreset]}${preset ? `，负面隐式追加 \`${preset}\`` : ''}`
  ].join('\n')
}

const BASIS_ZH = { rule: '规则', data: '数据', doc: '文档', taste: '审美' }

/** 参数、逐段解析、本地问题、统计数据：推测时交给 AI，MCP 的 analyze_prompt 直接返回给 agent */
function reportBlocks(req: AiPreviewRequest, sections: Section[], issues: PreviewIssue[], evidenceBlock: string): string[] {
  const blocks = sections.map((s) => {
    const m = /^角色 (\d+)$/.exec(s.label)
    const pos = m ? req.characters[Number(m[1]) - 1]?.position?.trim() : ''
    return sectionBlock(s, pos ? `（位置：${pos}）` : '')
  })
  return [
    paramsBlock(req),
    ...blocks,
    issues.length ? `## 本地预检发现的问题（方括号内为依据类型）\n${issues.map((i) => `- [${i.where}|${BASIS_ZH[i.basis]}] ${i.text}`).join('\n')}` : '',
    evidenceBlock
  ]
}

function userPrompt(req: AiPreviewRequest, sections: Section[], issues: PreviewIssue[], evidenceBlock: string): string {
  const lines = [
    `请推测下面这套 NovelAI 提示词实际会画出的画面。`,
    ...reportBlocks(req, sections, issues, evidenceBlock),
    req.expectation.trim() ? `## 作者想要的效果\n${req.expectation.trim()}\n请对比推测结果，在 gap 中说明差距，在 suggestions 中给出具体到 tag 的修改建议。` : ''
  ]
  return lines.filter(Boolean).join('\n\n')
}

interface LocalReview {
  sections: Section[]
  issues: PreviewIssue[]
  tagCount: number
  ev: Awaited<ReturnType<typeof gatherEvidence>>
}

async function localReview(req: AiPreviewRequest, onStep: (s: string) => void, signal?: AbortSignal): Promise<LocalReview> {
  const sections: Section[] = [section('主提示词', req.base, false, req.version)]
  req.characters.forEach((c, i) => {
    sections.push(section(`角色 ${i + 1}`, c.prompt ?? '', false, req.version))
    if (c.negative?.trim()) sections.push(section(`角色 ${i + 1} 负面`, c.negative, true, req.version))
  })
  sections.push(section('负面', req.negative, true, req.version))

  const preset = UC_PRESETS[req.version][req.params.ucPreset]
  const presetTokens = preset ? analyzePrompt(preset, req.version).tokens : []
  const issues = collectIssues(sections, presetTokens)
  issues.push(...positionIssues(req.characters, req.version))
  const tagCount = sections.filter((s) => !s.negative).reduce((n, s) => n + s.tokens.length, 0)
  const ev = await gatherEvidence(sections, onStep, signal)
  issues.push(...ev.issues)
  return { sections, issues, tagCount, ev }
}

/** 不调用 AI 的完整本地检查报告（文本），供外部 agent 使用 */
export async function reviewPrompt(req: AiPreviewRequest, signal?: AbortSignal): Promise<string> {
  const r = await localReview(req, () => {}, signal)
  const head = `共 ${r.tagCount} 个正向元素，本地发现 ${r.issues.length} 个问题。tag 后方括号内依次为：分类|引用数|中文；×数字为实际权重。`
  return [head, ...reportBlocks(req, r.sections, r.issues, r.ev.block)].filter(Boolean).join('\n\n')
}

/* ---------- 结果规整 ---------- */

const CONF: Confidence[] = ['high', 'medium', 'low']
const BASES: Basis[] = ['rule', 'data', 'doc', 'taste']
const conf = (v: unknown, d: Confidence = 'medium'): Confidence => (CONF.includes(v as Confidence) ? (v as Confidence) : d)
const basis = (v: unknown): Basis => (BASES.includes(v as Basis) ? (v as Basis) : 'doc')
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

function point(v: unknown): PreviewPoint {
  const o = typeof v === 'string' ? { text: v } : obj(v)
  return { text: str(o.text), tags: strList(o.tags), confidence: conf(o.confidence) }
}

function effects(v: unknown): PreviewEffect[] {
  return (Array.isArray(v) ? v : []).map((e) => ({ tag: str(obj(e).tag), effect: str(obj(e).effect) })).filter((e) => e.tag || e.effect)
}

function normalize(raw: Record<string, unknown>): Omit<AiPreviewResult, 'issues' | 'tagCount' | 'evidence'> {
  return {
    summary: str(raw.summary),
    confidence: conf(raw.confidence),
    style: point(raw.style),
    composition: point(raw.composition),
    scene: point(raw.scene),
    lighting: point(raw.lighting),
    characters: (Array.isArray(raw.characters) ? raw.characters : []).map((c, i) => {
      const o = obj(c)
      return { ...point(o), name: str(o.name) || `角色 ${i + 1}`, position: str(o.position) || undefined }
    }),
    emphasis: effects(raw.emphasis),
    suppressed: effects(raw.suppressed),
    risks: (Array.isArray(raw.risks) ? raw.risks : [])
      .map((r): PreviewRisk => {
        const o = obj(r)
        return { level: conf(o.level, 'medium'), text: str(o.text), tags: strList(o.tags), basis: basis(o.basis), evidence: str(o.evidence) }
      })
      .filter((r) => r.text),
    gap: str(raw.gap),
    suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : [])
      .map((s): PreviewSuggestion => {
        const o = typeof s === 'string' ? { text: s } : obj(s)
        return { text: str(o.text), basis: basis(o.basis), evidence: str(o.evidence) }
      })
      .filter((s) => s.text)
  }
}

export async function previewPrompt(
  req: AiPreviewRequest,
  onStep: (s: string) => void,
  signal?: AbortSignal
): Promise<AiPreviewResult> {
  onStep('本地解析提示词…')
  const { sections, issues, tagCount, ev } = await localReview(req, onStep, signal)
  onStep(`共 ${tagCount} 个正向元素，本地发现 ${issues.length} 个问题`)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(req.version) },
    { role: 'user', content: userPrompt(req, sections, issues, ev.block) }
  ]

  for (let i = 0; i <= MAX_RETRY; i++) {
    onStep(i ? 'AI 重新整理输出格式…' : 'AI 正在想象画面…')
    const msg = await chat(messages, { temperature: 0.5, signal })
    try {
      const result = normalize(extractJson<Record<string, unknown>>(msg.content ?? ''))
      if (!result.summary) throw new Error('empty')
      onStep('完成')
      return { ...result, issues, tagCount, evidence: ev.info }
    } catch {
      messages.push({ role: 'assistant', content: msg.content ?? '' }, { role: 'user', content: '请只输出约定格式的 JSON 对象。' })
    }
  }
  throw new Error('AI 未返回有效结果，请重试')
}
