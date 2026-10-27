import { isUcPreset, isNaiSampler, isNaiNoiseSchedule, UC_PRESET_NAMES } from '../generation/types'
import type { NaiGenParams } from '../generation/types'
import type { InpaintDraft } from '../prompts/types'
import type { PageEditorState } from './model'

export interface WorkspaceConfigPatch {
  draft?: Partial<InpaintDraft>
  params?: Partial<NaiGenParams>
  strength?: number
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
/** Only configuration fields are writable; regions and frozen recipes have separate APIs. */
export function patchWorkspaceConfig(
  editor: PageEditorState,
  patch: WorkspaceConfigPatch,
  sizeLocked: boolean,
): PageEditorState {
  if (
    !object(patch) ||
    Object.keys(patch).some((text) => !['draft', 'params', 'strength'].includes(text))
  ) {
    throw new Error('未知配置字段')
  }
  const next: PageEditorState = JSON.parse(JSON.stringify(editor))
  if (patch.draft !== undefined) {
    if (
      !object(patch.draft) ||
      Object.keys(patch.draft).some((text) => !['base', 'negative', 'characters'].includes(text))
    ) {
      throw new Error('提示词字段无效')
    }
    for (const key of ['base', 'negative'] as const) {
      if (patch.draft[key] !== undefined) {
        if (typeof patch.draft[key] !== 'string' || patch.draft[key]!.length > 60000) {
          throw new Error('提示词过长或格式无效')
        }
        next.draft[key] = patch.draft[key]!
      }
    }
    if (patch.draft.characters !== undefined) {
      if (
        !Array.isArray(patch.draft.characters) ||
        patch.draft.characters.length > 6 ||
        patch.draft.characters.some(
          (character) =>
            !object(character) ||
            Object.keys(character).some(
              (text) => !['prompt', 'negative', 'position'].includes(text),
            ) ||
            typeof character.prompt !== 'string' ||
            typeof character.negative !== 'string' ||
            character.prompt.length > 60000 ||
            character.negative.length > 60000 ||
            (character.position !== undefined && typeof character.position !== 'string'),
        )
      ) {
        throw new Error('角色提示词格式无效')
      }
      next.draft.characters = JSON.parse(JSON.stringify(patch.draft.characters))
    }
  }
  if (patch.params !== undefined) {
    if (!object(patch.params)) {
      throw new Error('参数格式无效')
    }
    const ranges: Record<string, [number, number, number?]> = {
      width: [64, 4096, 64],
      height: [64, 4096, 64],
      steps: [1, 50, 1],
      scale: [0, 10],
      cfgRescale: [0, 1],
      seed: [0, 4294967295, 1],
    }
    for (const [field, value] of Object.entries(patch.params)) {
      if (field === 'count') {
        if (![1, 2, 4].includes(value as number)) {
          throw new Error('张数只能为 1、2 或 4')
        }
        continue
      }
      if (field === 'qualityTags') {
        if (typeof value !== 'boolean') {
          throw new Error('质量词开关无效')
        }
        continue
      }
      if (field === 'ucPreset') {
        if (!isUcPreset(value as string)) {
          throw new Error('UC 预设无效')
        }
        continue
      }
      if (
        (field === 'width' || field === 'height') &&
        sizeLocked &&
        value !== editor.params[field]
      ) {
        throw new Error('已有遮罩或正在局部重绘，尺寸不可修改')
      }
      if (field === 'seed' && (value === null || value === '')) {
        continue
      }
      if (field === 'sampler') {
        if (!isNaiSampler(String(value))) {
          throw new Error('采样器无效')
        }
      } else if (field === 'noiseSchedule') {
        if (!isNaiNoiseSchedule(String(value))) {
          throw new Error('噪声调度无效')
        }
      } else {
        const range = ranges[field]
        if (
          !range ||
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < range[0] ||
          value > range[1] ||
          (range[2] && value % range[2] !== 0)
        ) {
          throw new Error('参数无效：' + field)
        }
      }
    }
    Object.assign(next.params, patch.params)
  }
  if (patch.strength !== undefined) {
    if (
      typeof patch.strength !== 'number' ||
      !Number.isFinite(patch.strength) ||
      patch.strength < 0.01 ||
      patch.strength > 1
    ) {
      throw new Error('重绘强度无效')
    }
    next.strength = patch.strength
  }
  return next
}

/** Shared MCP schema for the same configuration form and background patch. */
export const WORKSPACE_CONFIG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    draft: {
      type: 'object',
      additionalProperties: false,
      properties: {
        base: { type: 'string' },
        negative: { type: 'string' },
        characters: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              negative: { type: 'string' },
              position: { type: 'string' },
            },
            required: ['prompt', 'negative'],
            additionalProperties: false,
          },
        },
      },
    },
    params: {
      type: 'object',
      additionalProperties: false,
      properties: {
        count: { type: 'integer', enum: [1, 2, 4] },
        qualityTags: { type: 'boolean' },
        ucPreset: { type: 'string', enum: UC_PRESET_NAMES },
        width: { type: 'integer' },
        height: { type: 'integer' },
        steps: { type: 'integer' },
        scale: { type: 'number' },
        seed: { type: ['integer', 'null'] },
        cfgRescale: { type: 'number' },
        sampler: { type: 'string' },
        noiseSchedule: { type: 'string' },
      },
    },
    strength: { type: 'number' },
  },
}
