import { readFileSync } from 'node:fs'
import type { AiOptimizeRequest, AiOptimizeResult, NaiVersion } from '../../shared/types'
import { CATEGORY_LABEL } from '../../shared/types'
import { skillPath } from '../paths'
import { tagStore } from '../tagdb/store'
import { analyzePrompt } from '../prompt/analyzer'
import { chat, extractJson, type ChatMessage, type ToolDef } from './deepseek'

const MAX_TOOL_ROUNDS = 8
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

function runTool(name: string, argsJson: string): string {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return '参数不是合法 JSON'
  }
  if (name === 'search_tags') {
    const queries = (args.queries as string[]) ?? []
    const cats = CAT_MAP[(args.category as string) ?? 'any'] as never
    return queries
      .slice(0, 20)
      .map((q) => {
        const hits = tagStore.search({ query: q, categories: cats, limit: 8 })
        return `## ${q}\n${hits.length ? hits.map((h) => '- ' + fmtTag(h) + (h.viaAlias ? ` (别名 ${h.viaAlias})` : '')).join('\n') : '- (无结果，换个说法或用英文再试)'}`
      })
      .join('\n')
  }
  if (name === 'validate_tags') {
    const tags = (args.tags as string[]) ?? []
    return tags
      .slice(0, 80)
      .map((raw) => {
        const core = raw.replace(/^artist:\s*/i, '').replace(/^\d+(\.\d+)?::|::$/g, '').replace(/[{}[\]]/g, '').trim()
        const { tag, aliasOf } = tagStore.lookup(core)
        if (tag) return `✓ ${raw}`
        if (aliasOf) return `↪ ${raw} → 请改用 ${aliasOf.display}`
        const sug = tagStore.suggest(core, 4)
        return `✗ ${raw} 不存在${sug.length ? '，候选：' + sug.map((s) => s.display).join(' / ') : ''}`
      })
      .join('\n')
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
  return `${loadSkill()}

---
# 当前任务环境
- 目标模型：**${v}**（只使用该版本适用的语法与 tag，文档中标注另一版本专用的内容不要使用）
- 你可以调用工具 search_tags / validate_tags 查询本地 Danbooru tag 库。除 NAI 专用质量词和自然语言片段外，**所有 tag 必须来自工具返回的结果**。
- 完成后只输出一个 JSON 对象（不要多余文字）：
{"positive":"主提示词","negative":"负面提示词","characters":[{"prompt":"角色提示词","position":"位置描述，可空"}],"notes":"中文说明：做了哪些修改、为什么"}
- 不需要多角色时 characters 为 []。`
}

/** 本地预检：列出无效/别名 tag，以及正负面同时出现的 tag，作为 AI 综合评估的依据 */
function precheck(req: AiOptimizeRequest): string {
  const pos = analyzePrompt(req.prompt ?? '', req.version).tokens
  const neg = analyzePrompt(req.negative ?? '', req.version).tokens
  const lines: string[] = []
  const issues = (tokens: typeof pos, label: string) => {
    for (const t of tokens) {
      if (t.status === 'unknown') lines.push(`- ${label}「${t.raw}」不存在`)
      else if (t.status === 'alias') lines.push(`- ${label}「${t.raw}」是别名，标准写法 ${t.aliasOf!.display}`)
      else if (t.warning) lines.push(`- ${label}「${t.raw}」：${t.warning}`)
    }
  }
  issues(pos, '正向')
  issues(neg, '负面')
  const name = (t: (typeof pos)[number]) => (t.tag ?? t.aliasOf)?.name
  const posNames = new Set(pos.map(name).filter(Boolean))
  const both = [...new Set(neg.map(name).filter((n) => n && posNames.has(n)))]
  if (both.length) lines.push(`- 正向与负面同时出现：${both.join(', ')}（概念互相抵消）`)
  return lines.length ? `\n\n本地预检结果（供参考）：\n${lines.join('\n')}` : ''
}

function userPrompt(req: AiOptimizeRequest): string {
  const neg = req.negative?.trim()
  const extra = req.instruction.trim()
  if (req.mode === 'semantic') {
    return [
      `请把下面的画面描述转换为 NovelAI 提示词（含负面提示词）。`,
      `画面描述：\n${req.instruction}`,
      req.prompt.trim() && `可参考/保留的已有提示词：\n${req.prompt}`,
      neg && `用户已有的负面提示词（在此基础上按画面需要调整）：\n${neg}`
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  return [
    `请综合评估并优化下面这套 NovelAI 提示词（正向 + 负面作为一个整体）：`,
    `1. 修正不存在/拼写错误的 tag，替换别名为标准写法，去除冗余，按规范顺序重排，必要时补充缺失的关键 tag；`,
    `2. 检查正负面之间的冲突：同一概念同时出现在正负面、负面误伤了想要的风格（例如漫画/网点风格却在负面里放了 screentone、halftone、multiple views）、负面缺少必要的质量词等；`,
    neg ? `3. 负面提示词同样要校验 tag 是否存在，并按画面风格增删；` : `3. 用户未提供负面提示词，请按规范给出合适的负面提示词；`,
    `4. notes 先用一两句话给出整体评估（这套提示词的风格、主要问题），再分条列出正向和负面各做了哪些修改及原因。`,
    `原正向提示词：\n${req.prompt}`,
    neg && `原负面提示词：\n${neg}`,
    extra && `额外要求：\n${extra}`
  ]
    .filter(Boolean)
    .join('\n\n') + precheck(req)
}

function collectInvalid(result: AiOptimizeResult, version: NaiVersion): string[] {
  const texts = [result.positive, result.negative, ...result.characters.map((c) => c.prompt)]
  const bad = new Set<string>()
  for (const text of texts) {
    for (const t of analyzePrompt(text ?? '', version).tokens) {
      if (t.status === 'unknown' || t.status === 'alias') bad.add(t.raw)
    }
  }
  return [...bad]
}

function normalizeResult(raw: Partial<AiOptimizeResult>): AiOptimizeResult {
  return {
    positive: String(raw.positive ?? ''),
    negative: String(raw.negative ?? ''),
    characters: Array.isArray(raw.characters)
      ? raw.characters.map((c) => ({ prompt: String(c?.prompt ?? ''), position: c?.position ? String(c.position) : undefined }))
      : [],
    notes: String(raw.notes ?? ''),
    invalid: []
  }
}

export async function optimizePrompt(
  req: AiOptimizeRequest,
  onStep: (s: string) => void,
  signal?: AbortSignal
): Promise<AiOptimizeResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(req.version) },
    { role: 'user', content: userPrompt(req) }
  ]

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
        onStep(`${call.function.name === 'search_tags' ? '查询 tag' : '校验 tag'}：${preview}`)
        messages.push({ role: 'tool', tool_call_id: call.id, content: runTool(call.function.name, call.function.arguments) })
      }
      continue
    }

    try {
      result = normalizeResult(extractJson<Partial<AiOptimizeResult>>(msg.content ?? ''))
    } catch {
      messages.push({ role: 'user', content: '请只输出约定格式的 JSON 对象。' })
      continue
    }

    const invalid = collectInvalid(result, req.version)
    result.invalid = invalid
    if (!invalid.length || fixRound >= MAX_FIX_ROUNDS) break
    fixRound++
    onStep(`本地校验发现 ${invalid.length} 个无效 tag，要求 AI 修正（第 ${fixRound} 轮）`)
    messages.push({
      role: 'user',
      content: `以下 tag 在 Danbooru 中不存在或不是标准写法，请修正后重新输出完整 JSON：\n${runTool('validate_tags', JSON.stringify({ tags: invalid }))}`
    })
  }

  if (!result) throw new Error('AI 未返回有效结果')
  onStep('完成')
  return result
}
