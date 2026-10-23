import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AiCharacter, NaiGenParams, NaiNoiseSchedule, NaiSampler, NaiVersion, UcPreset } from '../../shared/types'
import { readPngPrompt } from '../../shared/prompt-import'
import { getSettings } from '../settings'
import { skillPath } from '../paths'
import { tagTool, TAG_TOOL_DEFS, optimizePrompt } from '../ai/optimizer'
import { previewPrompt, reviewPrompt } from '../ai/previewer'
import { freeCheck, generateImages, getSubscription, imageDir, imagePath, listImages, FREE_MAX_PIXELS, FREE_MAX_STEPS } from '../nai/client'
import type { McpTool } from './server'

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

/* ---------- 公共 schema ---------- */

const CHARACTERS_SCHEMA = {
  type: 'array',
  description: '角色提示词。画面里有 ≥2 个需要区分外貌的人物时使用；单人默认留空、全部写进 base（需要指定人物位置时可以只放 1 个角色）',
  items: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '角色提示词：girl/boy/other（不加数字）→ 角色名 → 外貌 → 服装 → 表情 → 动作' },
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

/* ---------- 工具 ---------- */

/**
 * 给外部 agent 的入口说明。本软件不再往 agent 目录安装 Skill：
 * 提示词规范只有一份（skills/nai-prompt.md，用户可在软件里修改），agent 通过 prompt_guide 读取。
 */
export const MCP_INSTRUCTIONS = `NovelPrompt：NovelAI（V4.5 / V5）提示词工具。提供本地 Danbooru tag 库（约 33 万 tag，含别名、包含关系和中文）、Danbooru 共现统计与释义、本软件维护的 NovelAI 提示词规范，以及 NovelAI 文生图。

写、查、改 NovelAI 提示词之前，先调用一次 prompt_guide：它返回本软件维护的提示词规范和工具使用说明（用户可以在软件里修改，以它为准，不要用其他来源的 NovelAI 规则替代）。

核心规则：
1. tag 不编造：除 NAI 专用质量词和英文自然语言短句外，tag 必须来自 search_tags / validate_tags 的结果。
2. 用户写明的内容（角色、画师、服装、持物与动作对象、数量与左右、画面文字、负面刻意排除项）必须保留；新增画师、饰物、风格等只作为可选建议。
3. 写好后用 analyze_prompt 复查，逐条处理报告（修正，或说明保留理由）；不为了清零警告删掉用户要的内容。
4. generate_image 只在用户明确要求生图时调用，必须传 confirm: true；返回 stopped 时停止并如实告知。
optimize_prompt / preview_prompt 会调用软件内置的 DeepSeek 并消耗用户额度，一般你自己推理即可。`

const AGENT_GUIDE = `# NovelPrompt 使用说明（给外部 agent）

本工具返回两部分：先是这份使用说明，然后是「NovelAI 提示词编排 Skill」。Skill 是本软件维护的提示词规范，也是软件内置 AI 的系统提示词：其中要求输出 JSON、填写 assessment / changes 字段的部分只针对内置 AI，你交付给用户时按本说明的格式；其余规则（语法、编排、多角色、负面、依据）同样适用于你。

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
- read_image_prompt 读出的是实际发送的内容（已含质量词和 UC 预设）。

## 生图（用户明确要求时）
1. 先 nai_subscription 确认免费额度可用（Opus 会员、总像素 ≤ 1024×1024、步数 ≤ 28、V5 还要看免费额度）。
2. generate_image 必须传 confirm: true。这是接口要求，不能代替用户授权。需要对比改词效果时固定 seed。
3. 返回 stopped 不为空时（额度不足、检测到扣费、未开启生图权限）停止并如实告知，不要换参数绕过。
4. 能看图时打开图片对照检查。文本审查完成、拿到图片、画面符合要求是三件事，分别说明。

optimize_prompt / preview_prompt 调用内置 DeepSeek，消耗用户额度；用了也要复核结果，尤其是 optimize_prompt 返回的 dropped（被删掉且没有说明的原有内容）。

---

`

export function buildTools(): McpTool[] {
  return [
    {
      name: 'prompt_guide',
      title: '提示词规范',
      description:
        '返回本软件维护的 NovelAI 提示词规范（用户可在软件里修改）和工具使用说明：工作流、交付格式、语法与权重、编排、画师、多角色与位置、NAI 专用 tag、UC 预设与正负面冲突、评判依据。写提示词前先读一遍。',
      inputSchema: { type: 'object', properties: {} },
      annotations: READ_ONLY,
      run: async () => {
        try {
          return AGENT_GUIDE + readFileSync(skillPath('nai-prompt.md'), 'utf8')
        } catch {
          return AGENT_GUIDE + '（没有找到提示词规范文档）'
        }
      }
    },
    {
      name: 'analyze_prompt',
      title: '检查整套提示词',
      description:
        '不调用 AI 的完整本地检查：逐段（主提示词 / 每个角色 / 角色负面 / 负面）解析每个 tag 的存在性、别名、分类、引用数、中文、实际权重；列出正负面冲突（含 UC 预设）、包含关系冗余、权重过高、版本不适用；并联网查询其中角色、画师、作品 tag 的 Danbooru 统计（角色默认外观、画师倾向），指出与角色设定冲突的写法。',
      inputSchema: { type: 'object', properties: { ...PROMPT_PROPS, ...PARAM_PROPS }, required: ['base'] },
      annotations: { readOnlyHint: true, openWorldHint: true },
      run: (a, signal) =>
        reviewPrompt(
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
        '调用 NovelPrompt 内置的 DeepSeek 流程优化提示词（会自动检索、校验 tag 并本地复查），或把中文画面描述转成整套提示词（mode=semantic，instruction 写描述）。返回 JSON：positive / negative / characters / assessment / changes（每条带依据）/ invalid。消耗用户的 DeepSeek 额度。',
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
      run: async (a, signal) => {
        const r = await optimizePrompt(
          {
            mode: a.mode === 'semantic' ? 'semantic' : 'optimize',
            prompt: str(a.base),
            negative: str(a.negative),
            characters: characters(a.characters),
            instruction: str(a.instruction),
            version: version(a.version)
          },
          () => {},
          signal
        )
        return json({
          positive: r.positive,
          negative: r.negative,
          characters: r.characters,
          assessment: r.notes,
          changes: r.changes,
          invalid: r.invalid,
          dropped: r.dropped
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
      run: async (a, signal) =>
        json(
          await previewPrompt(
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
            () => {},
            signal
          )
        )
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
      run: async (a, signal) => {
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
          () => {},
          () => signal.aborted,
          { freeOnly: true }
        )
        return json({
          images: r.images.map((img) => ({ path: join(imageDir(), img.name), name: img.name, seed: img.seed, width: img.width, height: img.height })),
          anlasChange: r.anlasDelta ?? '未知',
          stopped: r.stopped ?? null
        })
      }
    },
    {
      name: 'list_images',
      title: '本机图库',
      description: '列出 NovelPrompt 本机图库中最近生成的图片（文件路径、种子、尺寸、时间），新的在前。',
      inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: '默认 20，最多 100' } } },
      annotations: READ_ONLY,
      run: async (a) =>
        json(
          listImages(Math.round(num(a.limit, 20, 1, 100))).map((img) => ({
            path: join(imageDir(), img.name),
            name: img.name,
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
