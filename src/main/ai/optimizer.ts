import { readFileSync } from 'node:fs'
import type {
  AiChange,
  AiCharacter,
  AiOptimizeRequest,
  AiOptimizeResult,
  Basis,
  ChangeScope,
  EvidenceInfo,
  NaiVersion
} from '../../shared/types'
import { CATEGORY_LABEL } from '../../shared/types'
import { skillPath } from '../paths'
import { tagStore } from '../tagdb/store'
import { analyzePrompt } from '../prompt/analyzer'
import { chat, extractJson, type ChatMessage, type ToolDef } from './deepseek'
import { formatRelatedTool, formatWikiTool, gatherEvidence, relatedTags, tagWiki, type EvSection } from './evidence'

const MAX_TOOL_ROUNDS = 10
const MAX_FIX_ROUNDS = 2

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'search_tags',
      description:
        '在本地 Danbooru tag 库中搜索候选 tag。支持英文关键词或中文。一次可以查询多个概念，每个概念返回按热度排序的候选。',
      parameters: {
        type: 'object',
        properties: {
          queries: { type: 'array', items: { type: 'string' }, description: '要查询的概念列表，如 ["双马尾","red eyes","school uniform"]' },
          category: {
            type: 'string',
            enum: ['any', 'general', 'artist', 'copyright', 'character', 'meta'],
            description: '限定分类，默认 any'
          }
        },
        required: ['queries']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'validate_tags',
      description: '校验一组 tag 是否存在于 Danbooru，返回 存在/别名(会给出标准写法)/不存在(给出候选)。',
      parameters: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
        required: ['tags']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'related_tags',
      description:
        '查询 Danbooru 共现统计：在带有该 tag 的图中，哪些通用 tag 经常同时出现、出现率多少。用途：确认角色的默认外观（只写与默认不同的部分）、了解画师/作品会把画面带向哪里、判断一组 tag 是否常见搭配。需要联网，一次最多 6 个。',
      parameters: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' }, description: '标准 tag 名，如 ["hatsune miku","wlop"]（画师不带 artist: 前缀）' } },
        required: ['tags']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'tag_wiki',
      description:
        '查询 tag 在 Danbooru wiki 上的官方释义。用途：几个候选意思相近、拿不准哪个才符合用户描述时（如 jitome 与 empty eyes、cowboy shot 拍到哪里），先读释义再挑。需要联网，一次最多 8 个。',
      parameters: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
        required: ['tags']
      }
    }
  }
]

const CAT_MAP: Record<string, number[] | undefined> = {
  any: undefined,
  general: [0, 100],
  artist: [1],
  copyright: [3],
  character: [4],
  meta: [5, 100]
}

function fmtTag(t: { display: string; category: number; count: number; zh?: string }): string {
  return `${t.display} [${CATEGORY_LABEL[t.category as 0] ?? t.category}|${t.count}${t.zh ? '|' + t.zh : ''}]`
}

const cleanTag = (raw: string) =>
  raw
    .trim()
    .replace(/^artist:\s*/i, '')
    .replace(/^-?\d+(\.\d+)?::\s*|\s*::$/g, '')
    .replace(/[{}[\]]/g, '')
    .trim()

/** 工具调用中查过的统计数据，汇总到结果里展示 */
interface ToolLog {
  related: Set<string>
  wiki: Set<string>
  failed: Set<string>
}

async function runTool(name: string, argsJson: string, log: ToolLog, signal?: AbortSignal): Promise<string> {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return '参数不是合法 JSON'
  }
  const list = (k: string) => ((args[k] as string[]) ?? []).filter((x) => typeof x === 'string')
  if (name === 'search_tags') {
    const cats = CAT_MAP[(args.category as string) ?? 'any'] as never
    return list('queries')
      .slice(0, 20)
      .map((q) => {
        const hits = tagStore.search({ query: q, categories: cats, limit: 8 })
        return `## ${q}\n${hits.length ? hits.map((h) => '- ' + fmtTag(h) + (h.viaAlias ? ` (别名 ${h.viaAlias})` : '')).join('\n') : '- (无结果，换个说法或用英文再试)'}`
      })
      .join('\n')
  }
  if (name === 'validate_tags') {
    return list('tags')
      .slice(0, 80)
      .map((raw) => {
        const core = cleanTag(raw)
        const { tag, aliasOf } = tagStore.lookup(core)
        if (tag) return `✓ ${raw}`
        if (aliasOf) return `↪ ${raw} → 请改用 ${aliasOf.display}`
        const sug = tagStore.suggest(core, 4)
        return `✗ ${raw} 不存在${sug.length ? '，候选：' + sug.map((s) => s.display).join(' / ') : ''}`
      })
      .join('\n')
  }
  if (name === 'related_tags') {
    const r = await relatedTags(list('tags').slice(0, 6).map(cleanTag), signal)
    for (const [n, v] of r.results) if (v && !r.failed.includes(n)) log.related.add(v.display)
    r.failed.forEach((f) => log.failed.add(f.replace(/_/g, ' ')))
    return formatRelatedTool(r)
  }
  if (name === 'tag_wiki') {
    const r = await tagWiki(list('tags').slice(0, 8).map(cleanTag), signal)
    for (const [n, v] of r.results) if (v) log.wiki.add(n.replace(/_/g, ' '))
    r.failed.forEach((f) => log.failed.add(f.replace(/_/g, ' ')))
    return formatWikiTool(r)
  }
  return `未知工具 ${name}`
}

function loadSkill(): string {
  try {
    return readFileSync(skillPath(), 'utf8')
  } catch {
    return '你是 NovelAI 提示词专家。'
  }
}

function systemPrompt(version: NaiVersion): string {
  const v = version === 'v5' ? 'NAI Diffusion V5' : 'NAI Diffusion V4.5'
  const pos =
    version === 'v5'
      ? '最多 22 个角色；position 用简短中文描述画面位置（如“画面左侧，占 1/3”）'
      : '最多 6 个角色；position 只填 5×5 网格坐标 A1~E5（列 A~E 左→右，行 1~5 上→下，C3 为中心）'
  return `${loadSkill()}

---
# 当前任务环境
- 目标模型：**${v}**（只使用该版本适用的语法与 tag，文档中标注另一版本专用的内容不要使用）
- 工具：search_tags / validate_tags 查询本地 tag 库；related_tags / tag_wiki 联网查询 Danbooru 共现统计与释义（见 Skill 第 9 节，按需使用，不必每个 tag 都查）。除 NAI 专用质量词和自然语言片段外，**所有 tag 必须来自工具返回的结果**。
- 角色提示词：${pos}。
- 完成后只输出一个 JSON 对象（不要多余文字）：
{"positive":"主提示词","negative":"完整的负面提示词（不能为空）","characters":[{"prompt":"角色提示词","position":"位置","negative":"该角色的负面提示词，可空"}],"assessment":"整体评估，一两句话","changes":[{"scope":"positive","text":"twin tails → twintails","basis":"rule","evidence":"validate_tags：别名"}]}
- scope 取 positive / character / negative / optional；basis 取 rule / data / doc / taste（含义见 Skill 第 9 节）。**basis 为 taste 的内容只能放在 scope=optional，不能直接改进提示词。**
- 不需要多角色时 characters 为 []。`
}

const charLabel = (i: number, c: AiCharacter) => `角色 ${i + 1}${c.position?.trim() ? `（位置 ${c.position.trim()}）` : ''}`

function buildSections(req: AiOptimizeRequest): EvSection[] {
  const chars = (req.characters ?? []).filter((c) => c.prompt?.trim() || c.negative?.trim())
  const mk = (label: string, text: string, negative: boolean): EvSection => ({
    label,
    negative,
    tokens: text.trim() ? analyzePrompt(text, req.version).tokens : []
  })
  return [
    mk('主提示词', req.prompt ?? '', false),
    ...chars.flatMap((c, i) => [mk(`角色 ${i + 1}`, c.prompt ?? '', false), mk(`角色 ${i + 1} 负面`, c.negative ?? '', true)]),
    mk('负面', req.negative ?? '', true)
  ]
}

/** 本地预检（规则类）：无效 / 别名 tag、正负面重复、角色数 */
function precheck(req: AiOptimizeRequest, sections: EvSection[]): string[] {
  const lines: string[] = []
  for (const s of sections) {
    for (const t of s.tokens) {
      if (t.status === 'unknown') lines.push(`- [${s.label}]「${t.raw}」不存在`)
      else if (t.status === 'alias') lines.push(`- [${s.label}]「${t.raw}」是别名，标准写法 ${t.aliasOf!.display}`)
      else if (t.warning) lines.push(`- [${s.label}]「${t.raw}」：${t.warning}`)
    }
  }
  type Tok = EvSection['tokens'][number]
  const name = (t: Tok) => (t.tag ?? t.aliasOf)?.name
  const posNames = new Set(sections.filter((s) => !s.negative).flatMap((s) => s.tokens.map(name)).filter(Boolean))
  const negTokens = sections.find((s) => s.label === '负面')!.tokens
  const both = [...new Set(negTokens.map(name).filter((n) => n && posNames.has(n)))]
  if (both.length) lines.push(`- 正向（含角色）与负面同时出现：${both.join(', ')}（概念互相抵消）`)
  const chars = (req.characters ?? []).filter((c) => c.prompt?.trim())
  if (chars.length === 1) lines.push('- 只有 1 个角色提示词：按规范应合并进主提示词，characters 返回 []')
  const limit = req.version === 'v5' ? 22 : 6
  if (chars.length > limit) lines.push(`- 角色数 ${chars.length} 超过当前模型上限 ${limit}`)
  return lines
}

function charactersBlock(req: AiOptimizeRequest, title: string): string {
  const chars = (req.characters ?? []).filter((c) => c.prompt?.trim())
  if (!chars.length) return ''
  return `${title}\n${chars
    .map((c, i) => `${charLabel(i, c)}：${c.prompt.trim()}${c.negative?.trim() ? `\n  角色负面：${c.negative.trim()}` : ''}`)
    .join('\n')}`
}

function userPrompt(req: AiOptimizeRequest, rules: string[], dataIssues: string[], evidenceBlock: string): string {
  const neg = req.negative?.trim()
  const extra = req.instruction.trim()
  const checks = [
    rules.length && `## 本地规则检查（basis = rule）\n${rules.join('\n')}`,
    dataIssues.length && `## 本地数据检查（basis = data）\n${dataIssues.join('\n')}`,
    evidenceBlock
  ]
    .filter(Boolean)
    .join('\n\n')

  if (req.mode === 'semantic') {
    return [
      `请把下面的画面描述转换为一整套 NovelAI 提示词：主提示词、角色提示词（含位置和角色负面）、负面提示词。`,
      `拆分要求：`,
      `1. 先数清画面里**需要区分外貌**的人物有几个。只有 1 个时全部写进主提示词，characters 为 []；≥2 个时每人一个角色提示词。`,
      `2. 主提示词只写人数（如 2girls / 1girl, 1boy）、画风画师、构图镜头、背景场景、光影氛围、质量词等共享内容，**不要写任何属于某个角色的外貌服装**，否则会串色。`,
      `3. 角色提示词按「性别（girl/boy/other，不加数字）→ 角色名 → 外貌 → 服装 → 表情 → 动作」排列；按描述里的空间关系给出位置，没有交代时按出场顺序从左到右排布。`,
      `4. 描述里出现**具体角色**时，先用 related_tags 查该角色的默认外观：与默认一致的特征不必重复，与默认不同的特征要明确写出（必要时加权，并在负面排除默认特征）。`,
      `5. 意思相近、拿不准的候选 tag，用 tag_wiki 读释义后再挑；用户指定画师时，可用 related_tags 了解其倾向并在 changes 中提示。`,
      `6. 人物之间有互动时，用 source# / target# / mutual# 写在对应角色里，必要时再补一句简短英文强化。`,
      `7. 两个角色有容易混淆的特征（发色、瞳色、眼镜、兽耳、服装颜色等）时，在对方的角色负面里排除，防止串色；没有风险就留空。`,
      `8. 负面提示词按画面风格给出完整版本，并避开与正向冲突的 tag。`,
      `9. changes 逐条说明关键的取舍：拆出了几个角色、位置依据、选某个 tag 而不是近义词的原因、加了哪些防串色负面；用户没提到、属于审美偏好的补充（画师、额外风格）只能放 optional。`,
      `画面描述：\n${req.instruction}`,
      req.prompt.trim() && `可参考/保留的已有主提示词：\n${req.prompt}`,
      charactersBlock(req, '可参考/保留的已有角色提示词：'),
      neg && `用户已有的负面提示词（在此基础上按画面需要调整）：\n${neg}`,
      checks
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  const hasChars = (req.characters ?? []).some((c) => c.prompt?.trim())
  return [
    `请综合评估并优化下面这套 NovelAI 提示词（正向${hasChars ? ' + 角色' : ''} + 负面作为一个整体）：`,
    `1. 修正不存在/拼写错误的 tag，替换别名为标准写法，按包含关系去除冗余，按规范顺序重排，必要时补充缺失的关键 tag；`,
    `2. 检查正负面之间的冲突：同一概念同时出现在正负面、负面误伤了想要的风格（例如漫画/网点风格却在负面里放了 screentone、halftone、multiple views）、负面缺少必要的质量词等；`,
    neg ? `3. 负面提示词同样要校验 tag 是否存在，并按画面风格增删；` : `3. 用户未提供负面提示词，请按规范给出合适的负面提示词；`,
    hasChars
      ? `4. 角色提示词：检查主提示词与角色之间的分工（角色特征不要留在主提示词里）、人数 tag 与角色数是否一致、位置是否合理、互动语法、角色负面是否足以防串色；保留每个角色原有的身份和顺序。`
      : `4. 如果正向里其实描述了多个需要区分外貌的人物，按 Skill 第 5 节拆成角色提示词。`,
    `5. 下方的统计数据是客观依据：角色写了与默认外观不同的特征时，判断是否刻意（刻意则加权并在负面排除默认特征，否则提醒）；画师倾向与用户想要的风格冲突时在 changes 中说明。`,
    `6. assessment 用一两句话给出整体评估；changes 逐条列出修改，每条都写明 basis 与 evidence。审美层面的建议（换画师、加风格）只放 optional，不要直接改。`,
    `原正向提示词：\n${req.prompt}`,
    charactersBlock(req, '原角色提示词：'),
    neg && `原负面提示词：\n${neg}`,
    extra && `额外要求：\n${extra}`,
    checks
  ]
    .filter(Boolean)
    .join('\n\n')
}

function collectInvalid(result: AiOptimizeResult, version: NaiVersion): string[] {
  const texts = [result.positive, result.negative, ...result.characters.flatMap((c) => [c.prompt, c.negative ?? ''])]
  const bad = new Set<string>()
  for (const text of texts) {
    for (const t of analyzePrompt(text ?? '', version).tokens) {
      if (t.status === 'unknown' || t.status === 'alias') bad.add(t.raw)
    }
  }
  return [...bad]
}

/** 结构检查：单角色、超出上限、V4.5 位置格式，以及「审美类修改被直接改进了提示词」 */
function structureIssues(result: AiOptimizeResult, version: NaiVersion): string[] {
  const chars = result.characters.filter((c) => c.prompt.trim())
  const out: string[] = []
  if (chars.length === 1) out.push('只有 1 个角色时不要使用角色提示词，请把它合并进主提示词，characters 返回 []')
  const limit = version === 'v5' ? 22 : 6
  if (chars.length > limit) out.push(`角色数 ${chars.length} 超过当前模型上限 ${limit}`)
  if (version === 'v4.5' && chars.length > 1) {
    chars.forEach((c, i) => {
      if (c.position && !/^[A-E][1-5]$/i.test(c.position.trim()))
        out.push(`角色 ${i + 1} 的 position「${c.position}」不是 V4.5 网格坐标，请改成 A1~E5 之一`)
    })
  }
  const taste = result.changes.filter((c) => c.basis === 'taste' && c.scope !== 'optional')
  if (taste.length)
    out.push(
      `以下修改的依据是审美偏好，不应直接改动用户的提示词：${taste.map((c) => `「${c.text}」`).join('、')}。请把对应改动从提示词中撤回，改为 scope=optional 的建议`
    )
  return out
}

const BASES: Basis[] = ['rule', 'data', 'doc', 'taste']
const SCOPES: ChangeScope[] = ['positive', 'character', 'negative', 'optional']

function normalizeChanges(raw: unknown): AiChange[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((c) => {
      const o = (c && typeof c === 'object' ? c : { text: c }) as Record<string, unknown>
      return {
        scope: SCOPES.includes(o.scope as ChangeScope) ? (o.scope as ChangeScope) : 'positive',
        text: String(o.text ?? '').trim(),
        basis: BASES.includes(o.basis as Basis) ? (o.basis as Basis) : 'doc',
        evidence: String(o.evidence ?? '').trim()
      }
    })
    .filter((c) => c.text)
}

function normalizeResult(raw: Record<string, unknown>, evidence: EvidenceInfo): AiOptimizeResult {
  const chars = Array.isArray(raw.characters) ? (raw.characters as Partial<AiCharacter>[]) : []
  return {
    positive: String(raw.positive ?? ''),
    negative: String(raw.negative ?? ''),
    characters: chars
      .map((c) => ({
        prompt: String(c?.prompt ?? '').trim(),
        position: c?.position ? String(c.position).trim() : undefined,
        negative: c?.negative ? String(c.negative).trim() : undefined
      }))
      .filter((c) => c.prompt),
    notes: String(raw.assessment ?? raw.notes ?? '').trim(),
    changes: normalizeChanges(raw.changes),
    invalid: [],
    evidence
  }
}

export async function optimizePrompt(
  req: AiOptimizeRequest,
  onStep: (s: string) => void,
  signal?: AbortSignal
): Promise<AiOptimizeResult> {
  const sections = buildSections(req)
  const rules = precheck(req, sections)
  const ev = await gatherEvidence(sections, onStep, signal)
  const dataIssues = ev.issues.map((i) => `- [${i.where}] ${i.text}`)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(req.version) },
    { role: 'user', content: userPrompt(req, rules, dataIssues, ev.block) }
  ]
  const log: ToolLog = { related: new Set(ev.info.related), wiki: new Set(), failed: new Set(ev.info.failed) }
  const evidence = (): EvidenceInfo => ({
    related: [...log.related],
    wiki: [...log.wiki],
    failed: [...log.failed].filter((f) => !log.related.has(f) && !log.wiki.has(f)),
    implications: ev.info.implications
  })

  let result: AiOptimizeResult | null = null
  let fixRound = 0
  let forced = false

  for (let round = 0; round < MAX_TOOL_ROUNDS + MAX_FIX_ROUNDS + 2; round++) {
    if (round >= MAX_TOOL_ROUNDS && !forced) {
      forced = true
      messages.push({ role: 'user', content: '检索已足够，请不要再调用工具，直接输出最终 JSON。' })
    }
    onStep(forced ? 'AI 正在整理最终结果…' : 'AI 思考中…')
    // 始终携带 tools：DeepSeek 思考模式下带 tools 的多轮对话需要完整回传 reasoning_content
    const msg = await chat(messages, { tools: TOOLS, temperature: 0.6, signal })
    messages.push(msg)

    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        let preview = ''
        try {
          const a = JSON.parse(call.function.arguments || '{}')
          preview = (a.queries ?? a.tags ?? []).slice(0, 6).join(', ')
        } catch {
          /* ignore */
        }
        const label =
          { search_tags: '查询 tag', validate_tags: '校验 tag', related_tags: '查共现统计', tag_wiki: '查 wiki 释义' }[call.function.name] ??
          call.function.name
        onStep(`${label}：${preview}`)
        messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(call.function.name, call.function.arguments, log, signal) })
      }
      continue
    }

    try {
      result = normalizeResult(extractJson<Record<string, unknown>>(msg.content ?? ''), evidence())
    } catch {
      messages.push({ role: 'user', content: '请只输出约定格式的 JSON 对象。' })
      continue
    }

    const invalid = collectInvalid(result, req.version)
    const structure = structureIssues(result, req.version)
    result.invalid = invalid
    if ((!invalid.length && !structure.length) || fixRound >= MAX_FIX_ROUNDS) break
    fixRound++
    const found = [invalid.length && `${invalid.length} 个无效 tag`, structure.length && `${structure.length} 处结构问题`].filter(Boolean)
    onStep(`本地校验发现 ${found.join('、')}，要求 AI 修正（第 ${fixRound} 轮）`)
    const validated = invalid.length ? await runTool('validate_tags', JSON.stringify({ tags: invalid }), log, signal) : ''
    messages.push({
      role: 'user',
      content: [
        validated && `以下 tag 在 Danbooru 中不存在或不是标准写法：\n${validated}`,
        structure.length && `结构问题：\n${structure.map((s) => '- ' + s).join('\n')}`,
        '请修正后重新输出完整 JSON。'
      ]
        .filter(Boolean)
        .join('\n\n')
    })
  }

  if (!result) throw new Error('AI 未返回有效结果')
  result.evidence = evidence()
  onStep('完成')
  return result
}
