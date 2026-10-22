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
  description: '角色提示词。画面里有 ≥2 个需要区分外貌的人物时使用，单人时留空、全部写进 base',
  items: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '角色提示词：girl/boy/other（不加数字）→ 角色名 → 外貌 → 服装 → 表情 → 动作' },
      negative: { type: 'string', description: '角色负面，只放与其他角色相区分的特征，防止串色' },
      position: { type: 'string', description: 'V4.5 用 5×5 网格 A1~E5（列左→右，行上→下，C3 中心）；也可写 "0.3,0.5" 归一化坐标' }
    },
    required: ['prompt']
  }
}

const PROMPT_PROPS = {
  base: { type: 'string', description: '主提示词（Base Prompt）' },
  negative: { type: 'string', description: '负面提示词（Undesired Content）' },
  characters: CHARACTERS_SCHEMA,
  version: { type: 'string', enum: ['v4.5', 'v5'], description: '目标模型，默认使用软件里的设置' }
}

const PARAM_PROPS = {
  width: { type: 'integer', description: '宽，64 的倍数，默认 832' },
  height: { type: 'integer', description: '高，64 的倍数，默认 1216' },
  quality_tags: { type: 'boolean', description: '是否追加 NAI 的 Add Quality Tags（默认 true）' },
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

export const MCP_INSTRUCTIONS = `NovelPrompt：NovelAI 提示词工具。提供本地 Danbooru tag 库（约 33 万 tag，含别名、包含关系和中文）、Danbooru 共现统计、NovelAI 提示词规范，以及 NovelAI 文生图。

推荐工作流：
1. 第一次使用先调用 prompt_guide 读取提示词规范（语法、顺序、多角色、UC、评判依据）。
2. 写好提示词后调用 analyze_prompt：会逐个 tag 给出是否存在、别名、分类、引用数、实际权重，并列出冲突、冗余、与角色默认外观的冲突，以及角色/画师的统计数据。
3. 用 search_tags / validate_tags 修正写法；角色、画师用 related_tags 查默认外观和倾向；近义候选用 tag_wiki 读释义。除 NAI 专用质量词和自然语言外，tag 必须来自这些工具的结果，不要编造。
4. 修改后再次 analyze_prompt，直到没有「不存在」「别名」「冲突」。
5. 需要看真实效果时调用 generate_image（必须传 confirm: true，且只会使用 NovelAI 免费额度）；用 list_images / read_image_prompt 查看结果。
多角色时 base 只写人数、画风、构图、背景、光影、质量词，每个人的外貌服装写进 characters，避免串色。
optimize_prompt / preview_prompt 会调用软件内置的 DeepSeek，一般情况下你自己根据 analyze_prompt 的数据推理即可。`

export function buildTools(): McpTool[] {
  return [
    {
      name: 'prompt_guide',
      title: '提示词规范',
      description: '返回 NovelAI 提示词编排规范（Skill 文档）：语法与权重、编排顺序、画师、多角色与位置、NAI 专用 tag、UC 预设与正负面冲突、评判依据分级。写提示词前先读一遍。',
      inputSchema: { type: 'object', properties: {} },
      annotations: READ_ONLY,
      run: async () => {
        try {
          return readFileSync(skillPath('nai-prompt.md'), 'utf8')
        } catch {
          return '没有找到规范文档'
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
        return json({ positive: r.positive, negative: r.negative, characters: r.characters, assessment: r.notes, changes: r.changes, invalid: r.invalid })
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
