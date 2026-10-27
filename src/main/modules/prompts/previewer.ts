import {
  MAX_CHARACTERS,
  QUALITY_TAGS,
  TEXT_MAX_CHARS,
  UC_LABEL,
  UC_PRESETS,
  isGridPosition,
  parsePosition,
} from '../../../shared/generation/presets'
import type { NaiVersion } from '../../../shared/generation/types'
import type {
  AiPreviewRequest,
  AiPreviewResult,
  AnalyzedToken,
  Basis,
  Confidence,
  PreviewEffect,
  PreviewIssue,
  PreviewPoint,
  PreviewRisk,
  PreviewSuggestion,
} from '../../../shared/prompts/types'
import { CATEGORY_LABEL } from '../../../shared/tags/types'
import { extractJson, type ChatMessage } from '../../providers/chat/client'
import { composeSkills } from '../skills/service'
import { analyzePrompt } from './analyzer'
import { chat } from './chat'
import { gatherEvidence } from './evidence'

/** 引用数低于此值视为效果弱 */
const WEAK_COUNT = 50
/** 权重高于此值视为过强 */
const HEAVY_WEIGHT = 1.6
const MAX_RETRY = 1

function systemPrompt(version: NaiVersion): string {
  const modelName = version === 'v5' ? 'NAI Diffusion V5' : 'NAI Diffusion V4.5'
  return `${composeSkills('preview', version).text}

---
# 程序约定（优先于所有 Skill）
- 你的任务是根据提示词推测成图效果（不是优化提示词）。用户消息里的「本地解析」是程序对每个 tag 的真实查询结果，以它为准。
- 目标模型：**${modelName}**
- 只输出一个 JSON 对象（不要多余文字），confidence 取值 high / medium / low，risks.level 取值 high / medium / low，basis 取值 rule（可被程序校验的硬规则）/ data（统计数据）/ doc（依据启用的 Skill 或官方文档，evidence 写出 Skill 名称）/ taste（审美判断）：
{"summary":"整体画面描述","confidence":"整体置信度","style":{"text":"画风与上色","tags":["关键 tag"],"confidence":"medium"},"composition":{"text":"构图、镜头、景别","tags":[],"confidence":"medium"},"scene":{"text":"背景与场景","tags":[],"confidence":"medium"},"lighting":{"text":"光影与色调","tags":[],"confidence":"medium"},"characters":[{"name":"角色称呼，如 角色 1 / 主角","position":"在画面中的位置，可空","text":"外貌、服装、表情、动作","tags":[],"confidence":"high"}],"emphasis":[{"tag":"被强调的 tag","effect":"会带来的效果"}],"suppressed":[{"tag":"负面中的 tag","effect":"被压制或推开的效果"}],"risks":[{"level":"medium","text":"风险说明","tags":["相关 tag"],"basis":"data","evidence":"依据"}],"gap":"与想要效果的差距，未提供期望则为空字符串","suggestions":[{"text":"具体修改建议","basis":"rule","evidence":"依据"}]}
- 全部用简体中文输出；tag 原样引用英文。
- 没有角色提示词但画面里有人物时，characters 仍按画面里的人物逐个描述。`
}

const fmtW = (width: number) => String(Number(width.toFixed(2)))

function tokenLine(analyzedToken: AnalyzedToken, i: number): string {
  const text = Math.abs(analyzedToken.weight - 1) > 0.001 ? ` ×${fmtW(analyzedToken.weight)}` : ''
  const pre = analyzedToken.prefix ?? ''
  if (analyzedToken.status === 'valid') {
    const tag = analyzedToken.tag!
    const nai = tag.category === 100
    const info = [CATEGORY_LABEL[tag.category], nai ? 'NAI 专用' : String(tag.count), tag.zh]
      .filter(Boolean)
      .join('|')
    const weak = !nai && tag.count < WEAK_COUNT ? '，样本少效果弱' : ''
    return `${i}. ${pre}${tag.display}${text} [${info}${weak}]${analyzedToken.warning ? ` ⚠${analyzedToken.warning}` : ''}`
  }
  if (analyzedToken.status === 'alias') {
    const tag = analyzedToken.aliasOf!
    return `${i}. ${pre}${analyzedToken.core}${text} [非标准写法，标准为 ${tag.display}${tag.zh ? '|' + tag.zh : ''}，识别可能偏弱]`
  }
  if (analyzedToken.status === 'unknown') {
    return `${i}. ${pre}${analyzedToken.core}${text} [✗ 库中不存在，模型可能忽略或按字面理解]`
  }
  if (analyzedToken.status === 'natural') {
    return `${i}. 「${analyzedToken.core}」${text} [自然语言]`
  }
  return `${i}. ${pre}${analyzedToken.core} [画面文字]${analyzedToken.warning ? ` ⚠${analyzedToken.warning}` : ''}`
}

interface Section {
  label: string
  text: string
  tokens: AnalyzedToken[]
  negative: boolean
}

function section(label: string, text: string, negative: boolean, version: NaiVersion): Section {
  return {
    label,
    text: text.trim(),
    tokens: text.trim() ? analyzePrompt(text, version).tokens : [],
    negative,
  }
}

function sectionBlock(section2: Section, extra = ''): string {
  if (!section2.text) {
    return `## ${section2.label}${extra}\n（空）`
  }
  return `## ${section2.label}${extra}\n原文：${section2.text}\n本地解析（按顺序）：\n${section2.tokens.map((analyzedToken, i) => tokenLine(analyzedToken, i + 1)).join('\n')}`
}

const nameOf = (analyzedToken: AnalyzedToken) => (analyzedToken.tag ?? analyzedToken.aliasOf)?.name

function collectIssues(sections: Section[], presetTokens: AnalyzedToken[]): PreviewIssue[] {
  const issues: PreviewIssue[] = []
  const add = (
    kind: PreviewIssue['kind'],
    where: string,
    text: string,
    basis: PreviewIssue['basis'] = 'rule',
  ) => issues.push({ kind, where, text, basis })
  for (const section2 of sections) {
    for (const analyzedToken of section2.tokens) {
      const raw = `${analyzedToken.prefix ?? ''}${analyzedToken.core}`
      if (analyzedToken.status === 'unknown') {
        add('unknown', section2.label, `${raw} 在库中不存在`)
      } else if (analyzedToken.status === 'alias') {
        add('alias', section2.label, `${raw} 是别名，标准写法 ${analyzedToken.aliasOf!.display}`)
      } else if (
        analyzedToken.status === 'valid' &&
        analyzedToken.tag!.category !== 100 &&
        analyzedToken.tag!.count < WEAK_COUNT
      ) {
        add(
          'weak',
          section2.label,
          `${analyzedToken.tag!.display} 只有 ${analyzedToken.tag!.count} 张图，效果可能很弱`,
          'data',
        )
      }
      if (analyzedToken.warning) {
        add('warn', section2.label, `${raw}：${analyzedToken.warning}`)
      }
      if (section2.negative && analyzedToken.weight < 0) {
        add('weight', section2.label, `${raw} 在负面里用了负权重（双重否定，结果难以预测）`)
      } else if (analyzedToken.weight > HEAVY_WEIGHT) {
        add(
          'weight',
          section2.label,
          `${raw} 权重 ×${fmtW(analyzedToken.weight)}，偏强，可能挤压其他元素（经验值，官方没有规定上限）`,
          'doc',
        )
      }
    }
  }

  // 正负面冲突：只看实际生效的词（权重 > 0）。负面里 0::tag:: 不起作用、负数权重另有提示，都不算排除
  const positiveNames = (list: Section[]) => {
    const map = new Map<string, string>()
    for (const section3 of list) {
      for (const analyzedToken of section3.tokens) {
        if (analyzedToken.weight > 0 && nameOf(analyzedToken)) {
          map.set(nameOf(analyzedToken)!, section3.label)
        }
      }
    }
    return map
  }
  const pos = positiveNames(sections.filter((section3) => !section3.negative))
  const globalNeg = sections.find((section3) => section3.label === '负面')
  const report = (
    tokens: AnalyzedToken[],
    where: string,
    against: Map<string, string>,
    seen = new Set<string>(),
  ) => {
    for (const analyzedToken of tokens) {
      const text = nameOf(analyzedToken)
      if (!text || analyzedToken.weight <= 0 || seen.has(text) || !against.has(text)) {
        continue
      }
      seen.add(text)
      issues.push({
        kind: 'conflict',
        where,
        basis: 'rule',
        text: `${(analyzedToken.tag ?? analyzedToken.aliasOf)!.display} 同时出现在${against.get(text)}和${where}，会互相抵消`,
      })
    }
    return seen
  }
  if (globalNeg) {
    report(globalNeg.tokens, '负面', pos)
  }
  report(presetTokens, 'UC 预设', pos)
  const basePos = positiveNames(sections.filter((section3) => section3.label === '主提示词'))
  for (const section4 of sections) {
    const match = /^角色 (\d+) 负面$/.exec(section4.label)
    if (!match) {
      continue
    }
    const own = sections.find((section3) => section3.label === `角色 ${match[1]}`)
    const seen = own
      ? report(section4.tokens, section4.label, positiveNames([own]))
      : new Set<string>()
    // 主提示词作用于整幅画面，与某个角色的负面同词时归属不清，提示核对而不是直接判冲突
    for (const analyzedToken of section4.tokens) {
      const text = nameOf(analyzedToken)
      if (!text || analyzedToken.weight <= 0 || seen.has(text) || !basePos.has(text)) {
        continue
      }
      seen.add(text)
      issues.push({
        kind: 'warn',
        where: section4.label,
        basis: 'rule',
        text: `${(analyzedToken.tag ?? analyzedToken.aliasOf)!.display} 写在主提示词（作用于整幅画面），又出现在${section4.label}：请确认归属——属于其他角色就移到对应角色提示词，属于全局就从${section4.label}删除`,
      })
    }
  }
  return issues
}

const TEXT_SUPPRESS = new Set([
  'text',
  'english_text',
  'chinese_text',
  'japanese_text',
  'speech_bubble',
  'no_text',
])

/** 画面文字相关：Text: 块（主提示词或角色提示词末尾）与质量词 / 负面的冲突、版本与长度 */
function textIssues(
  req: AiPreviewRequest,
  sections: Section[],
  presetTokens: AnalyzedToken[],
): PreviewIssue[] {
  const out: PreviewIssue[] = []
  const main = sections[0]
  // 属于某个人物 / 格子的文字写在对应角色提示词末尾是推荐写法，这里只收集各处的 Text: 块
  const texts = sections
    .filter((section2) => !section2.negative)
    .flatMap((section2) =>
      section2.tokens
        .filter((analyzedToken) => analyzedToken.status === 'text' && analyzedToken.prefix)
        .map((analyzedToken) => [section2.label, analyzedToken] as const),
    )
  if (!texts.length) {
    return out
  }
  const display = (analyzedToken: AnalyzedToken) =>
    (analyzedToken.tag ?? analyzedToken.aliasOf)!.display
  if (req.params.qualityTags) {
    out.push({
      kind: 'warn',
      where: '主提示词',
      basis: 'doc',
      text: `有 Text: 块，但开启了 Add Quality Tags，会隐式追加 no text，可能压制画面文字；短文字建议关闭`,
    })
  }
  for (const analyzedToken2 of main?.tokens ?? []) {
    if (analyzedToken2.weight > 0 && nameOf(analyzedToken2) === 'no_text') {
      out.push({
        kind: 'conflict',
        where: '主提示词',
        basis: 'rule',
        text: '主提示词里的 no text 与 Text: 块冲突',
      })
    }
  }
  const negs: [string, AnalyzedToken[]][] = [
    ...sections
      .filter((section2) => section2.negative)
      .map((section2) => [section2.label, section2.tokens] as [string, AnalyzedToken[]]),
    ['UC 预设', presetTokens],
  ]
  for (const [where, tokens] of negs) {
    const owner = /^角色 (\d+) 负面$/.exec(where)
    const ownLabel = owner ? `角色 ${owner[1]}` : null
    // A character's negative applies to its own text, not dialogue in other panels.
    if (ownLabel && !texts.some(([label]) => label === ownLabel)) {
      continue
    }
    const posNames = new Set(
      sections
        .filter((section2) => !section2.negative && (!ownLabel || section2.label === ownLabel))
        .flatMap((section2) =>
          section2.tokens.filter((analyzedToken) => analyzedToken.weight > 0).map(nameOf),
        ),
    )
    const hit = [
      ...new Set(
        tokens
          .filter(
            (analyzedToken) =>
              analyzedToken.weight > 0 &&
              nameOf(analyzedToken) &&
              nameOf(analyzedToken) !== 'no_text' &&
              TEXT_SUPPRESS.has(nameOf(analyzedToken)!) &&
              !posNames.has(nameOf(analyzedToken)),
          )
          .map(display),
      ),
    ]
    if (hit.length) {
      out.push({
        kind: 'conflict',
        where,
        basis: 'rule',
        text: `${where}里的 ${hit.join(', ')} 会压制画面文字，与 Text: 块冲突`,
      })
    }
  }
  const limit = TEXT_MAX_CHARS[req.version]
  for (const [where, text] of texts) {
    if (req.version === 'v4.5' && /[^\x00-\x7f]/.test(text.core)) {
      out.push({
        kind: 'warn',
        where,
        basis: 'doc',
        text: 'V4.5 的 Text: 只支持英文，这里含有非 ASCII 字符',
      })
    }
    if (text.core.length > limit) {
      out.push({
        kind: 'warn',
        where,
        basis: 'doc',
        text: `画面文字 ${text.core.length} 字符，超过 ${req.version === 'v5' ? 'V5 Full' : 'V4.5'} 约 ${limit} 字符的上限`,
      })
    }
  }
  return out
}

const COUNT_RE = /^(\d+)(\+)?(girl|boy|other)s?$/

/** 结构：角色数上限、人数 tag 与角色数、互动前缀位置与配对、画幅 */
function structureIssues(req: AiPreviewRequest, sections: Section[]): PreviewIssue[] {
  const out: PreviewIssue[] = []
  const chars = req.characters.filter((character) => character.prompt?.trim())
  const limit = MAX_CHARACTERS[req.version]
  if (chars.length > limit) {
    out.push({
      kind: 'warn',
      where: '角色',
      basis: 'doc',
      text: `角色提示词有 ${chars.length} 个，超过 ${req.version === 'v5' ? 'V5' : 'V4.5'} 的上限 ${limit} 个`,
    })
  }

  const main = sections[0]
  let heads = 0
  let plus = false
  for (const analyzedToken of main?.tokens ?? []) {
    const match = COUNT_RE.exec(nameOf(analyzedToken) ?? '')
    if (!match || analyzedToken.weight <= 0) {
      continue
    }
    heads += Number(match[1])
    if (match[2]) {
      plus = true
    }
  }
  if (chars.length && heads && (plus ? chars.length < heads : chars.length !== heads)) {
    out.push({
      kind: 'warn',
      where: '主提示词',
      basis: 'doc',
      text: `人数 tag 合计 ${heads}${plus ? '+' : ''} 人，角色提示词有 ${chars.length} 个：通常每个需要区分外貌的人物对应一个角色提示词，请确认人数与各角色用途（同一人物多次出现、多格漫画等情况可忽略）`,
    })
  } else if (chars.length >= 2 && !heads) {
    out.push({
      kind: 'warn',
      where: '主提示词',
      basis: 'doc',
      text: `有 ${chars.length} 个角色提示词，但主提示词没有人数 tag（如 2girls / 1girl, 1boy）`,
    })
  }

  for (const analyzedToken2 of main?.tokens ?? []) {
    if (analyzedToken2.kind === 'action') {
      out.push({
        kind: 'warn',
        where: '主提示词',
        basis: 'doc',
        text: `${analyzedToken2.prefix}${analyzedToken2.core} 写在主提示词里：source# / target# / mutual# 只在角色提示词中使用（NovelAI 官方语法）`,
      })
    }
  }

  const roles = new Map<string, { source: number[]; target: number[]; mutual: number[] }>()
  sections.forEach((section2) => {
    const match = /^角色 (\d+)$/.exec(section2.label)
    if (!match) {
      return
    }
    for (const analyzedToken3 of section2.tokens) {
      if (analyzedToken3.kind !== 'action') {
        continue
      }
      const key = analyzedToken3.core.trim().toLowerCase()
      const interactionRoles = roles.get(key) ?? { source: [], target: [], mutual: [] }
      interactionRoles[
        analyzedToken3.prefix!.replace('#', '') as 'source' | 'target' | 'mutual'
      ].push(Number(match[1]))
      roles.set(key, interactionRoles)
    }
  })
  for (const [act, r] of roles) {
    if (r.source.length && !r.target.length) {
      out.push({
        kind: 'warn',
        where: `角色 ${r.source.join('、')}`,
        basis: 'doc',
        text: `写了 source#${act}，但没有角色写 target#${act}，被动方不明确`,
      })
    }
    if (r.target.length && !r.source.length) {
      out.push({
        kind: 'warn',
        where: `角色 ${r.target.join('、')}`,
        basis: 'doc',
        text: `写了 target#${act}，但没有角色写 source#${act}，主动方不明确`,
      })
    }
    if (r.mutual.length === 1) {
      out.push({
        kind: 'warn',
        where: `角色 ${r.mutual[0]}`,
        basis: 'doc',
        text: `mutual#${act} 只写在一个角色里，对等互动需要双方都写`,
      })
    }
  }

  for (const [label, v] of [
    ['宽', req.params.width],
    ['高', req.params.height],
  ] as const) {
    if (v % 64) {
      out.push({
        kind: 'warn',
        where: '生成参数',
        basis: 'rule',
        text: `${label} ${v} 不是 64 的倍数，本软件生图时会取整为 ${Math.round(v / 64) * 64}`,
      })
    }
  }
  return out
}

/** 位置写法：解析不了的在生图时会被忽略 */
function positionIssues(
  chars: AiPreviewRequest['characters'],
  version: NaiVersion,
): PreviewIssue[] {
  const out: PreviewIssue[] = []
  chars.forEach((character, i) => {
    const path = character.position?.trim()
    if (!path || !character.prompt?.trim()) {
      return
    }
    const where = `角色 ${i + 1}`
    if (!parsePosition(path)) {
      out.push({
        kind: 'warn',
        where,
        basis: 'rule',
        text: `位置「${path}」无法解析，生图时会被忽略并自动排布；请写成 A1~E5 网格或 0.3,0.5 坐标`,
      })
    } else if (version === 'v4.5' && !isGridPosition(path)) {
      out.push({
        kind: 'warn',
        where,
        basis: 'doc',
        text: `位置「${path}」是坐标写法；V4.5 官方只支持 5×5 网格，建议改成 A1~E5`,
      })
    }
  })
  return out
}

function paramsBlock(req: AiPreviewRequest): string {
  const { width, height, qualityTags, ucPreset } = req.params
  const resolveShape = () => {
    if (width > height * 1.1) {
      return '横图' as const
    }
    if (height > width * 1.1) {
      return '竖图' as const
    }
    return '方图' as const
  }
  const shape = resolveShape()
  const preset = UC_PRESETS[req.version][ucPreset]
  return [
    `## 生成参数`,
    `- 模型：${req.version === 'v5' ? 'V5' : 'V4.5'}`,
    `- 画幅：${width}×${height}（${shape}）`,
    `- Add Quality Tags：${qualityTags ? `开启，主提示词末尾隐式追加 \`${QUALITY_TAGS[req.version]}\`` : '关闭'}`,
    `- UC 预设：${UC_LABEL[ucPreset]}${preset ? `，负面隐式追加 \`${preset}\`` : ''}`,
  ].join('\n')
}

const BASIS_ZH = { rule: '规则', data: '数据', doc: '文档', taste: '审美' }

/** 参数、逐段解析、本地问题、统计数据：推测时交给 AI，MCP 的 analyze_prompt 直接返回给 agent */
function reportBlocks(
  req: AiPreviewRequest,
  sections: Section[],
  issues: PreviewIssue[],
  evidenceBlock: string,
): string[] {
  const blocks = sections.map((section2) => {
    const match = /^角色 (\d+)$/.exec(section2.label)
    const pos = match ? req.characters[Number(match[1]) - 1]?.position?.trim() : ''
    return sectionBlock(section2, pos ? `（位置：${pos}）` : '')
  })
  return [
    paramsBlock(req),
    ...blocks,
    issues.length
      ? `## 本地预检发现的问题（方括号内为依据类型）\n${issues.map((issue) => `- [${issue.where}|${BASIS_ZH[issue.basis]}] ${issue.text}`).join('\n')}`
      : '',
    evidenceBlock,
  ]
}

function userPrompt(
  req: AiPreviewRequest,
  sections: Section[],
  issues: PreviewIssue[],
  evidenceBlock: string,
): string {
  const lines = [
    `请推测下面这套 NovelAI 提示词实际会画出的画面。`,
    ...reportBlocks(req, sections, issues, evidenceBlock),
    req.expectation.trim()
      ? `## 作者想要的效果\n${req.expectation.trim()}\n请对比推测结果，在 gap 中说明差距，在 suggestions 中给出具体到 tag 的修改建议。`
      : '',
  ]
  return lines.filter(Boolean).join('\n\n')
}

interface LocalReview {
  sections: Section[]
  issues: PreviewIssue[]
  tagCount: number
  ev: Awaited<ReturnType<typeof gatherEvidence>>
}

async function localReview(
  req: AiPreviewRequest,
  onStep: (text: string) => void,
  signal?: AbortSignal,
): Promise<LocalReview> {
  const sections: Section[] = [section('主提示词', req.base, false, req.version)]
  req.characters.forEach((character, i) => {
    sections.push(section(`角色 ${i + 1}`, character.prompt ?? '', false, req.version))
    if (character.negative?.trim()) {
      sections.push(section(`角色 ${i + 1} 负面`, character.negative, true, req.version))
    }
  })
  sections.push(section('负面', req.negative, true, req.version))

  const preset = UC_PRESETS[req.version][req.params.ucPreset]
  const presetTokens = preset ? analyzePrompt(preset, req.version).tokens : []
  const issues = collectIssues(sections, presetTokens)
  issues.push(...textIssues(req, sections, presetTokens), ...structureIssues(req, sections))
  issues.push(...positionIssues(req.characters, req.version))
  const tagCount = sections
    .filter((section2) => !section2.negative)
    .reduce((numericValue, section2) => numericValue + section2.tokens.length, 0)
  const ev = await gatherEvidence(sections, onStep, signal)
  issues.push(...ev.issues)
  return { sections, issues, tagCount, ev }
}

/** 不调用 AI 的完整本地检查报告（文本），供外部 agent 使用 */
export async function reviewPrompt(req: AiPreviewRequest, signal?: AbortSignal): Promise<string> {
  const review = await localReview(req, () => {}, signal)
  const head = `共 ${review.tagCount} 个正向元素，本地发现 ${review.issues.length} 个问题。tag 后方括号内依次为：分类|引用数|中文；×数字为实际权重。`
  return [head, ...reportBlocks(req, review.sections, review.issues, review.ev.block)]
    .filter(Boolean)
    .join('\n\n')
}

/* ---------- 结果规整 ---------- */

const CONF: Confidence[] = ['high', 'medium', 'low']
const BASES: Basis[] = ['rule', 'data', 'doc', 'taste']
const conf = (value: unknown, fallbackConfidence: Confidence = 'medium'): Confidence =>
  CONF.includes(value as Confidence) ? (value as Confidence) : fallbackConfidence
const basis = (value: unknown): Basis => (BASES.includes(value as Basis) ? (value as Basis) : 'doc')
const str = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value == null) {
    return '' as const
  }
  return String(value)
}
const strList = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : [])
const asRecord = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

function point(value: unknown): PreviewPoint {
  const record = typeof value === 'string' ? { text: value } : asRecord(value)
  return { text: str(record.text), tags: strList(record.tags), confidence: conf(record.confidence) }
}

function effects(value: unknown): PreviewEffect[] {
  return (Array.isArray(value) ? value : [])
    .map((candidate) => ({
      tag: str(asRecord(candidate).tag),
      effect: str(asRecord(candidate).effect),
    }))
    .filter((effect) => effect.tag || effect.effect)
}

function normalize(
  raw: Record<string, unknown>,
): Omit<AiPreviewResult, 'issues' | 'tagCount' | 'evidence'> {
  return {
    summary: str(raw.summary),
    confidence: conf(raw.confidence),
    style: point(raw.style),
    composition: point(raw.composition),
    scene: point(raw.scene),
    lighting: point(raw.lighting),
    characters: (Array.isArray(raw.characters) ? raw.characters : []).map((character, i) => {
      const record = asRecord(character)
      return {
        ...point(record),
        name: str(record.name) || `角色 ${i + 1}`,
        position: str(record.position) || undefined,
      }
    }),
    emphasis: effects(raw.emphasis),
    suppressed: effects(raw.suppressed),
    risks: (Array.isArray(raw.risks) ? raw.risks : [])
      .map((riskInput): PreviewRisk => {
        const record = asRecord(riskInput)
        return {
          level: conf(record.level, 'medium'),
          text: str(record.text),
          tags: strList(record.tags),
          basis: basis(record.basis),
          evidence: str(record.evidence),
        }
      })
      .filter((risk) => risk.text),
    gap: str(raw.gap),
    suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : [])
      .map((candidate): PreviewSuggestion => {
        const record = typeof candidate === 'string' ? { text: candidate } : asRecord(candidate)
        return {
          text: str(record.text),
          basis: basis(record.basis),
          evidence: str(record.evidence),
        }
      })
      .filter((suggestion) => suggestion.text),
  }
}

export async function previewPrompt(
  req: AiPreviewRequest,
  onStep: (text: string) => void,
  signal?: AbortSignal,
): Promise<AiPreviewResult> {
  onStep('本地解析提示词…')
  const { sections, issues, tagCount, ev } = await localReview(req, onStep, signal)
  onStep(`共 ${tagCount} 个正向元素，本地发现 ${issues.length} 个问题`)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(req.version) },
    { role: 'user', content: userPrompt(req, sections, issues, ev.block) },
  ]

  for (let i = 0; i <= MAX_RETRY; i++) {
    onStep(i ? 'AI 重新整理输出格式…' : 'AI 正在想象画面…')
    const msg = await chat(messages, { temperature: 0.5, signal })
    try {
      const result = normalize(extractJson<Record<string, unknown>>(msg.content ?? ''))
      if (!result.summary) {
        throw new Error('empty')
      }
      onStep('完成')
      return { ...result, issues, tagCount, evidence: ev.info }
    } catch {
      messages.push(
        { role: 'assistant', content: msg.content ?? '' },
        { role: 'user', content: '请只输出约定格式的 JSON 对象。' },
      )
    }
  }
  throw new Error('AI 未返回有效结果，请重试')
}
