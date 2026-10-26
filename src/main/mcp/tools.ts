import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { AiCharacter, NaiGenParams, NaiNoiseSchedule, NaiSampler, NaiVersion, UcPreset } from '../../shared/types'
import { readPngPrompt } from '../../shared/prompt-import'
import { getSettings } from '../settings'
import {
  MODEL_LABEL,
  SCOPE_LABEL,
  composeSkills,
  coreText,
  createSkill,
  deleteSkill,
  duplicateSkill,
  getConfig,
  getSkill,
  importSkillFile,
  setConfig,
  updateSkill
} from '../skills'
import { tagTool, TAG_TOOL_DEFS, optimizePrompt } from '../ai/optimizer'
import { previewPrompt, reviewPrompt } from '../ai/previewer'
import { freeCheck, generateImages, getSubscription, imagePath, listImages, FREE_MAX_PIXELS, FREE_MAX_STEPS } from '../nai/client'
import type { McpTool } from './server'
import { inpaintTools } from './inpaint-tools'
import { AGENT_ENTRY, AGENT_GUIDE_TOPICS, agentGuide } from './agent-guide'

/* ---------- 参数解析 ---------- */

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}
const version = (v: unknown): NaiVersion => (v === 'v5' || v === 'v4.5' ? v : getSettings().naiVersion)
const ucPreset = (v: unknown): UcPreset => (['heavy', 'light', 'human', 'none'].includes(v as string) ? (v as UcPreset) : 'heavy')
function characters(v: unknown): AiCharacter[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({ prompt: str(c.prompt), negative: str(c.negative), position: str(c.position) }))
    .filter((c) => c.prompt.trim())
}
const json = (v: unknown) => JSON.stringify(v, null, 2)

/** 宽高的原始输入被改动（无效、越界、非整数）时，说明实际使用的值 */
function sizeNotes(a: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const [key, d] of [['width', 832], ['height', 1216]] as const) {
    const raw = a[key]
    if (raw === undefined || raw === null || raw === '') continue
    const used = num(raw, d, 64, 4096)
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) out.push(`${key}=${JSON.stringify(raw)} 不是有效数字，按默认值 ${d} 检查`)
    else if (used !== n) out.push(`${key}=${n} 超出 64~4096，按 ${used} 检查（原参数无效，不能直接用于生图）`)
  }
  return out
}

/* ---------- 公共 schema ---------- */

const CHARACTERS_SCHEMA = {
  type: 'array',
  description:
    '角色提示词（带位置的区域提示词）。每个人物、同一人物的每次出现（漫画多格）、漫画每一格里的每个人物各一条；单人单画面且不需要定位时留空、全部写进 base',
  items: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          '角色提示词：girl/boy/other（不加数字）→ 角色名 → 外貌 → 服装 → 表情 → 动作；人物互动用 source#动作 / target#动作 / mutual#动作 成对写在双方；该人物 / 该格的对白写在末尾 Text: 块'
      },
      negative: { type: 'string', description: '角色负面，只放与其他角色相区分的特征，防止串色' },
      position: {
        type: 'string',
        description: '只支持两种写法：5×5 网格 A1~E5（列左→右，行上→下，C3 中心），或归一化坐标 "0.3,0.5"（0~1，原点左上，V5 用）。其他写法（如自然语言）会被忽略并自动排布'
      }
    },
    required: ['prompt']
  }
}

const PROMPT_PROPS = {
  base: { type: 'string', description: '主提示词（Base Prompt）' },
  negative: { type: 'string', description: '负面提示词（Undesired Content）' },
  characters: CHARACTERS_SCHEMA,
  version: { type: 'string', enum: ['v4.5', 'v5'], description: '目标模型（Full），默认使用软件里的设置' }
}

const PARAM_PROPS = {
  width: { type: 'integer', description: '宽，64 的倍数，默认 832' },
  height: { type: 'integer', description: '高，64 的倍数，默认 1216' },
  quality_tags: { type: 'boolean', description: '是否追加 NAI 的 Add Quality Tags（Standard 档，默认 true）' },
  uc_preset: { type: 'string', enum: ['heavy', 'light', 'human', 'none'], description: '追加到负面的 UC 预设，默认 heavy' }
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false }

const tagDef = (name: string) => TAG_TOOL_DEFS.find((t) => t.function.name === name)!.function

function aiGate(): string | null {
  const s = getSettings()
  if (!s.mcpAllowAi) return '需要在 NovelPrompt「设置 / 数据 → Agent 接入」中开启「允许调用 DeepSeek」'
  if (!s.apiKey) return '需要先在 NovelPrompt 设置里填写 DeepSeek API Key'
  return null
}

/* ---------- Skill 管理 ---------- */

const SKILL_FIELDS = {
  name: { type: 'string', description: 'Skill 名称' },
  description: { type: 'string', description: '一句话说明这份 Skill 管什么（会出现在给 AI 的 Skill 清单里）' },
  scope: { type: 'string', enum: ['optimize', 'preview', 'inpaint', 'all'], description: '作用于哪个功能：optimize = AI 优化 / 描述转提示词（也是 prompt_guide 的内容），preview = 画面推测，inpaint = 局部重绘，all = 全部功能' },
  model: { type: 'string', enum: ['all', 'v4.5', 'v5'], description: '适用模型，默认 all；正文里也可以用【V4.5】/【V5】标注版本专用的内容' },
  content: { type: 'string', description: 'Skill 正文（Markdown，不含 frontmatter）' }
}

const skillLine = (s: ReturnType<typeof getConfig>[number], i: number) => ({
  priority: i + 1,
  id: s.id,
  name: s.name,
  enabled: s.enabled,
  builtin: s.builtin,
  scope: `${s.scope}（${SCOPE_LABEL[s.scope]}）`,
  model: `${s.model}（${MODEL_LABEL[s.model]}）`,
  description: s.description,
  chars: s.chars
})

const skillList = () => json(getConfig().map(skillLine))

function skillTools(): McpTool[] {
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  return [
    {
      name: 'list_skills',
      title: 'Skill 列表',
      description: '列出全部 Skill（内置 + 用户），按优先级排列（priority 1 最高），含启用状态、作用范围、适用模型、字数。软件内置 AI 与 prompt_guide 只使用 enabled 为 true 且范围、模型匹配的 Skill。',
      inputSchema: { type: 'object', properties: {} },
      annotations: READ_ONLY,
      run: async () => skillList()
    },
    {
      name: 'get_skill',
      title: '读取 Skill',
      description: '读取一份 Skill 的元信息和正文。id 来自 list_skills；传 core 读取固定的「Skill 使用总则」。',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      annotations: READ_ONLY,
      run: async (a) => {
        if (str(a.id) === 'core') return coreText()
        const s = getSkill(str(a.id))
        if (!s) throw new Error(`找不到 Skill：${str(a.id)}`)
        return json(s)
      }
    },
    {
      name: 'create_skill',
      title: '新建 / 导入 Skill',
      description:
        '新建一份用户 Skill。三种来源任选其一：直接传 name + content；传 path 导入本机 .md 文件（frontmatter 里的 name / description / scope / model 会被读取）；传 duplicate_from 复制一份已有 Skill（含内置）。新建与导入默认启用并放在最高优先级，复制默认不启用、放在原 Skill 上方；可用 enabled / priority 覆盖。',
      inputSchema: {
        type: 'object',
        properties: {
          ...SKILL_FIELDS,
          path: { type: 'string', description: '要导入的 .md 文件绝对路径' },
          duplicate_from: { type: 'string', description: '要复制的 Skill id' },
          enabled: { type: 'boolean' },
          priority: { type: 'integer', description: '放到第几位（1 = 最高）' }
        }
      },
      annotations: WRITE,
      run: async (a) => {
        let doc
        if (str(a.duplicate_from)) {
          doc = duplicateSkill(str(a.duplicate_from))
          const patch = { name: str(a.name) || undefined, description: str(a.description) || undefined, content: str(a.content) || undefined }
          if (patch.name || patch.description || patch.content || a.scope || a.model)
            doc = updateSkill(doc.id, { ...patch, scope: a.scope as never, model: a.model as never })
        } else if (str(a.path)) {
          doc = importSkillFile(str(a.path))
        } else {
          doc = createSkill({ name: str(a.name), description: str(a.description), scope: a.scope as never, model: a.model as never, content: str(a.content) })
        }
        if (typeof a.enabled === 'boolean' || a.priority !== undefined) {
          const list = getConfig().filter((c) => c.id !== doc.id)
          const self = getConfig().find((c) => c.id === doc.id)!
          const at = a.priority === undefined ? getConfig().findIndex((c) => c.id === doc.id) : Math.round(num(a.priority, 1, 1, 999)) - 1
          list.splice(Math.max(0, Math.min(at, list.length)), 0, { ...self, enabled: typeof a.enabled === 'boolean' ? a.enabled : self.enabled })
          setConfig(list)
        }
        return `已创建 Skill「${doc.name}」（id: ${doc.id}）。\n\n当前列表：\n${skillList()}`
      }
    },
    {
      name: 'update_skill',
      title: '修改 Skill',
      description: '修改一份用户 Skill 的名称、说明、作用范围、适用模型或正文（只传要改的字段）。内置 Skill 不能修改，可以先用 create_skill 的 duplicate_from 复制。',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...SKILL_FIELDS }, required: ['id'] },
      annotations: { ...WRITE, idempotentHint: true },
      run: async (a) => {
        const doc = updateSkill(str(a.id), {
          name: typeof a.name === 'string' ? a.name : undefined,
          description: typeof a.description === 'string' ? a.description : undefined,
          scope: a.scope as never,
          model: a.model as never,
          content: typeof a.content === 'string' ? a.content : undefined
        })
        return `已更新 Skill「${doc.name}」（${doc.chars} 字）。`
      }
    },
    {
      name: 'delete_skill',
      title: '删除 Skill',
      description: '删除一份用户 Skill（文件一并删除，不可恢复）。内置 Skill 不能删除，只能在 set_skill_config 里关闭。',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
      run: async (a) => {
        const s = getSkill(str(a.id))
        deleteSkill(str(a.id))
        return `已删除 Skill「${s?.name ?? str(a.id)}」。\n\n当前列表：\n${skillList()}`
      }
    },
    {
      name: 'set_skill_config',
      title: '启用与优先级',
      description:
        '设置 Skill 的启用状态与优先级。传入全部 Skill 时，数组顺序即新的优先级（第 1 个最高）；只传其中几份时，只修改它们的启用状态，顺序不变。',
      inputSchema: {
        type: 'object',
        properties: {
          skills: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] }
          }
        },
        required: ['skills']
      },
      annotations: { ...WRITE, idempotentHint: true },
      run: async (a) => {
        const list = (Array.isArray(a.skills) ? (a.skills as Record<string, unknown>[]) : []).map((x) => ({ id: str(x?.id), enabled: x?.enabled === true }))
        const current = getConfig()
        const known = new Set(current.map((c) => c.id))
        const unknown = list.map((x) => x.id).filter((id) => !known.has(id))
        if (unknown.length) throw new Error(`找不到这些 Skill：${unknown.join(', ')}（用 list_skills 查看 id）`)
        const full = known.size === new Set(list.map((x) => x.id)).size
        if (full) setConfig(list)
        else {
          const patch = new Map(list.map((x) => [x.id, x.enabled]))
          setConfig(current.map((c) => ({ id: c.id, enabled: patch.get(c.id) ?? c.enabled })))
        }
        return `已保存。\n\n当前列表：\n${skillList()}`
      }
    }
  ]
}

/* ---------- 工具 ---------- */

/**
 * 给外部 agent 的入口说明。本软件不再往 agent 目录安装 Skill：
 * 提示词规范由用户在软件里启用的 Skill 组合而成（按优先级），agent 通过 prompt_guide 读取。
 */
export const MCP_INSTRUCTIONS = `${AGENT_ENTRY}

写、查、改 NovelAI 提示词先读取 prompt_guide；局部重绘读取 inpaint_guide；接管工作台读取 get_workspace_context 中本轮冻结的 Skill。实际处理前阅读相关完整规则，按用户启用的优先级执行。
tag 使用 search_tags / validate_tags 的依据；保留用户明确的语义，完成后 analyze_prompt 复查。生成须有用户明确授权并传 confirm:true，返回 stopped 则停止。optimize_prompt / preview_prompt / plan_inpaint 调用内置 AI 并消耗额度；外部 Agent 通常自行推理。
工具参数以 tools/list 为准，能力选择、操作顺序与恢复方式以 agent_guide 为准。`

const AGENT_GUIDE = `# NovelPrompt 提示词工作指南（给外部 agent）

本指南只指导提示词任务。软件能力、前后台选择与工作台操作顺序先读 agent_guide；通过工作台回复方案时按工具的 JSON schema 写回，不使用下述分节文本替代接口参数。

本工具返回两部分：先是这份使用说明，然后是「Skill 使用总则」和用户在软件里为 AI 优化功能启用的 Skill（按优先级排列）。Skill 也是软件内置 AI 的系统提示词：其中要求输出 JSON、填写 assessment / changes 字段的部分只针对内置 AI，你交付给用户时按本说明的格式；其余规则（语法、编排、角色提示词、负面、依据）同样适用于你，多份 Skill 冲突时按总则的优先级处理。本说明里的语法与格式要求优先于 Skill。

## 工作流
1. 理解范围：区分用户已确定的内容、允许调整的部分和你想新增的建议。检查现有提示词时只修本次的问题。
2. 拆概念后一次性 search_tags（角色、作品、画师用 category 限定；中文搜不到换英文）。近义词拿不准用 tag_wiki；涉及具体角色、画师用 related_tags。
3. 按 Skill 编排：Base、角色提示词、UC 分开；tag 表达不了的关系（数量、左右、谁对谁做什么）写成英文短句，句内不用逗号，以句号结尾。
4. 用 analyze_prompt 传入完整内容和实际参数复查，逐条处理报告：修正，或向用户说明保留理由。改过的部分再查一次即可，不要为了零警告反复循环。
5. 交付前对照原要求：用户写明的内容都还在；被删掉或改写的原有内容要说明原文和理由；新增的画师、饰物、年龄体型、动作只作为可选建议。

## 交付格式
默认用分节文本（用户可以直接粘贴进 NovelPrompt，会自动拆分到各输入框；也可以照着填进 NovelAI）：

\`\`\`
[Prompt]
2girls, artist:xxx, outdoors, cherry blossoms, ...

[Character 1 @ B3]
girl, silver hair, red eyes, white dress, smile

[Character 1 Undesired Content]
black hair, glasses

[Character 2 @ D3]
girl, black hair, short hair, glasses, school uniform

[Undesired Content]
lowres, worst quality, bad quality, ...
\`\`\`

- 分节标题是 NovelPrompt 的导入格式，不是 NAI 语法。没有位置时写 [Character 1]；空的分节直接省略，不要用说明文字占位。
- 另附：模型版本、建议画幅、Add Quality Tags 与 UC 预设是否开启；关键改动及依据；可选建议。

## 工具参数要点
- analyze_prompt / generate_image 的 version 只有 v4.5 / v5（Full 模型）；quality_tags 为布尔值（Standard 档）；uc_preset 为 heavy / light / human / none。Curated、Effort 等官网选项本工具没有提供，不要假称已设置。省略的参数会用软件默认值，说明结论时注明。
- 角色 position 只支持 A1~E5 网格或 "0.3,0.5" 坐标，其他写法会被忽略。
- read_image_prompt 读出的是实际发送的内容（已含质量词和 UC 预设）；角色位置正好在网格中心时返回网格，否则返回原坐标。
- search_tags / validate_tags / related_tags / tag_wiki 单次上限分别为 20 / 80 / 6 / 8 项，超出部分不处理，返回末尾会列出未处理项。
- 画面文字写成 \`Text: 文字\`，放在所在提示词的最末尾；source# / target# / mutual# 只写在角色提示词里；英文短句句内不用逗号。

## Skill 管理
- list_skills 查看全部 Skill（启用状态、优先级、作用范围、适用模型）；get_skill 读取正文。
- 内置 Skill（id 以 builtin: 开头）只读，只能启用 / 关闭 / 调整优先级，或用 duplicate_from 复制成用户 Skill 再改。
- 按用户的要求增删改 Skill、调整启用与优先级；改完告诉用户改了什么。

## 内置 AI 结果的复核
optimize_prompt / preview_prompt 调用内置 DeepSeek，消耗用户额度；用了也要复核结果：
- dropped：optimize 模式下被删掉且没有说明的原有内容；semantic 模式没有原提示词可比，为 null，需要你对照描述逐项核对。
- fidelity：必须逐字保留却被改写的画面文字（Text: 块），不为空时把原文恢复后再交付。
- invalid 为空只代表 tag 都存在，不代表语义要求都保住了。

## 生图（用户明确要求时）
1. 先 nai_subscription 确认免费额度可用（Opus 会员、总像素 ≤ 1024×1024、步数 ≤ 28、V5 还要看免费额度）。
2. generate_image 必须传 confirm: true。这是接口要求，不能代替用户授权。需要对比改词效果时固定 seed。
3. 返回 stopped 不为空时（额度不足、检测到扣费、未开启生图权限）停止并如实告知，不要换参数绕过。
4. 能看图时打开图片对照检查。文本审查完成、拿到图片、画面符合要求是三件事，分别说明。

---

`

export function buildTools(): McpTool[] {
  return [
    {
      name: 'agent_guide', title: '外部 Agent 能力与操作指南',
      description: '首次接入先读：能力地图、何时用后台/前台、外部 Agent 与内置 AI 的区别、工作台和重绘操作流程、冲突恢复及限制。overview 为默认入口；操作工作台前读 workflows。提示词规则另读 prompt_guide/inpaint_guide 或本轮冻结 Skill。',
      inputSchema: { type: 'object', properties: { topic: { type: 'string', enum: AGENT_GUIDE_TOPICS, description: '默认 overview；按需读取其他章节，all 返回完整指南。' } } },
      annotations: READ_ONLY,
      run: async a => json(agentGuide(a.topic))
    },
    ...inpaintTools(),
    {
      name: 'prompt_guide',
      title: '提示词规范',
      description:
        '返回工具使用说明（工作流、交付格式、参数要点），以及用户在软件里启用的 NovelAI 提示词 Skill（按优先级排列，附优先级取舍总则）。写提示词前先读一遍。',
      inputSchema: { type: 'object', properties: { version: PROMPT_PROPS.version, detail: { type: 'string', enum: ['full', 'summary'], description: '默认 full。仅探索工具时可用 summary 获取规则目录与指纹；实际写提示词前仍需读取相关完整规则。' } } },
      annotations: READ_ONLY,
      run: async (a) => {
        const text = AGENT_GUIDE + composeSkills('optimize', version(a.version)).text
        return a.detail === 'summary' ? json({ fingerprint: createHash('sha256').update(text).digest('hex'), version: version(a.version),
          guide: '先读 core 与下列启用规则，再查词、编排、analyze_prompt 复核；生成必须获得用户授权。用 get_skill 读取正文，或 prompt_guide(detail:full)。',
          skills: getConfig().filter(s => s.enabled && ['optimize', 'all'].includes(s.scope) && (s.model === 'all' || s.model === version(a.version))).map(s => ({ id: s.id, name: s.name, chars: s.chars })) }) : text
      }
    },
    ...skillTools(),
    {
      name: 'analyze_prompt',
      title: '检查整套提示词',
      description:
        '不调用 AI 的完整本地检查：逐段（主提示词 / 每个角色 / 角色负面 / 负面）解析每个 tag 的存在性、别名、分类、引用数、中文、实际权重；列出正负面冲突（含 UC 预设）、包含关系冗余、权重过高、版本不适用；并联网查询其中角色、画师、作品 tag 的 Danbooru 统计（角色默认外观、画师倾向），指出与角色设定冲突的写法。',
      inputSchema: { type: 'object', properties: { ...PROMPT_PROPS, ...PARAM_PROPS }, required: ['base'] },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: async (a, signal) => {
        const report = await reviewPrompt(
          {
            base: str(a.base),
            negative: str(a.negative),
            characters: characters(a.characters),
            params: {
              width: num(a.width, 832, 64, 4096),
              height: num(a.height, 1216, 64, 4096),
              qualityTags: bool(a.quality_tags, true),
              ucPreset: ucPreset(a.uc_preset)
            },
            expectation: '',
            version: version(a.version)
          },
          signal
        )
        const notes = sizeNotes(a)
        return notes.length ? `## 参数调整\n${notes.map((n) => `- ${n}`).join('\n')}\n\n${report}` : report
      }
    },
    ...(['search_tags', 'validate_tags', 'related_tags', 'tag_wiki'] as const).map(
      (name): McpTool => ({
        name,
        description: tagDef(name).description,
        inputSchema: tagDef(name).parameters,
        annotations: { readOnlyHint: true, openWorldHint: name === 'related_tags' || name === 'tag_wiki' },
        run: (a, signal) => tagTool(name, a, signal)
      })
    ),
    {
      name: 'optimize_prompt',
      title: 'AI 优化（DeepSeek）',
      description:
        '调用 NovelPrompt 内置的 DeepSeek 流程优化提示词（会自动检索、校验 tag 并本地复查），或把中文画面描述转成整套提示词（mode=semantic，instruction 写描述）。返回 JSON：positive / negative / characters / assessment / changes（每条带依据）/ invalid / dropped / fidelity。消耗用户的 DeepSeek 额度。',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['optimize', 'semantic'], description: 'optimize = 优化现有提示词；semantic = 描述转提示词' },
          instruction: { type: 'string', description: 'optimize 时为额外要求；semantic 时为画面描述' },
          ...PROMPT_PROPS
        }
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      gate: aiGate,
      run: async (a, signal, progress) => {
        const r = await optimizePrompt(
          {
            mode: a.mode === 'semantic' ? 'semantic' : 'optimize',
            prompt: str(a.base),
            negative: str(a.negative),
            characters: characters(a.characters),
            instruction: str(a.instruction),
            version: version(a.version)
          },
          progress ?? (() => {}),
          signal
        )
        const semantic = a.mode === 'semantic'
        return json({
          positive: r.positive,
          negative: r.negative,
          characters: r.characters,
          assessment: r.notes,
          changes: r.changes,
          invalid: r.invalid,
          dropped: r.dropped,
          fidelity: r.fidelity,
          ...(semantic
            ? { note: '语义转换没有原提示词可比对，dropped 为 null 不代表无遗漏；请对照描述逐项核对年龄、数量、左右、归属、画面文字等要求是否写进了实际提示词' }
            : {})
        })
      }
    },
    {
      name: 'preview_prompt',
      title: '画面推测（DeepSeek）',
      description: '调用 NovelPrompt 内置的 DeepSeek 推测这套提示词会画出什么，并给出风险和建议（带依据）。expectation 填想要的效果时会对比差距。消耗用户的 DeepSeek 额度。',
      inputSchema: {
        type: 'object',
        properties: { ...PROMPT_PROPS, ...PARAM_PROPS, expectation: { type: 'string', description: '想要的效果（可空）' } },
        required: ['base']
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      gate: aiGate,
      run: async (a, signal, progress) => {
        const notes = sizeNotes(a)
        const r = await previewPrompt(
          {
            base: str(a.base),
            negative: str(a.negative),
            characters: characters(a.characters),
            params: {
              width: num(a.width, 832, 64, 4096),
              height: num(a.height, 1216, 64, 4096),
              qualityTags: bool(a.quality_tags, true),
              ucPreset: ucPreset(a.uc_preset)
            },
            expectation: str(a.expectation),
            version: version(a.version)
          },
          progress ?? (() => {}),
          signal
        )
        return json(notes.length ? { paramNotes: notes, ...r } : r)
      }
    },
    {
      name: 'nai_subscription',
      title: 'NovelAI 余额',
      description: '查询 NovelAI 会员、Anlas 余额与 V5 免费额度，以及默认参数（832×1216、23 步）是否满足免费生成条件。不会生成图片。',
      inputSchema: { type: 'object', properties: { version: PROMPT_PROPS.version } },
      annotations: { readOnlyHint: true, openWorldHint: true },
      gate: () => (getSettings().naiToken.trim() ? null : '需要先在 NovelPrompt 设置里填写 NovelAI Token'),
      run: async (a, signal) => {
        const sub = await getSubscription(signal)
        return json({ subscription: sub, freeCheckForDefaults: freeCheck({ width: 832, height: 1216, steps: 23 }, version(a.version), sub) })
      }
    },
    {
      name: 'generate_image',
      title: 'NovelAI 生图',
      description: `用 NovelAI 文生图并保存到本机图库，返回图片文件路径。强制只用免费额度：生成前检查 Opus 会员、免费额度、总像素 ≤ ${FREE_MAX_PIXELS}、步数 ≤ ${FREE_MAX_STEPS}，不满足就不提交；每张生成后核对 Anlas，发现扣除立即停止。必须传 confirm: true。每次最多 4 张，逐张生成。`,
      inputSchema: {
        type: 'object',
        properties: {
          ...PROMPT_PROPS,
          ...PARAM_PROPS,
          steps: { type: 'integer', description: `步数，默认 23，免费上限 ${FREE_MAX_STEPS}` },
          scale: { type: 'number', description: 'Prompt Guidance，默认 5' },
          cfg_rescale: { type: 'number', description: 'Guidance Rescale 0~1，默认 0' },
          sampler: { type: 'string', enum: ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde'] },
          noise_schedule: { type: 'string', enum: ['native', 'karras', 'exponential', 'polyexponential'] },
          seed: { type: 'integer', description: '种子，不填随机；多张时依次 +1' },
          count: { type: 'integer', description: '张数 1~4，默认 1' },
          confirm: { type: 'boolean', description: '必须为 true 才会真正提交生成' }
        },
        required: ['base', 'confirm']
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      gate: () => {
        const s = getSettings()
        if (!s.mcpAllowGenerate) return '需要在 NovelPrompt「设置 / 数据 → Agent 接入」中开启「允许生图」'
        if (!s.naiToken.trim()) return '需要先在 NovelPrompt 设置里填写 NovelAI Token'
        return null
      },
      run: async (a, signal, progress) => {
        if (a.confirm !== true) throw new Error('需要传 confirm: true 才会生成图片')
        const params: NaiGenParams = {
          width: Math.round(num(a.width, 832, 64, 2048) / 64) * 64,
          height: Math.round(num(a.height, 1216, 64, 2048) / 64) * 64,
          steps: Math.round(num(a.steps, 23, 1, 50)),
          scale: num(a.scale, 5, 0, 10),
          cfgRescale: num(a.cfg_rescale, 0, 0, 1),
          sampler: (str(a.sampler) || 'k_euler_ancestral') as NaiSampler,
          noiseSchedule: (str(a.noise_schedule) || 'native') as NaiNoiseSchedule,
          seed: a.seed === undefined || a.seed === null || a.seed === '' ? null : Math.round(num(a.seed, 0, 0, 4_294_967_295)),
          count: Math.round(num(a.count, 1, 1, 4)),
          qualityTags: bool(a.quality_tags, true),
          ucPreset: ucPreset(a.uc_preset)
        }
        const r = await generateImages(
          { base: str(a.base), negative: str(a.negative), characters: characters(a.characters), params, version: version(a.version) },
          progress ?? (() => {}),
          () => signal.aborted,
          { freeOnly: true }
        )
        if (signal.aborted) r.stopped ??= '已停止，已完成的图片已保留'
        return json({
          images: r.images.map((img) => ({ path: imagePath(img.name), name: img.name, storage: img.storage, seed: img.seed, width: img.width, height: img.height })),
          anlasChange: r.anlasDelta ?? '未知',
          stopped: r.stopped ?? null
        })
      }
    },
    {
      name: 'list_images',
      title: '本机图库',
      description: '列出 NovelPrompt 本机图库中最近生成的图片（文件路径、种子、尺寸、时间），新的在前。',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: '默认 20；小于 1 按 1，大于 100 按 100' } } },
      annotations: READ_ONLY,
      run: async (a) =>
        json(
          listImages(Math.round(num(a.limit, 20, 1, 100))).map((img) => ({
            path: imagePath(img.name),
            name: img.name, storage: img.storage,
            seed: img.seed,
            width: img.width,
            height: img.height,
            createdAt: new Date(img.createdAt).toISOString()
          }))
        )
    },
    {
      name: 'read_image_prompt',
      title: '读取图片里的提示词',
      description: '读取 NovelAI 生成的 PNG 里保存的提示词（主提示词、角色及位置、负面、尺寸）。传图库里的 name，或任意 PNG 文件的绝对路径 path。注意：读出的是实际发送的内容，已包含质量词和 UC 预设。',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' } } },
      annotations: READ_ONLY,
      run: async (a) => {
        const p = str(a.name) ? imagePath(str(a.name)) : str(a.path)
        if (!p || !/\.png$/i.test(p) || !existsSync(p)) throw new Error('找不到这张 PNG 图片')
        const r = await readPngPrompt(new Blob([readFileSync(p)], { type: 'image/png' }))
        return json({ base: r.base, characters: r.characters, negative: r.negative, width: r.width, height: r.height })
      }
    }
  ]
}
