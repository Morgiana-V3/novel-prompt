import { createHash } from 'node:crypto'
import { optimizePrompt } from '../../../modules/prompts/optimizer'
import { previewPrompt, reviewPrompt } from '../../../modules/prompts/previewer'
import { composeSkills, getConfig } from '../../../modules/skills/service'
import {
  PARAM_PROPS,
  PROMPT_PROPS,
  READ_ONLY,
  aiGate,
  bool,
  characters,
  json,
  num,
  sizeNotes,
  str,
  ucPreset,
  version,
} from '../tool-input'
import type { McpTool } from '../types'
import { AGENT_GUIDE } from './guides'

export function createPromptGuideTool(): McpTool {
  return {
    name: 'prompt_guide',
    title: '提示词规范',
    description:
      '返回工具使用说明（工作流、交付格式、参数要点），以及用户在软件里启用的 NovelAI 提示词 Skill（按优先级排列，附优先级取舍总则）。写提示词前先读一遍。',
    inputSchema: {
      type: 'object',
      properties: {
        version: PROMPT_PROPS.version,
        detail: {
          type: 'string',
          enum: ['full', 'summary'],
          description:
            '默认 full。仅探索工具时可用 summary 获取规则目录与指纹；实际写提示词前仍需读取相关完整规则。',
        },
      },
    },
    annotations: READ_ONLY,
    run: async (argumentsRecord) => {
      const text = AGENT_GUIDE + composeSkills('optimize', version(argumentsRecord.version)).text
      return argumentsRecord.detail === 'summary'
        ? json({
            fingerprint: createHash('sha256').update(text).digest('hex'),
            version: version(argumentsRecord.version),
            guide:
              '先读 core 与下列启用规则，再查词、编排、analyze_prompt 复核；生成必须获得用户授权。用 get_skill 读取正文，或 prompt_guide(detail:full)。',
            skills: getConfig()
              .filter(
                (skill) =>
                  skill.enabled &&
                  ['optimize', 'all'].includes(skill.scope) &&
                  (skill.model === 'all' || skill.model === version(argumentsRecord.version)),
              )
              .map((skill) => ({ id: skill.id, name: skill.name, chars: skill.chars })),
          })
        : text
    },
  }
}

export function createAnalyzePromptTool(): McpTool {
  return {
    name: 'analyze_prompt',
    title: '检查整套提示词',
    description:
      '不调用 AI 的完整本地检查：逐段（主提示词 / 每个角色 / 角色负面 / 负面）解析每个 tag 的存在性、别名、分类、引用数、中文、实际权重；列出正负面冲突（含 UC 预设）、包含关系冗余、权重过高、版本不适用；并联网查询其中角色、画师、作品 tag 的 Danbooru 统计（角色默认外观、画师倾向），指出与角色设定冲突的写法。',
    inputSchema: {
      type: 'object',
      properties: { ...PROMPT_PROPS, ...PARAM_PROPS },
      required: ['base'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (argumentsRecord, signal) => {
      const report = await reviewPrompt(
        {
          base: str(argumentsRecord.base),
          negative: str(argumentsRecord.negative),
          characters: characters(argumentsRecord.characters),
          params: {
            width: num(argumentsRecord.width, 832, 64, 4096),
            height: num(argumentsRecord.height, 1216, 64, 4096),
            qualityTags: bool(argumentsRecord.quality_tags, true),
            ucPreset: ucPreset(argumentsRecord.uc_preset),
          },
          expectation: '',
          version: version(argumentsRecord.version),
        },
        signal,
      )
      const notes = sizeNotes(argumentsRecord)
      return notes.length
        ? `## 参数调整\n${notes.map((text) => `- ${text}`).join('\n')}\n\n${report}`
        : report
    },
  }
}

export function createOptimizePromptTool(): McpTool {
  return {
    name: 'optimize_prompt',
    title: 'AI 优化（DeepSeek）',
    description:
      '调用 NovelPrompt 内置的 DeepSeek 流程优化提示词（会自动检索、校验 tag 并本地复查），或把中文画面描述转成整套提示词（mode=semantic，instruction 写描述）。返回 JSON：positive / negative / characters / assessment / changes（每条带依据）/ invalid / dropped / fidelity。消耗用户的 DeepSeek 额度。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['optimize', 'semantic'],
          description: 'optimize = 优化现有提示词；semantic = 描述转提示词',
        },
        instruction: {
          type: 'string',
          description: 'optimize 时为额外要求；semantic 时为画面描述',
        },
        ...PROMPT_PROPS,
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    gate: aiGate,
    run: async (argumentsRecord, signal, progress) => {
      const optimization = await optimizePrompt(
        {
          mode: argumentsRecord.mode === 'semantic' ? 'semantic' : 'optimize',
          prompt: str(argumentsRecord.base),
          negative: str(argumentsRecord.negative),
          characters: characters(argumentsRecord.characters),
          instruction: str(argumentsRecord.instruction),
          version: version(argumentsRecord.version),
        },
        progress ?? (() => {}),
        signal,
      )
      const semantic = argumentsRecord.mode === 'semantic'
      return json({
        positive: optimization.positive,
        negative: optimization.negative,
        characters: optimization.characters,
        assessment: optimization.notes,
        changes: optimization.changes,
        invalid: optimization.invalid,
        dropped: optimization.dropped,
        fidelity: optimization.fidelity,
        ...(semantic
          ? {
              note: '语义转换没有原提示词可比对，dropped 为 null 不代表无遗漏；请对照描述逐项核对年龄、数量、左右、归属、画面文字等要求是否写进了实际提示词',
            }
          : {}),
      })
    },
  }
}

export function createPreviewPromptTool(): McpTool {
  return {
    name: 'preview_prompt',
    title: '画面推测（DeepSeek）',
    description:
      '调用 NovelPrompt 内置的 DeepSeek 推测这套提示词会画出什么，并给出风险和建议（带依据）。expectation 填想要的效果时会对比差距。消耗用户的 DeepSeek 额度。',
    inputSchema: {
      type: 'object',
      properties: {
        ...PROMPT_PROPS,
        ...PARAM_PROPS,
        expectation: { type: 'string', description: '想要的效果（可空）' },
      },
      required: ['base'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    gate: aiGate,
    run: async (argumentsRecord, signal, progress) => {
      const notes = sizeNotes(argumentsRecord)
      const preview = await previewPrompt(
        {
          base: str(argumentsRecord.base),
          negative: str(argumentsRecord.negative),
          characters: characters(argumentsRecord.characters),
          params: {
            width: num(argumentsRecord.width, 832, 64, 4096),
            height: num(argumentsRecord.height, 1216, 64, 4096),
            qualityTags: bool(argumentsRecord.quality_tags, true),
            ucPreset: ucPreset(argumentsRecord.uc_preset),
          },
          expectation: str(argumentsRecord.expectation),
          version: version(argumentsRecord.version),
        },
        progress ?? (() => {}),
        signal,
      )
      return json(notes.length ? { paramNotes: notes, ...preview } : preview)
    },
  }
}
