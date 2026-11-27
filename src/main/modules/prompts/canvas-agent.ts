import { nativeImage } from 'electron'
import {
  MAX_CANVAS_AI_REFERENCES,
  type CanvasAiConnectWire,
  type CanvasAiCreateOperation,
  type CanvasAiDisconnectWire,
  type CanvasAiEdit,
  type CanvasAiImageSummary,
  type CanvasAiOperationSummary,
  type CanvasAiQualityMode,
  type CanvasAiReferenceMode,
  type CanvasAiRequest,
  type CanvasAiResult,
  type CanvasAiUpdateOperation,
  type CanvasAiWireRole,
} from '../../../shared/canvas-ai'
import { REFERENCE_MODES } from '../../../shared/generation/references'
import {
  isNaiSampler,
  isNaiVersion,
  type NaiVersion,
  type UcPreset,
} from '../../../shared/generation/types'
import type { AiCharacter } from '../../../shared/prompts/types'
import type { ChatInputMessage, ChatPart, ToolDef } from '../../providers/chat/client'
import { imagePath } from '../images/access'
import { getSettings } from '../settings/service'
import { composeSkills } from '../skills/service'
import { chat } from './chat'
import { TAG_TOOL_DEFS, tagTool } from './tag-tools'
import { ReadOnlyToolSession } from './tool-session'

const MAX_ROUNDS = 6
const MAX_EXPLICIT_SKILLS = 6
const MAX_PREVIEW_PX = 960
const VALID_OP_KINDS = new Set(['generate', 'inpaint', 'outpaint', 'enhance', 'upscale'] as const)
const VALID_WIRE_ROLES = new Set<CanvasAiWireRole>(['img2img', 'precise', 'vibe', 'source'])
const VALID_REF_MODES = new Set<CanvasAiReferenceMode>(REFERENCE_MODES)
const VALID_QUALITY_MODES = new Set<CanvasAiQualityMode>(['standard', 'light'])
const VALID_UC_PRESETS = new Set<UcPreset>(['heavy', 'light', 'human', 'none'])

type EditableKind = 'generate' | 'inpaint' | 'outpaint' | 'enhance' | 'upscale'

const EDIT_CANVAS_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'edit_canvas',
    description:
      '对当前无限画布执行结构化编辑：新建操作盒子、修改已有盒子的提示词或参数、连接或断开图片与盒子的工作流连线、删除指定盒子。可在一次调用中完成整套工作流搭建。',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '向用户简洁概括本次对画布所做的修改或新建的工作流。',
        },
        createOperations: {
          type: 'array',
          description: '新建的操作盒子列表（按工作流顺序排列，支持用 tempId 供后续连线引用）',
          items: {
            type: 'object',
            properties: {
              tempId: {
                type: 'string',
                description: '本轮新建盒子的临时标识，供 connectWires 或 afterTempId 引用',
              },
              kind: {
                type: 'string',
                enum: ['generate', 'inpaint', 'outpaint', 'enhance', 'upscale'],
                description:
                  '盒子类型：generate（统一生图，连底图即图生图）、inpaint、outpaint、enhance、upscale',
              },
              sourceImageId: { type: 'number', description: '绑定为底图/图生图源图的画布图片 ID' },
              afterTempId: {
                type: 'string',
                description: '排在同批哪个 tempId 盒子的右侧，用于工作流横向串联排版',
              },
              base: { type: 'string', description: '主提示词（英文 Danbooru tag / NAI 自然语言）' },
              negative: { type: 'string', description: '负面提示词（UC）' },
              characters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    prompt: { type: 'string' },
                    negative: { type: 'string' },
                    position: { type: 'string' },
                  },
                  required: ['prompt'],
                },
              },
              version: { type: 'string', enum: ['v4.5', 'v5'] },
              width: { type: 'number' },
              height: { type: 'number' },
              steps: { type: 'number' },
              guidance: { type: 'number' },
              sampler: { type: 'string' },
              seed: { type: ['number', 'null'] },
              count: { type: 'number', description: '生成张数 1–4' },
              qualityTags: { type: 'boolean' },
              qualityMode: { type: 'string', enum: ['standard', 'light'] },
              ucPreset: { type: 'string', enum: ['heavy', 'light', 'human', 'none'] },
              strength: { type: 'number', description: '修改强度 0.01–0.99（图生图/重绘/增强）' },
              noise: { type: 'number', description: '噪声 0–0.99（图生图/增强）' },
              scale: { type: 'number', enum: [1, 1.5], description: '增强放大倍率（仅 enhance）' },
              margins: {
                type: 'object',
                description: '扩图四边像素（64 的倍数，仅 outpaint）',
                properties: {
                  left: { type: 'number' },
                  right: { type: 'number' },
                  top: { type: 'number' },
                  bottom: { type: 'number' },
                },
              },
              preciseReferences: {
                type: 'array',
                description: '精确参考连线（仅 generate）',
                items: {
                  type: 'object',
                  properties: {
                    imageId: { type: 'number' },
                    mode: {
                      type: 'string',
                      enum: ['character', 'style', 'character&style', 'costume'],
                    },
                    strength: { type: 'number' },
                    fidelity: { type: 'number' },
                  },
                  required: ['imageId'],
                },
              },
              vibeReferences: {
                type: 'array',
                description: 'Vibe Transfer 连线（仅 generate 且 version=v4.5，与精确参考互斥）',
                items: {
                  type: 'object',
                  properties: {
                    imageId: { type: 'number' },
                    strength: { type: 'number' },
                    information: { type: 'number' },
                  },
                  required: ['imageId'],
                },
              },
            },
            required: ['kind'],
          },
        },
        updateOperations: {
          type: 'array',
          description: '更新画布上已有的操作盒子，只填需要修改的字段',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: '画布上已有操作盒子的数字 ID' },
              kind: {
                type: 'string',
                enum: ['generate', 'inpaint', 'outpaint', 'enhance', 'upscale'],
              },
              sourceImageId: {
                type: ['number', 'null'],
                description: '绑定底图图片 ID，传 null 表示解除底图',
              },
              base: { type: 'string' },
              negative: { type: 'string' },
              characters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    prompt: { type: 'string' },
                    negative: { type: 'string' },
                    position: { type: 'string' },
                  },
                  required: ['prompt'],
                },
              },
              version: { type: 'string', enum: ['v4.5', 'v5'] },
              width: { type: 'number' },
              height: { type: 'number' },
              steps: { type: 'number' },
              guidance: { type: 'number' },
              sampler: { type: 'string' },
              seed: { type: ['number', 'null'] },
              count: { type: 'number', description: '生成张数 1–4' },
              qualityTags: { type: 'boolean' },
              qualityMode: { type: 'string', enum: ['standard', 'light'] },
              ucPreset: { type: 'string', enum: ['heavy', 'light', 'human', 'none'] },
              strength: { type: 'number' },
              noise: { type: 'number' },
              scale: { type: 'number', enum: [1, 1.5] },
              margins: {
                type: 'object',
                properties: {
                  left: { type: 'number' },
                  right: { type: 'number' },
                  top: { type: 'number' },
                  bottom: { type: 'number' },
                },
              },
            },
            required: ['id'],
          },
        },
        connectWires: {
          type: 'array',
          description: '将画布图片连线到已有盒子或本轮新建盒子',
          items: {
            type: 'object',
            properties: {
              imageId: { type: 'number' },
              operationId: { type: 'number' },
              operationTempId: { type: 'string' },
              role: { type: 'string', enum: ['img2img', 'precise', 'vibe', 'source'] },
              strength: { type: 'number' },
              noise: { type: 'number' },
              mode: { type: 'string', enum: ['character', 'style', 'character&style'] },
              fidelity: { type: 'number' },
              information: { type: 'number' },
            },
            required: ['imageId', 'role'],
          },
        },
        disconnectWires: {
          type: 'array',
          description: '断开已有的图片与盒子连线',
          items: {
            type: 'object',
            properties: {
              imageId: { type: 'number' },
              operationId: { type: 'number' },
              role: { type: 'string', enum: ['img2img', 'precise', 'vibe', 'source'] },
            },
            required: ['imageId', 'operationId', 'role'],
          },
        },
        removeOperationIds: {
          type: 'array',
          description: '仅在用户明确要求删除时传入要移除的操作盒子 ID',
          items: { type: 'number' },
        },
      },
      additionalProperties: false,
    },
  },
}

const READ_ONLY_TOOL_NAMES = new Set(TAG_TOOL_DEFS.map((tool) => tool.function.name))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseCharacters(raw: unknown): AiCharacter[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined
  }
  const result: AiCharacter[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.prompt !== 'string') {
      continue
    }
    const prompt = item.prompt.trim()
    if (!prompt) {
      continue
    }
    result.push({
      prompt,
      negative: typeof item.negative === 'string' ? item.negative.trim() : '',
      position: typeof item.position === 'string' ? item.position.trim() : '',
    })
  }
  return result
}

function parseMargins(raw: unknown): CanvasAiCreateOperation['margins'] {
  if (!isRecord(raw)) {
    return undefined
  }
  const margins: Partial<{ left: number; right: number; top: number; bottom: number }> = {}
  for (const key of ['left', 'right', 'top', 'bottom'] as const) {
    const num = toFiniteNumber(raw[key])
    if (num !== undefined) {
      margins[key] = clamp(Math.round(num / 64) * 64, 0, 1024)
    }
  }
  return Object.keys(margins).length ? margins : undefined
}

function parseCommonFields(raw: Record<string, unknown>) {
  const version: NaiVersion | undefined = isNaiVersion(raw.version) ? raw.version : undefined
  const width = toFiniteNumber(raw.width)
  const height = toFiniteNumber(raw.height)
  const steps = toFiniteNumber(raw.steps)
  const guidance = toFiniteNumber(raw.guidance)
  const count = toFiniteNumber(raw.count)
  const strength = toFiniteNumber(raw.strength)
  const noise = toFiniteNumber(raw.noise)
  const seed = raw.seed === null ? null : toFiniteNumber(raw.seed)
  const scale: 1 | 1.5 | undefined = raw.scale === 1 || raw.scale === 1.5 ? raw.scale : undefined
  const sampler = isNaiSampler(raw.sampler) ? raw.sampler : undefined
  const qualityMode =
    typeof raw.qualityMode === 'string' &&
    VALID_QUALITY_MODES.has(raw.qualityMode as CanvasAiQualityMode)
      ? (raw.qualityMode as CanvasAiQualityMode)
      : undefined
  const ucPreset =
    typeof raw.ucPreset === 'string' && VALID_UC_PRESETS.has(raw.ucPreset as UcPreset)
      ? (raw.ucPreset as UcPreset)
      : undefined
  let normalizedSeed: number | null | undefined
  if (seed === null) {
    normalizedSeed = null
  } else if (seed !== undefined) {
    normalizedSeed = Math.max(0, Math.floor(seed))
  }
  return {
    base: typeof raw.base === 'string' ? raw.base : undefined,
    negative: typeof raw.negative === 'string' ? raw.negative : undefined,
    characters: parseCharacters(raw.characters),
    version,
    width: width !== undefined ? clamp(Math.round(width / 64) * 64, 64, 2048) : undefined,
    height: height !== undefined ? clamp(Math.round(height / 64) * 64, 64, 2048) : undefined,
    steps: steps !== undefined ? clamp(Math.round(steps), 1, 50) : undefined,
    guidance: guidance !== undefined ? clamp(Number(guidance.toFixed(1)), 0, 15) : undefined,
    sampler,
    seed: normalizedSeed,
    count: count !== undefined ? clamp(Math.round(count), 1, 4) : undefined,
    qualityTags: typeof raw.qualityTags === 'boolean' ? raw.qualityTags : undefined,
    qualityMode,
    ucPreset,
    strength: strength !== undefined ? clamp(Number(strength.toFixed(2)), 0.01, 0.99) : undefined,
    noise: noise !== undefined ? clamp(Number(noise.toFixed(2)), 0, 0.99) : undefined,
    scale,
    margins: parseMargins(raw.margins),
  }
}

function parseCanvasEdit(
  raw: unknown,
  validImageIds: Set<number>,
  validOperationIds: Set<number>,
): { message: string; edit: CanvasAiEdit } {
  if (!isRecord(raw)) {
    throw new Error('edit_canvas 参数必须是 JSON 对象')
  }
  const message = typeof raw.message === 'string' ? raw.message.trim() : ''
  const tempIds = new Set<string>()
  const createOperations: CanvasAiCreateOperation[] = []
  if (Array.isArray(raw.createOperations)) {
    for (const item of raw.createOperations) {
      if (!isRecord(item) || typeof item.kind !== 'string') {
        continue
      }
      if (!VALID_OP_KINDS.has(item.kind as EditableKind)) {
        continue
      }
      const tempId =
        typeof item.tempId === 'string' && item.tempId.trim() ? item.tempId.trim() : undefined
      if (tempId) {
        tempIds.add(tempId)
      }
      const sourceImageId = toFiniteNumber(item.sourceImageId)
      const preciseReferences = Array.isArray(item.preciseReferences)
        ? item.preciseReferences.flatMap((entry) => {
            if (!isRecord(entry)) {
              return []
            }
            const imageId = toFiniteNumber(entry.imageId)
            if (imageId === undefined || !validImageIds.has(imageId)) {
              return []
            }
            const mode =
              typeof entry.mode === 'string' &&
              VALID_REF_MODES.has(entry.mode as CanvasAiReferenceMode)
                ? (entry.mode as CanvasAiReferenceMode)
                : undefined
            const strength = toFiniteNumber(entry.strength)
            const fidelity = toFiniteNumber(entry.fidelity)
            return [
              {
                imageId,
                mode,
                strength:
                  strength !== undefined ? clamp(Number(strength.toFixed(2)), 0.05, 1) : undefined,
                fidelity:
                  fidelity !== undefined ? clamp(Number(fidelity.toFixed(2)), 0.05, 1) : undefined,
              },
            ]
          })
        : undefined
      const vibeReferences = Array.isArray(item.vibeReferences)
        ? item.vibeReferences.flatMap((entry) => {
            if (!isRecord(entry)) {
              return []
            }
            const imageId = toFiniteNumber(entry.imageId)
            if (imageId === undefined || !validImageIds.has(imageId)) {
              return []
            }
            const strength = toFiniteNumber(entry.strength)
            const information = toFiniteNumber(entry.information)
            return [
              {
                imageId,
                strength:
                  strength !== undefined ? clamp(Number(strength.toFixed(2)), 0.05, 1) : undefined,
                information:
                  information !== undefined
                    ? clamp(Number(information.toFixed(2)), 0.05, 1)
                    : undefined,
              },
            ]
          })
        : undefined
      createOperations.push({
        tempId,
        kind: item.kind as EditableKind,
        sourceImageId:
          sourceImageId !== undefined && validImageIds.has(sourceImageId)
            ? sourceImageId
            : undefined,
        afterTempId:
          typeof item.afterTempId === 'string' && item.afterTempId.trim()
            ? item.afterTempId.trim()
            : undefined,
        ...parseCommonFields(item),
        preciseReferences: preciseReferences?.length ? preciseReferences : undefined,
        vibeReferences: vibeReferences?.length ? vibeReferences : undefined,
      })
    }
  }

  const updateOperations: CanvasAiUpdateOperation[] = []
  if (Array.isArray(raw.updateOperations)) {
    for (const item of raw.updateOperations) {
      if (!isRecord(item)) {
        continue
      }
      const id = toFiniteNumber(item.id)
      if (id === undefined || !validOperationIds.has(id)) {
        continue
      }
      const kind =
        typeof item.kind === 'string' && VALID_OP_KINDS.has(item.kind as EditableKind)
          ? (item.kind as EditableKind)
          : undefined
      let sourceImageId: number | null | undefined
      if (item.sourceImageId === null) {
        sourceImageId = null
      } else {
        const candidate = toFiniteNumber(item.sourceImageId)
        if (candidate !== undefined && validImageIds.has(candidate)) {
          sourceImageId = candidate
        }
      }
      updateOperations.push({
        id,
        kind,
        sourceImageId,
        ...parseCommonFields(item),
      })
    }
  }

  const connectWires: CanvasAiConnectWire[] = []
  if (Array.isArray(raw.connectWires)) {
    for (const item of raw.connectWires) {
      if (!isRecord(item)) {
        continue
      }
      const imageId = toFiniteNumber(item.imageId)
      const role = item.role as CanvasAiWireRole
      if (imageId === undefined || !validImageIds.has(imageId) || !VALID_WIRE_ROLES.has(role)) {
        continue
      }
      const operationId = toFiniteNumber(item.operationId)
      const operationTempId =
        typeof item.operationTempId === 'string' && tempIds.has(item.operationTempId.trim())
          ? item.operationTempId.trim()
          : undefined
      const validOpId =
        operationId !== undefined && validOperationIds.has(operationId) ? operationId : undefined
      if (validOpId === undefined && !operationTempId) {
        continue
      }
      const strength = toFiniteNumber(item.strength)
      const noise = toFiniteNumber(item.noise)
      const fidelity = toFiniteNumber(item.fidelity)
      const information = toFiniteNumber(item.information)
      const mode =
        typeof item.mode === 'string' && VALID_REF_MODES.has(item.mode as CanvasAiReferenceMode)
          ? (item.mode as CanvasAiReferenceMode)
          : undefined
      connectWires.push({
        imageId,
        operationId: validOpId,
        operationTempId,
        role,
        strength: strength !== undefined ? clamp(Number(strength.toFixed(2)), 0.01, 1) : undefined,
        noise: noise !== undefined ? clamp(Number(noise.toFixed(2)), 0, 0.99) : undefined,
        mode,
        fidelity: fidelity !== undefined ? clamp(Number(fidelity.toFixed(2)), 0.05, 1) : undefined,
        information:
          information !== undefined ? clamp(Number(information.toFixed(2)), 0.05, 1) : undefined,
      })
    }
  }

  const disconnectWires: CanvasAiDisconnectWire[] = []
  if (Array.isArray(raw.disconnectWires)) {
    for (const item of raw.disconnectWires) {
      if (!isRecord(item)) {
        continue
      }
      const imageId = toFiniteNumber(item.imageId)
      const operationId = toFiniteNumber(item.operationId)
      const role = item.role as CanvasAiWireRole
      if (
        imageId === undefined ||
        operationId === undefined ||
        !validImageIds.has(imageId) ||
        !validOperationIds.has(operationId) ||
        !VALID_WIRE_ROLES.has(role)
      ) {
        continue
      }
      disconnectWires.push({ imageId, operationId, role })
    }
  }

  const removeOperationIds: number[] = []
  if (Array.isArray(raw.removeOperationIds)) {
    for (const entry of raw.removeOperationIds) {
      const id = toFiniteNumber(entry)
      if (id !== undefined && validOperationIds.has(id)) {
        removeOperationIds.push(id)
      }
    }
  }

  const edit: CanvasAiEdit = {}
  if (createOperations.length) {
    edit.createOperations = createOperations
  }
  if (updateOperations.length) {
    edit.updateOperations = updateOperations
  }
  if (connectWires.length) {
    edit.connectWires = connectWires
  }
  if (disconnectWires.length) {
    edit.disconnectWires = disconnectWires
  }
  if (removeOperationIds.length) {
    edit.removeOperationIds = removeOperationIds
  }
  return { message, edit }
}

function mergeEdits(edits: CanvasAiEdit[]): CanvasAiEdit | undefined {
  const merged: CanvasAiEdit = {}
  const createOperations = edits.flatMap((entry) => entry.createOperations ?? [])
  const updateOperations = edits.flatMap((entry) => entry.updateOperations ?? [])
  const connectWires = edits.flatMap((entry) => entry.connectWires ?? [])
  const disconnectWires = edits.flatMap((entry) => entry.disconnectWires ?? [])
  const removeOperationIds = [...new Set(edits.flatMap((entry) => entry.removeOperationIds ?? []))]
  if (createOperations.length) {
    merged.createOperations = createOperations
  }
  if (updateOperations.length) {
    merged.updateOperations = updateOperations
  }
  if (connectWires.length) {
    merged.connectWires = connectWires
  }
  if (disconnectWires.length) {
    merged.disconnectWires = disconnectWires
  }
  if (removeOperationIds.length) {
    merged.removeOperationIds = removeOperationIds
  }
  return Object.keys(merged).length ? merged : undefined
}

function loadImagePreview(image: CanvasAiImageSummary): { label: string; url: string } | null {
  if (image.kind !== 'gallery' || !image.galleryName) {
    return null
  }
  const filePath = imagePath(image.galleryName)
  if (!filePath) {
    return null
  }
  const native = nativeImage.createFromPath(filePath)
  if (native.isEmpty()) {
    return null
  }
  const { width, height } = native.getSize()
  const resized =
    width >= height
      ? native.resize({ width: Math.min(width, MAX_PREVIEW_PX) })
      : native.resize({ height: Math.min(height, MAX_PREVIEW_PX) })
  return {
    label: `画布图片「${image.label}」（图片 ID ${image.id}）`,
    url: `data:image/jpeg;base64,${resized.toJPEG(84).toString('base64')}`,
  }
}

function buildSystemPrompt(mode: 'chat' | 'edit', version: NaiVersion, skillText: string): string {
  const modelName = version === 'v5' ? 'NAI Diffusion V5' : 'NAI Diffusion V4.5'
  const editRules =
    mode === 'edit'
      ? `
# 画布编辑规则（协助编辑模式）
- 你可以通过调用 \`edit_canvas\` 工具直接修改画布上的盒子、提示词、参数和工作流连线，也可以从零搭建一整套多步骤工作流。
- 盒子类型（kind）：
  - \`generate\`：统一生图盒（不连底图=文生图；连接 \`sourceImageId\` 或 \`img2img\` 连线=图生图；也可通过 \`preciseReferences\` 或 \`vibeReferences\` 接入精确参考或 Vibe Transfer）。
  - \`inpaint\`：局部重绘（需绑定底图，重绘区域由用户在画布涂抹遮罩）。
  - \`outpaint\`：扩图（需绑定底图并设置 \`margins\` 四边像素，均为 64 的倍数）。
  - \`enhance\`：增强精修（需绑定底图，可调 \`strength\` / \`noise\` / \`scale\` 1 或 1.5）。
  - \`upscale\`：放大 2×（需绑定底图）。
- 修改现有盒子时使用 \`updateOperations\` 并带上其数字 \`id\`；仅传入需要更改的字段。
- 新建单个盒子或整套工作流时使用 \`createOperations\`，可以给新建盒子分配 \`tempId\`，并用 \`afterTempId\` 指定横向串联顺序，或在 \`connectWires\` 中用 \`operationTempId\` 与现有图片连线。
- 精确参考（precise）和 Vibe Transfer（vibe）互斥，且 Vibe Transfer 仅在 \`version: "v4.5"\` 下可用。
- 仅在用户明确要求删除时才使用 \`removeOperationIds\`。
- 写 NovelAI 提示词时，tag 之间用英文逗号分隔，英文自然语言短句句内不加逗号；必要时先用 \`search_tags\` / \`validate_tags\` 校验 Danbooru tag，再调用 \`edit_canvas\`。
- 如果用户只是提问或不需要改画布，直接文本回复即可，不要无故调用 \`edit_canvas\`。`
      : `
# 只读对话模式
- 当前处于「只读」模式，不可修改画布。请基于当前画布内容和用户 @ 引用的图片/盒子给出清晰分析、参数诊断、提示词建议或工作流规划，并提醒如需直接落地修改可切换左下角「协助编辑」模式。`

  return `${skillText}

---
# NovelPrompt 无限画布 AI 助手
- 你是 NovelPrompt 无限画布的协作助手，默认生图模型为 **${modelName}**。
- 用用户的语言简洁回复。你会收到当前画布的图片清单、操作盒子配置、连线关系以及用户通过 \`@\` 或选中引用的具体元素（包含对应参考图画面）。
- 涉及角色提示词时：V4.5 最多 6 条，position 填 A1–E5；V5 最多 22 条，position 填归一化坐标 \`x,y\` 或 A1–E5。
${editRules}`
}

function cleanSkillIds(input: unknown): string[] {
  const ids = new Set<string>()
  if (Array.isArray(input)) {
    for (const value of input) {
      const id = typeof value === 'string' ? value.trim() : ''
      if (/^(?:builtin:)?[\w-]{1,64}$/u.test(id)) {
        ids.add(id)
        if (ids.size === MAX_EXPLICIT_SKILLS) {
          break
        }
      }
    }
  }
  return [...ids]
}

function buildContextPayload(req: CanvasAiRequest) {
  const refSet = new Set(req.referencedIds.slice(0, MAX_CANVAS_AI_REFERENCES))
  const referencedImages = req.canvas.images.filter((image) => refSet.has(image.id))
  const referencedOperations = req.canvas.operations.filter((op) => refSet.has(op.id))
  const otherOperations = req.canvas.operations
    .filter((op) => !refSet.has(op.id))
    .map((op: CanvasAiOperationSummary) => ({
      id: op.id,
      kind: op.kind,
      sourceId: op.sourceId,
      version: op.version,
      basePreview: op.base.slice(0, 120),
      preciseCount: op.preciseReferences.length,
      vibeCount: op.vibeReferences.length,
    }))
  return {
    canvasTitle: req.canvas.title,
    mode: req.mode,
    referenced: {
      images: referencedImages,
      operations: referencedOperations,
    },
    allImages: req.canvas.images.map(({ id, label, width, height, operationId }) => ({
      id,
      label,
      width,
      height,
      operationId,
    })),
    otherOperations,
  }
}

export async function askCanvasAi(
  req: CanvasAiRequest,
  onStep?: (step: string) => void,
  signal?: AbortSignal,
): Promise<CanvasAiResult> {
  if (!req || (req.mode !== 'chat' && req.mode !== 'edit')) {
    throw new Error('无效的画布 AI 请求模式')
  }
  if (!Array.isArray(req.messages) || req.messages.at(-1)?.role !== 'user') {
    throw new Error('缺少用户消息内容')
  }
  const settings = getSettings()
  const defaultVersion: NaiVersion = settings.naiVersion === 'v5' ? 'v5' : 'v4.5'
  onStep?.('正在整理画布上下文…')

  const validImageIds = new Set(req.canvas.images.map((image) => image.id))
  const validOperationIds = new Set(req.canvas.operations.map((op) => op.id))
  const refSet = new Set(req.referencedIds.slice(0, MAX_CANVAS_AI_REFERENCES))

  // Collect images explicitly referenced or bound as source of referenced operations
  const imageIdsToView = new Set<number>()
  for (const image of req.canvas.images) {
    if (refSet.has(image.id)) {
      imageIdsToView.add(image.id)
    }
  }
  for (const op of req.canvas.operations) {
    if (refSet.has(op.id) && op.sourceId !== null && validImageIds.has(op.sourceId)) {
      imageIdsToView.add(op.sourceId)
    }
  }

  const previews: { label: string; url: string }[] = []
  for (const image of req.canvas.images) {
    if (!imageIdsToView.has(image.id) || previews.length >= MAX_CANVAS_AI_REFERENCES) {
      continue
    }
    const preview = loadImagePreview(image)
    if (preview) {
      previews.push(preview)
    }
  }

  const explicitSkillIds = cleanSkillIds(req.skillIds)
  const {
    text: skillText,
    snapshot: skillSnapshot,
    explicitSkills,
  } = composeSkills('workspace', defaultVersion, explicitSkillIds)
  let systemText = buildSystemPrompt(req.mode, defaultVersion, skillText)
  if (explicitSkills.length) {
    const names = explicitSkills.map((skill) => skill.name).join('、')
    systemText += `\n用户本轮显式指定了以下 Skill：${names}，请优先严格按照这些 Skill 的规则和流程完成本次任务。`
  }
  const contextText = `当前画布上下文（JSON）：\n${JSON.stringify(buildContextPayload(req))}`

  const contextParts: ChatPart[] = [{ type: 'text', text: contextText }]
  for (const preview of previews) {
    contextParts.push({ type: 'text', text: preview.label })
    contextParts.push({ type: 'image_url', image_url: { url: preview.url } })
  }

  const history = req.messages.slice(-24).map((entry): ChatInputMessage => ({
    role: entry.role,
    content: entry.content,
  }))
  const lastUser = history.pop()!
  const lastContent: ChatPart[] = [
    ...contextParts,
    {
      type: 'text',
      text: `用户请求：\n${typeof lastUser.content === 'string' ? lastUser.content : ''}`,
    },
  ]

  const messages: ChatInputMessage[] = [
    { role: 'system', content: systemText },
    ...history,
    {
      role: 'user',
      content: previews.length
        ? lastContent
        : `${contextText}\n\n用户请求：\n${typeof lastUser.content === 'string' ? lastUser.content : ''}`,
    },
  ]

  const tools: ToolDef[] =
    req.mode === 'edit' ? [...TAG_TOOL_DEFS, EDIT_CANVAS_TOOL] : [...TAG_TOOL_DEFS]
  const readOnlySession = new ReadOnlyToolSession(
    (name, args, toolSignal) => tagTool(name, args, toolSignal),
    READ_ONLY_TOOL_NAMES,
    24,
  )

  const collectedEdits: CanvasAiEdit[] = []
  const editMessages: string[] = []
  let finalText = ''

  for (let round = 0; round < MAX_ROUNDS; round++) {
    signal?.throwIfAborted()
    onStep?.(round === 0 ? '正在理解画布与需求…' : '正在整理工作流与回复…')
    const reply = await chat(messages, {
      tools,
      skillSnapshot,
      signal,
      onSkillRead: ({ loaded }) => {
        if (loaded > 0) {
          onStep?.(`正在参考 ${loaded} 份 Skill 规则…`)
        }
      },
    })
    const calls = reply.tool_calls ?? []
    if (!calls.length) {
      finalText = (reply.content ?? '').trim()
      break
    }

    messages.push(reply)
    const tagCalls = calls.filter((call) => READ_ONLY_TOOL_NAMES.has(call.function.name))
    const editCalls = calls.filter((call) => call.function.name === 'edit_canvas')
    const unknownCalls = calls.filter(
      (call) =>
        !READ_ONLY_TOOL_NAMES.has(call.function.name) && call.function.name !== 'edit_canvas',
    )

    if (tagCalls.length) {
      onStep?.(`正在校验 ${tagCalls.length} 组标签…`)
      const tagResults = await readOnlySession.run(tagCalls, signal)
      messages.push(...tagResults)
    }

    for (const call of editCalls) {
      if (req.mode !== 'edit') {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: '当前为只读模式，不能应用画布编辑，请直接文本回复建议。',
        })
        continue
      }
      try {
        onStep?.('正在编排画布改动…')
        const parsedArgs = JSON.parse(call.function.arguments || '{}') as unknown
        const parsed = parseCanvasEdit(parsedArgs, validImageIds, validOperationIds)
        if (Object.keys(parsed.edit).length) {
          collectedEdits.push(parsed.edit)
        }
        if (parsed.message) {
          editMessages.push(parsed.message)
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: true, applied: true }),
        })
      } catch (reason) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `edit_canvas 参数无效：${reason instanceof Error ? reason.message : String(reason)}`,
        })
      }
    }

    for (const call of unknownCalls) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: `不支持工具 ${call.function.name}`,
      })
    }

    if (editCalls.length && !tagCalls.length) {
      finalText = (reply.content ?? '').trim()
      break
    }
  }

  const mergedEdit = mergeEdits(collectedEdits)
  const combinedMessage = [...new Set([finalText, ...editMessages].filter(Boolean))].join('\n\n')

  if (mergedEdit) {
    return {
      message: combinedMessage || '已生成并应用画布改动。',
      edit: mergedEdit,
    }
  }

  if (!combinedMessage) {
    throw new Error('模型没有返回可显示的回复，请调整描述后重试。')
  }

  return { message: combinedMessage }
}
