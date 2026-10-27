import { NAI_SAMPLERS, NAI_NOISE_SCHEDULES } from '../../../../shared/generation/types'
import { existsSync, readFileSync } from 'node:fs'
import type {
  NaiGenParams,
  NaiNoiseSchedule,
  NaiSampler,
} from '../../../../shared/generation/types'
import { FREE_MAX_PIXELS, FREE_MAX_STEPS, freeCheck } from '../../../modules/generation/costs'
import { generateImages, getSubscription } from '../../../modules/generation/service'
import { imagePath, listImages } from '../../../modules/images/access'
import { readPngPrompt } from '../../../modules/prompts/png-import'
import { getSettings } from '../../../modules/settings/service'
import {
  bool,
  characters,
  json,
  num,
  PARAM_PROPS,
  PROMPT_PROPS,
  READ_ONLY,
  str,
  ucPreset,
  version,
} from '../tool-input'
import type { McpTool } from '../types'

export function createNaiSubscriptionTool(): McpTool {
  return {
    name: 'nai_subscription',
    title: 'NovelAI 余额',
    description:
      '查询 NovelAI 会员、Anlas 余额与 V5 免费额度，以及默认参数（832×1216、23 步）是否满足免费生成条件。不会生成图片。',
    inputSchema: { type: 'object', properties: { version: PROMPT_PROPS.version } },
    annotations: { readOnlyHint: true, openWorldHint: true },
    gate: () =>
      getSettings().naiToken.trim() ? null : '需要先在 NovelPrompt 设置里填写 NovelAI Token',
    run: async (argumentsRecord, signal) => {
      const sub = await getSubscription(signal)
      return json({
        subscription: sub,
        freeCheckForDefaults: freeCheck(
          { width: 832, height: 1216, steps: 23 },
          version(argumentsRecord.version),
          sub,
        ),
      })
    },
  }
}

export function createGenerateImageTool(): McpTool {
  return {
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
        sampler: {
          type: 'string',
          enum: NAI_SAMPLERS,
        },
        noise_schedule: {
          type: 'string',
          enum: NAI_NOISE_SCHEDULES,
        },
        seed: { type: 'integer', description: '种子，不填随机；多张时依次 +1' },
        count: { type: 'integer', description: '张数 1~4，默认 1' },
        confirm: { type: 'boolean', description: '必须为 true 才会真正提交生成' },
      },
      required: ['base', 'confirm'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    gate: () => {
      const settings = getSettings()
      if (!settings.mcpAllowGenerate) {
        return '需要在 NovelPrompt「设置 / 数据 → Agent 接入」中开启「允许生图」'
      }
      if (!settings.naiToken.trim()) {
        return '需要先在 NovelPrompt 设置里填写 NovelAI Token'
      }
      return null
    },
    run: async (argumentsRecord, signal, progress) => {
      if (argumentsRecord.confirm !== true) {
        throw new Error('需要传 confirm: true 才会生成图片')
      }
      const params: NaiGenParams = {
        width: Math.round(num(argumentsRecord.width, 832, 64, 2048) / 64) * 64,
        height: Math.round(num(argumentsRecord.height, 1216, 64, 2048) / 64) * 64,
        steps: Math.round(num(argumentsRecord.steps, 23, 1, 50)),
        scale: num(argumentsRecord.scale, 5, 0, 10),
        cfgRescale: num(argumentsRecord.cfg_rescale, 0, 0, 1),
        sampler: (str(argumentsRecord.sampler) || 'k_euler_ancestral') as NaiSampler,
        noiseSchedule: (str(argumentsRecord.noise_schedule) || 'native') as NaiNoiseSchedule,
        seed:
          argumentsRecord.seed === undefined ||
          argumentsRecord.seed === null ||
          argumentsRecord.seed === ''
            ? null
            : Math.round(num(argumentsRecord.seed, 0, 0, 4_294_967_295)),
        count: Math.round(num(argumentsRecord.count, 1, 1, 4)),
        qualityTags: bool(argumentsRecord.quality_tags, true),
        ucPreset: ucPreset(argumentsRecord.uc_preset),
      }
      const generationResult = await generateImages(
        {
          base: str(argumentsRecord.base),
          negative: str(argumentsRecord.negative),
          characters: characters(argumentsRecord.characters),
          params,
          version: version(argumentsRecord.version),
        },
        progress ?? (() => {}),
        () => signal.aborted,
        { freeOnly: true },
      )
      if (signal.aborted) {
        generationResult.stopped ??= '已停止，已完成的图片已保留'
      }
      return json({
        images: generationResult.images.map((img) => ({
          path: imagePath(img.name),
          name: img.name,
          storage: img.storage,
          seed: img.seed,
          width: img.width,
          height: img.height,
        })),
        anlasChange: generationResult.anlasDelta ?? '未知',
        stopped: generationResult.stopped ?? null,
      })
    },
  }
}

export function createListImagesTool(): McpTool {
  return {
    name: 'list_images',
    title: '本机图库',
    description:
      '按时间从新到旧列出图库。支持 storage 分类、query 文件名检索和 before_name 游标翻页。返回 items、hasMore、nextBeforeName。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: '默认 20' },
        storage: { type: 'string', enum: ['temporary', 'saved', 'workspace'] },
        query: { type: 'string', maxLength: 200 },
        before_name: { type: 'string' },
      },
    },
    annotations: READ_ONLY,
    run: async (argumentsRecord) => {
      const all = listImages(Number.MAX_SAFE_INTEGER).filter(
        (img) =>
          (!argumentsRecord.storage || img.storage === argumentsRecord.storage) &&
          (!argumentsRecord.query ||
            img.name.toLowerCase().includes(String(argumentsRecord.query).toLowerCase())),
      )
      const cursor =
        argumentsRecord.before_name === undefined
          ? -1
          : all.findIndex((img) => img.name === argumentsRecord.before_name)
      if (argumentsRecord.before_name !== undefined && cursor < 0) {
        throw new Error('图库游标不存在或筛选已改变，请重新读取')
      }
      const page = all.slice(cursor + 1, cursor + 1 + num(argumentsRecord.limit, 20, 1, 100))
      const hasMore = cursor + 1 + page.length < all.length
      return json({
        items: page.map((img) => ({
          path: imagePath(img.name),
          name: img.name,
          storage: img.storage,
          seed: img.seed,
          width: img.width,
          height: img.height,
          createdAt: new Date(img.createdAt).toISOString(),
        })),
        total: all.length,
        hasMore,
        nextBeforeName: hasMore ? page.at(-1)!.name : null,
      })
    },
  }
}

export function createReadImagePromptTool(): McpTool {
  return {
    name: 'read_image_prompt',
    title: '读取图片里的提示词',
    description:
      '读取 NovelAI 生成的 PNG 里保存的提示词（主提示词、角色及位置、负面、尺寸）。传图库里的 name，或任意 PNG 文件的绝对路径 path。注意：读出的是实际发送的内容，已包含质量词和 UC 预设。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, path: { type: 'string' } },
    },
    annotations: READ_ONLY,
    run: async (argumentsRecord) => {
      const path = str(argumentsRecord.name)
        ? imagePath(str(argumentsRecord.name))
        : str(argumentsRecord.path)
      if (!path || !/\.png$/i.test(path) || !existsSync(path)) {
        throw new Error('找不到这张 PNG 图片')
      }
      const importedPrompt = await readPngPrompt(readFileSync(path))
      return json({
        base: importedPrompt.base,
        characters: importedPrompt.characters,
        negative: importedPrompt.negative,
        width: importedPrompt.width,
        height: importedPrompt.height,
      })
    },
  }
}
