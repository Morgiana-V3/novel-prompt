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
import { MAX_CHARACTERS, isGridPosition, parsePosition, textBlockOf } from '../../shared/nai-presets'
import { BUILTIN_PROMPT, composeSkills, isActive } from '../skills'
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
    .replace(/^(source|target|mutual)#\s*/i, '')
    .replace(/^-?\d+(\.\d+)?::\s*|\s*::$/g, '')
    .replace(/[{}[\]]/g, '')
    .trim()

/** 批量输入超过单次上限时截断，并在结果里写明未处理的项 */
function capped(items: string[], max: number): { items: string[]; note: string } {
  if (items.length <= max) return { items, note: '' }
  const rest = items.slice(max)
  return {
    items: items.slice(0, max),
    note: `\n\n（⚠ 共传入 ${items.length} 项，超过单次上限 ${max}，只处理了前 ${max} 项；未处理：${rest.join(', ')}。请分批再查）`
  }
}

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
  const list = (k: string) => (Array.isArray(args[k]) ? (args[k] as unknown[]) : []).filter((x): x is string => typeof x === 'string')
  const input = list(name === 'search_tags' ? 'queries' : 'tags')
  if (!input.length) return `（没有传入要查询的内容：${name === 'search_tags' ? 'queries' : 'tags'} 为空）`
  if (name === 'search_tags') {
    const cats = CAT_MAP[(args.category as string) ?? 'any'] as never
    const { items, note } = capped(input, 20)
    return (
      items
        .map((q) => {
          const hits = q.trim() ? tagStore.search({ query: q, categories: cats, limit: 8 }) : []
          return `## ${q}\n${hits.length ? hits.map((h) => '- ' + fmtTag(h) + (h.viaAlias ? ` (别名 ${h.viaAlias})` : '')).join('\n') : '- (无结果，换个说法或用英文再试)'}`
        })
        .join('\n') + note
    )
  }
  if (name === 'validate_tags') {
    const { items, note } = capped(input, 80)
    return (
      items
        .map((raw) => {
          const core = cleanTag(raw)
          const { tag, aliasOf } = tagStore.lookup(core)
          if (tag) return `✓ ${raw}`
          if (aliasOf) return `↪ ${raw} → 请改用 ${aliasOf.display}`
          const sug = tagStore.suggest(core, 4)
          return `✗ ${raw} 不存在${sug.length ? '，候选：' + sug.map((s) => s.display).join(' / ') : ''}`
        })
        .join('\n') + note
    )
  }
  if (name === 'related_tags') {
    const { items, note } = capped(input, 6)
    const r = await relatedTags(items.map(cleanTag), signal)
    for (const [n, v] of r.results) if (v && !r.failed.includes(n)) log.related.add(v.display)
    r.failed.forEach((f) => log.failed.add(f.replace(/_/g, ' ')))
    return formatRelatedTool(r) + note
  }
  if (name === 'tag_wiki') {
    const { items, note } = capped(input, 8)
    const r = await tagWiki(items.map(cleanTag), signal)
    for (const [n, v] of r.results) if (v) log.wiki.add(n.replace(/_/g, ' '))
    r.failed.forEach((f) => log.failed.add(f.replace(/_/g, ' ')))
    return formatWikiTool(r) + note
  }
  return `未知工具 ${name}`
}

/** 对外（MCP）复用本地 tag 工具：search_tags / validate_tags / related_tags / tag_wiki */
export function tagTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  return runTool(name, JSON.stringify(args), { related: new Set(), wiki: new Set(), failed: new Set() }, signal)
}

export const TAG_TOOL_DEFS = TOOLS

/** 《内置 · 提示词编排》在当前模型下是否启用：决定任务指令是否带上内置方法论，以及结构类校验是否强制 */
const builtinOn = (version: NaiVersion) => isActive(BUILTIN_PROMPT, 'optimize', version)
const B = '《内置 · 提示词编排》'

function systemPrompt(version: NaiVersion): string {
  const v = version === 'v5' ? 'NAI Diffusion V5' : 'NAI Diffusion V4.5'
  const pos =
    version === 'v5'
      ? '最多 22 条；position 只填归一化坐标「x,y」（0~1，原点左上，如 0.3,0.5）或 5×5 网格 A1~E5，不要写自然语言（程序解析不了，生图时会被忽略）'
      : '最多 6 条；position 只填 5×5 网格坐标 A1~E5（列 A~E 左→右，行 1~5 上→下，C3 为中心）'
  return `${composeSkills('optimize', version).text}

---
# 程序约定（优先于所有 Skill）
- 目标模型：**${v}**（只使用该版本适用的语法与 tag，Skill 中标注另一版本专用的内容不要使用）
- 工具：search_tags / validate_tags 查询本地 tag 库；related_tags / tag_wiki 联网查询 Danbooru 共现统计与释义（按需使用，不必每个 tag 都查）。除 NAI 专用质量词和自然语言片段外，**所有 tag 必须来自工具返回的结果**。
- 本软件按以下写法解析提示词：
  - tag 之间用英文逗号分隔；英文自然语言短句的句内不用逗号，以句号结尾（句内逗号会把句子拆碎）。
  - 权重写法：\`{tag}\` / \`[tag]\` / \`1.2::tag::\`。
  - 画面文字写成 \`Text: 文字\`，放在所在提示词（主提示词或某条角色提示词）的**最末尾**，之后不能再接任何内容。
  - 互动前缀 \`source#动作\` / \`target#动作\` / \`mutual#动作\` 只能写在角色提示词里。
- 角色提示词（characters）：${pos}。它是带位置的区域提示词，内容会集中在 position 附近。
- 完成后只输出一个 JSON 对象（不要多余文字）：
{"positive":"主提示词","negative":"完整的负面提示词（不能为空）","characters":[{"prompt":"角色提示词","position":"位置","negative":"该角色的负面提示词，可空"}],"assessment":"整体评估，一两句话","changes":[{"scope":"positive","text":"twin tails → twintails","basis":"rule","evidence":"validate_tags：别名"}]}
- scope 取 positive / character / negative / optional。basis 取值：rule = 可被程序校验的硬规则（tag 不存在、别名、语法、版本、位置写法）；data = 统计数据或工具结果；doc = 依据启用的 Skill 或官方文档（evidence 写出 Skill 名称）；taste = 你自己的审美判断。**basis 为 taste 的内容只能放在 scope=optional，不能直接改进提示词**；按 Skill 要求做的修改属于 doc，不是 taste。
- 删除或改写了用户原有的内容时，changes 的 text 里要写出原文；Text: 块里的文字必须逐字符保留。
- 不需要角色提示词时 characters 为 []。`
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
  const name = (t: Tok) => (t.weight > 0 ? (t.tag ?? t.aliasOf)?.name : undefined)
  const posNames = new Set(sections.filter((s) => !s.negative).flatMap((s) => s.tokens.map(name)).filter(Boolean))
  const negTokens = sections.find((s) => s.label === '负面')!.tokens
  const both = [...new Set(negTokens.map(name).filter((n) => n && posNames.has(n)))]
  if (both.length) lines.push(`- 正向（含角色）与负面同时出现：${both.join(', ')}（概念互相抵消）`)
  const chars = (req.characters ?? []).filter((c) => c.prompt?.trim())
  const limit = MAX_CHARACTERS[req.version]
  if (chars.length > limit) lines.push(`- 角色数 ${chars.length} 超过当前模型上限 ${limit}`)
  lines.push(...positionProblems(chars, req.version).map((s) => `- ${s}`))
  return lines
}

/** 位置写法检查：程序只能解析网格和坐标，V4.5 只用网格 */
function positionProblems(chars: AiCharacter[], version: NaiVersion): string[] {
  const out: string[] = []
  chars.forEach((c, i) => {
    const p = c.position?.trim()
    if (!p) return
    if (version === 'v4.5' && !isGridPosition(p)) out.push(`角色 ${i + 1} 的 position「${p}」不是 V4.5 网格坐标，请改成 A1~E5 之一`)
    else if (!parsePosition(p)) out.push(`角色 ${i + 1} 的 position「${p}」无法解析（生图时会被忽略），请改成「x,y」坐标（如 0.3,0.5）或 A1~E5 网格`)
  })
  return out
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

  const refs = [
    req.prompt.trim() && `可参考/保留的已有主提示词：\n${req.prompt}`,
    charactersBlock(req, '可参考/保留的已有角色提示词：'),
    neg && `用户已有的负面提示词（在此基础上按画面需要调整）：\n${neg}`
  ]
  const builtin = builtinOn(req.version)
  /** 任务指令里的内置方法论也要服从 Skill 优先级 */
  const yieldNote = `以上步骤来自${B}。如果启用的、优先级更高的 Skill 对同一事项有不同要求，按 Skill 使用总则的优先级处理，并在 evidence 中写明。`

  if (req.mode === 'semantic' && !builtin) {
    return [
      `请把下面的画面描述转换为一整套 NovelAI 提示词：主提示词、角色提示词（按需，含位置和角色负面）、负面提示词。`,
      `1. 按已启用的 Skill 的方法完成；Skill 没有涉及的方面，按你对 NovelAI 与 Danbooru 的通用知识处理。`,
      `2. 描述里的每个具体要求（人物、数量、左右、持物、互动、画面文字原文）都要落进实际的提示词；画面文字逐字符照抄，写成 Text: 块。`,
      `3. 用 search_tags 检索 tag，输出前用 validate_tags 校验。`,
      `4. changes 逐条说明关键的取舍和依据（引用 Skill 名称）；用户没提到、属于你自己审美判断的补充只能放 optional。`,
      `画面描述：\n${req.instruction}`,
      ...refs,
      checks
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  if (req.mode === 'semantic') {
    const v5 = req.version === 'v5'
    return [
      `请把下面的画面描述转换为一整套 NovelAI 提示词：主提示词、角色提示词（含位置和角色负面）、负面提示词。`,
      `拆分要求：`,
      `1. **先列单元表**（${B}第 5.1 节）：把画面拆成需要独立描述的区域单元——每个人物；同一人物在不同格子 / 不同位置的每一次出现；漫画每一格里的每个人物；需要定位的关键非人物主体。记下每个单元在哪、外貌、做什么、和谁互动、说什么。单元表不用输出，但 characters 必须按它逐条写。`,
      `2. 单元数 ≥2 时，每个单元一条角色提示词（上限 ${MAX_CHARACTERS[req.version]} 条，超出时优先保留有互动、有对白的单元）。**不要因为只有两个不同的人物就只写两条**：漫画里同一人物出现在 4 个格子，就写 4 条，外貌服装照抄、动作表情按该格写。只有 1 个人物、单一画面、没有位置要求时，才全部写进主提示词，characters 为 []。`,
      `3. 主提示词只写共享内容：人数 tag（按不同人物计，如 2girls / 1girl, 1boy）、画风画师、版式（comic / 4koma / multiple views 等）、整体构图、全画面共享的背景与光影、质量词。**属于某个人物、某个格子的外貌、服装、表情、动作、局部场景、对白都不要写进主提示词**，也不要在主提示词里用长句逐格描述漫画内容。`,
      `4. 角色提示词按「性别（girl/boy/other，不加数字）→ 角色名 → 外貌 → 服装 → 表情 → 动作 / 互动前缀 → 该单元特有的场景道具 → Text: 对白」排列。position 按描述里的空间关系或分格位置给出（写法见程序约定；分格参考坐标见${B}第 5.4 节）；同一格里的两个单元左右错开；没有交代时按出场顺序从上到下、从左到右排布，characters 的顺序与位置一致。`,
      `5. **人物之间的任何有方向的动作或关系**（拥抱、亲吻、牵手、摸头、对视、递东西、推、拉、背、抱起……）**必须**先用 search_tags 找到对应的动作 tag，再写成互动前缀：主动方 source#动作、被动方 target#动作、对等双方都写 mutual#动作，分别写在两条角色提示词里。不要只在主提示词里用一句英文描述互动；确实没有对应 tag 时，才在主动方的角色提示词里补一句英文短句。`,
      `6. 画面文字逐字符照抄：某个人物说的话、某一格里的文字，写在**该人物 / 该格角色提示词的末尾** Text: 块，并加 speech bubble 等 tag；只有全画面共用的标题、招牌才写在主提示词末尾。不要把所有对白都合并到主提示词的一个 Text: 块里。`,
      `7. 描述里出现**具体角色**时，先用 related_tags 查该角色的默认外观：与默认一致的特征不必重复，与默认不同的特征要明确写出（必要时加权，并在负面排除默认特征）。意思相近、拿不准的候选 tag，用 tag_wiki 读释义后再挑。`,
      `8. 不同人物有容易混淆的特征（发色、瞳色、眼镜、兽耳、服装颜色等）时，在对方的角色负面里排除，防止串色；同一人物的多次出现之间不用互相排除。`,
      `9. 提示词以 tag 为主：外貌、服装、表情、动作、构图、背景、光影都用 tag 表达，不要改写成句子。tag 和互动前缀都表达不了的要求（左右手、持物对象、年龄身份）才补英文短句（句内不用逗号，以句号结尾），写在所属的那条提示词里，每条${v5 ? '一般不超过 2~3 句' : '一般不超过 1~2 句'}；年龄要求不要用 mature female 这类会改变外貌的 tag 代替。`,
      `10. 负面提示词按画面风格给出完整版本，并避开与正向冲突的 tag（漫画、黑白风格要去掉 multiple views、screentone、halftone、comic 等）。`,
      `11. changes 逐条说明关键的取舍：拆出了哪些单元、各自位置依据、用了哪些互动前缀、对白放在哪条、选某个 tag 而不是近义词的原因、加了哪些防串色负面；用户没提到、属于审美偏好的补充（画师、额外风格）只能放 optional。`,
      yieldNote,
      `画面描述：\n${req.instruction}`,
      ...refs,
      checks
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  const hasChars = (req.characters ?? []).some((c) => c.prompt?.trim())
  const keep = `0. 先列出用户明确写出的内容（角色、画师、服装、持物与动作对象、数量与左右等限定、画面文字、负面里刻意排除的元素），它们必须保留在结果里；确需删除或改写的，在 changes 里写明原文和理由。Text: 块里的文字必须逐字符保留（包括空格和标点），可以把某个人物的对白移到该人物的角色提示词末尾，但文字本身不能改；`
  const original = [
    `原正向提示词：\n${req.prompt}`,
    charactersBlock(req, '原角色提示词：'),
    neg && `原负面提示词：\n${neg}`,
    extra && `额外要求：\n${extra}`,
    checks
  ]
  if (!builtin) {
    return [
      `请按已启用的 Skill 评估并优化下面这套 NovelAI 提示词（正向${hasChars ? ' + 角色' : ''} + 负面作为一个整体）：`,
      keep,
      `1. 修正不存在 / 拼写错误的 tag，把别名换成标准写法（见下方本地检查）；`,
      `2. 其余按启用的 Skill 处理；Skill 没有涉及的方面尽量保持原样，不要凭自己的偏好大改；`,
      `3. assessment 用一两句话给出整体评估；changes 逐条列出修改，每条都写明 basis 与 evidence（引用 Skill 名称）。你自己的审美建议只放 optional。`,
      ...original
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  return [
    `请综合评估并优化下面这套 NovelAI 提示词（正向${hasChars ? ' + 角色' : ''} + 负面作为一个整体）：`,
    keep,
    `1. 修正不存在/拼写错误的 tag，替换别名为标准写法，去除同一段正向里的包含冗余，顺序混乱时按规范整理，必要时补充缺失的关键 tag；`,
    `2. 检查正负面之间的冲突：同一概念同时出现在正负面、负面误伤了想要的风格（例如漫画/网点风格却在负面里放了 screentone、halftone、multiple views）、负面缺少必要的质量词等；`,
    neg ? `3. 负面提示词同样要校验 tag 是否存在，并按画面风格增删；` : `3. 用户未提供负面提示词，请按规范给出合适的负面提示词；`,
    hasChars
      ? `4. 角色提示词：检查主提示词与角色之间的分工（属于某个人物 / 格子的外貌、动作、对白不要留在主提示词里）、人数 tag 是否与不同人物数一致、位置是否合理、角色负面是否足以防串色；人物之间有方向的动作必须用 source# / target# / mutual# 成对写在双方的角色提示词里（主提示词里描述互动的句子改成互动前缀）；保留每个角色原有的身份和顺序。`
      : `4. 如果正向里其实描述了多个人物、漫画的多个格子、同一人物的多次出现，或人物之间的互动，按${B}第 5 节拆成角色提示词（每个单元一条，互动用 source# / target# / mutual# 配对，对白移到说话者那条末尾的 Text: 块）。`,
    `5. 下方的统计数据是客观依据：角色写了与默认外观不同的特征时，判断是否刻意（刻意则加权并在负面排除默认特征，否则提醒）；画师倾向与用户想要的风格冲突时在 changes 中说明。`,
    `6. assessment 用一两句话给出整体评估；changes 逐条列出修改，每条都写明 basis 与 evidence。审美层面的建议（换画师、加风格）只放 optional，不要直接改。`,
    yieldNote,
    ...original
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

const LAYOUT_TAGS = new Set(['comic', '4koma', 'multiple_views', 'split_screen', 'multiple_panels', 'manga'])
const tagName = (t: Tok) => (t.tag ?? t.aliasOf)?.name

/** 角色提示词的用法：互动前缀的位置与配对、漫画分格、对白归属 */
function regionIssues(req: AiOptimizeRequest, result: AiOptimizeResult): string[] {
  const v = req.version
  const out: string[] = []
  const chars = result.characters.filter((c) => c.prompt.trim())
  const main = analyzePrompt(result.positive, v).tokens
  const charTokens = chars.map((c) => analyzePrompt(c.prompt, v).tokens)

  const misplaced = main.filter((t) => t.kind === 'action').map((t) => `${t.prefix}${t.core}`)
  if (misplaced.length)
    out.push(`主提示词里出现了互动前缀 ${misplaced.join(', ')}：source# / target# / mutual# 只能写在角色提示词里，请移到主动方 / 被动方各自的角色提示词`)

  // 以下是内置编排规范的做法；用户关闭了内置 Skill 时不强制
  if (!builtinOn(v)) return out

  const roles = new Map<string, Record<'source#' | 'target#' | 'mutual#', number[]>>()
  charTokens.forEach((toks, i) => {
    for (const t of toks) {
      if (t.kind !== 'action' || !t.prefix) continue
      const key = norm(t.core)
      const r = roles.get(key) ?? { 'source#': [], 'target#': [], 'mutual#': [] }
      r[t.prefix as 'source#']?.push(i + 1)
      roles.set(key, r)
    }
  })
  for (const [act, r] of roles) {
    if (r['source#'].length && !r['target#'].length)
      out.push(`角色 ${r['source#'].join('、')} 写了 source#${act}，但没有角色写 target#${act}：请在被动方的角色提示词里补上（对等互动改用 mutual# 双方都写）`)
    if (r['target#'].length && !r['source#'].length)
      out.push(`角色 ${r['target#'].join('、')} 写了 target#${act}，但没有角色写 source#${act}：请在主动方的角色提示词里补上`)
    if (r['mutual#'].length === 1) out.push(`mutual#${act} 只写在角色 ${r['mutual#'][0]} 里，对等互动需要双方都写`)
  }

  // 下面是「该用角色提示词却没用」的提示，只在描述转提示词时要求修正；优化模式尊重用户原有结构
  if (req.mode !== 'semantic') return out
  const layout = main.some((t) => LAYOUT_TAGS.has(tagName(t) ?? ''))
  if (layout && chars.length < 2)
    out.push(`主提示词是漫画 / 分格版式，但角色提示词不足 2 条：请按${B}第 5.1 节把每一格里的每个人物各写一条角色提示词（同一人物多次出现也各写一条），position 放在对应格子里，每格的动作和对白写进该条`)
  const mainText = textBlockOf(result.positive)
  if (chars.length >= 2 && mainText && textSegments(mainText).length >= 2)
    out.push('多段文字都堆在主提示词的 Text: 块里：属于某个人物或某一格的对白，请移到对应角色提示词末尾的 Text: 块（文字逐字符保留），主提示词只留全画面共用的文字')
  const hasAction = charTokens.some((toks) => toks.some((t) => t.kind === 'action'))
  const sentences = main.filter((t) => t.status === 'natural').map((t) => t.raw)
  if (chars.length >= 2 && !hasAction && sentences.length)
    out.push(
      `有 ${chars.length} 条角色提示词却没有任何互动前缀，而主提示词里有句子：${sentences.map((s) => `「${s}」`).join('、')}。如果其中描述的是人物之间的动作或关系，请用 search_tags 找到动作 tag，改成 source# / target# / mutual# 成对写进双方的角色提示词，并从主提示词删掉该句；如果与人物互动无关可保持不变`
    )
  return out
}

/** 结构检查：单角色、超出上限、位置写法、角色提示词用法，以及「审美类修改被直接改进了提示词」 */
function structureIssues(req: AiOptimizeRequest, result: AiOptimizeResult): string[] {
  const version = req.version
  const chars = result.characters.filter((c) => c.prompt.trim())
  const out: string[] = []
  // 单角色只在需要指定位置时才用角色提示词；用户原本就写成单角色的保留其结构
  const hadSingle = (req.characters ?? []).filter((c) => c.prompt?.trim()).length === 1
  if (builtinOn(version) && chars.length === 1 && !chars[0].position?.trim() && !hadSingle)
    out.push('只有 1 个角色且没有指定位置时不要使用角色提示词，请把它合并进主提示词，characters 返回 []')
  const limit = MAX_CHARACTERS[version]
  if (chars.length > limit) out.push(`角色数 ${chars.length} 超过当前模型上限 ${limit}`)
  out.push(...positionProblems(chars, version))
  out.push(...regionIssues(req, result))
  const taste = result.changes.filter((c) => c.basis === 'taste' && c.scope !== 'optional')
  if (taste.length)
    out.push(
      `以下修改的依据是审美偏好，不应直接改动用户的提示词：${taste.map((c) => `「${c.text}」`).join('、')}。请把对应改动从提示词中撤回，改为 scope=optional 的建议`
    )
  return out
}

/** Text: 块按空行拆成独立的文字段 */
const textSegments = (text: string) =>
  text
    .split(/\r?\n\s*\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)

/** 主提示词与所有角色提示词里的文字段 */
const allTextSegments = (prompts: (string | undefined)[]) =>
  prompts.flatMap((p) => {
    const t = textBlockOf(p ?? '')
    return t === null ? [] : textSegments(t)
  })

/**
 * 必须逐字保留的内容：原提示词（主提示词与角色提示词）里的 Text: 块。
 * 文字段可以在主提示词和角色提示词之间移动、按空行拆分，但每一段的内容必须原样存在。
 * 与 dropped 不同，即使 changes 里写了理由也不放行（画面文字的空格、标点都是用户要的结果）。
 */
function fidelityIssues(req: AiOptimizeRequest, result: AiOptimizeResult): string[] {
  if (req.mode !== 'optimize') return []
  const before = allTextSegments([req.prompt, ...(req.characters ?? []).map((c) => c.prompt)])
  if (!before.length) return []
  const after = new Set(allTextSegments([result.positive, ...result.characters.map((c) => c.prompt)]))
  return before.filter((s) => !after.has(s)).map((s) => `画面文字「${s}」不见了或被改写`)
}

/* ---------- 保真核对：原有内容被删掉却没有说明 ---------- */

type Tok = ReturnType<typeof analyzePrompt>['tokens'][number]
const norm = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
/** 同一概念的比较键：tag 用标准名（别名、权重变化不算删除），其余用规整后的原文 */
const keyOf = (t: Tok) => {
  const tag = t.tag ?? t.aliasOf
  return tag ? `${t.prefix ?? ''}${tag.name}` : norm(`${t.prefix ?? ''}${t.core}`)
}
const tokensOf = (texts: (string | undefined)[], version: NaiVersion) =>
  texts.flatMap((x) => (x?.trim() ? analyzePrompt(x, version).tokens : []))

/**
 * 找出原提示词里有、结果里没有、changes 也没提到的内容。
 * 正向（主提示词 + 角色）合在一起比较：内容在主提示词和角色之间移动不算删除；负面同理。
 */
function droppedItems(req: AiOptimizeRequest, result: AiOptimizeResult): string[] {
  if (req.mode !== 'optimize') return []
  const v = req.version
  const chars = req.characters ?? []
  const groups: [Tok[], Tok[]][] = [
    [tokensOf([req.prompt, ...chars.map((c) => c.prompt)], v), tokensOf([result.positive, ...result.characters.map((c) => c.prompt)], v)],
    [tokensOf([req.negative, ...chars.map((c) => c.negative)], v), tokensOf([result.negative, ...result.characters.map((c) => c.negative)], v)]
  ]
  const said = norm(result.changes.map((c) => `${c.text} ${c.evidence}`).join('\n'))
  const mentioned = (t: Tok) => {
    const core = norm(t.core)
    const head = core.split(' ').slice(0, 3).join(' ')
    const tag = t.tag ?? t.aliasOf
    return said.includes(core) || (core.split(' ').length > 3 && said.includes(head)) || (!!tag && said.includes(norm(tag.display)))
  }
  const out = new Map<string, string>()
  for (const [before, after] of groups) {
    const kept = new Set(after.map(keyOf))
    for (const t of before) {
      // 画面文字由 fidelityIssues 逐段核对（允许移动、拆分）
      if (t.kind === 'text') continue
      const k = keyOf(t)
      if (!kept.has(k) && !out.has(k) && !mentioned(t)) out.set(k, t.raw)
    }
  }
  return [...out.values()]
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
    dropped: [],
    fidelity: [],
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
    const structure = structureIssues(req, result)
    const dropped = droppedItems(req, result)
    const fidelity = fidelityIssues(req, result)
    result.invalid = invalid
    result.dropped = req.mode === 'optimize' ? dropped : null
    result.fidelity = fidelity
    if ((!invalid.length && !structure.length && !dropped.length && !fidelity.length) || fixRound >= MAX_FIX_ROUNDS) break
    fixRound++
    const found = [
      invalid.length && `${invalid.length} 个无效 tag`,
      structure.length && `${structure.length} 处结构问题`,
      dropped.length && `${dropped.length} 处原有内容被删且未说明`,
      fidelity.length && '画面文字被改写'
    ].filter(Boolean)
    onStep(`本地校验发现 ${found.join('、')}，要求 AI 修正（第 ${fixRound} 轮）`)
    const validated = invalid.length ? await runTool('validate_tags', JSON.stringify({ tags: invalid }), log, signal) : ''
    messages.push({
      role: 'user',
      content: [
        validated && `以下 tag 在 Danbooru 中不存在或不是标准写法：\n${validated}`,
        structure.length && `结构问题：\n${structure.map((s) => '- ' + s).join('\n')}`,
        dropped.length &&
          `以下原有内容在结果里不见了，changes 里也没有说明：\n${dropped.map((s) => `- 「${s}」`).join('\n')}\n用户写的内容要保留；确需删除或改写的（如冲突、冗余、换成标准 tag），在 changes 的 text 里写明原文和理由。`,
        fidelity.length &&
          `画面文字必须逐字符保留（包括空格和标点），即使有理由也不能改：\n${fidelity.map((s) => `- ${s}`).join('\n')}\n请恢复原文（可以放在主提示词或说话者角色提示词末尾的 Text: 块里，但文字本身不能改）。本地解析器会把 Text: 之后的全部内容当作画面文字，不需要为它调整写法。`,
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
