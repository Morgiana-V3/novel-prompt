import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute } from 'node:path'
import { reverseModels } from '../../../../shared/reverse/types'
import type { SavedRecipe } from '../../../../shared/images/types'
import { imagePath } from '../../../modules/images/access'
import {
  createRecipe,
  deleteRecipe,
  favoriteImagePath,
  listRecipes,
  updateRecipe,
} from '../../../modules/images/recipes'
import { deleteSnippet, listSnippets, saveSnippet } from '../../../modules/prompts/snippets'
import { reverseRuntime } from '../../../modules/reverse/runtime'
import { json, num, READ_ONLY, str } from '../tool-input'
import type { McpTool } from '../types'

/** 收藏、提示词片段与本地图片反推：和界面共用同一份数据与识别实例 */

const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const DELETE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
const FAVORITE_ID = { type: 'string', description: 'list_favorites 返回的收藏 id' }

function favorite(id: unknown): SavedRecipe {
  const item = listRecipes().find((recipe) => recipe.id === id)
  if (!item) {
    throw new Error('收藏不存在，请重新调用 list_favorites')
  }
  return item
}

function summary(item: SavedRecipe) {
  const { request } = item.recipe
  return {
    id: item.id,
    name: item.name,
    note: item.note,
    tags: item.tags,
    createdAt: new Date(item.createdAt).toISOString(),
    version: request.version,
    size: `${request.params.width}×${request.params.height}`,
    seed: request.params.seed,
    base: request.base.length > 200 ? `${request.base.slice(0, 200)}…` : request.base,
    characters: request.characters.length,
    hasImage: !!favoriteImagePath(item.id),
  }
}

function tags(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.some((text) => typeof text !== 'string')) {
    throw new Error('tags 须为字符串数组')
  }
  return value as string[]
}

function favoriteTools(): McpTool[] {
  return [
    {
      name: 'list_favorites',
      title: '查看收藏',
      description:
        '列出用户收藏的图片与生图配方（按收藏时间从新到旧）。query 匹配名称、备注、标签与主提示词，tag 只看某个标签。返回摘要；完整提示词与参数用 get_favorite。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 200 },
          tag: { type: 'string', maxLength: 60 },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: '默认 20' },
        },
      },
      annotations: READ_ONLY,
      run: async (argumentsRecord) => {
        const query = str(argumentsRecord.query).trim().toLowerCase()
        const tag = str(argumentsRecord.tag).trim()
        const all = listRecipes().filter(
          (item) =>
            (!tag || item.tags.includes(tag)) &&
            (!query ||
              [item.name, item.note, item.tags.join(' '), item.recipe.request.base]
                .join('\n')
                .toLowerCase()
                .includes(query)),
        )
        const limit = num(argumentsRecord.limit, 20, 1, 100)
        return json({
          items: all.slice(0, limit).map(summary),
          total: all.length,
          tags: [...new Set(listRecipes().flatMap((item) => item.tags))].sort(),
        })
      },
    },
    {
      name: 'get_favorite',
      title: '读取收藏配方',
      description:
        '读取一条收藏的完整生成配置（提示词、角色、负面、模型与全部参数）及收藏原图路径。可把 request 交给 generate_image 复用，或用 apply_app_prompt 写入界面标签。局部重绘收藏的 request 是重绘修改提示词，baseRequest 是它所基于的整图配方（缺失时为 null），复用整图请用 baseRequest。',
      inputSchema: { type: 'object', properties: { id: FAVORITE_ID }, required: ['id'] },
      annotations: READ_ONLY,
      run: async (argumentsRecord) => {
        const item = favorite(argumentsRecord.id)
        return json({
          ...summary(item),
          sourceKind: item.recipe.sourceKind,
          request: item.recipe.request,
          baseRequest: item.recipe.base ?? null,
          imagePath: favoriteImagePath(item.id),
          sourceImage: item.sourceImage || null,
        })
      },
    },
    {
      name: 'save_favorite',
      title: '收藏图片',
      description:
        '把图库中的图片连同完整生成记录收藏到「收藏管理」，可同时设置名称、备注与标签。只支持带生成记录的图片（软件生成的图片都带有）；来源图片不受影响。',
      inputSchema: {
        type: 'object',
        properties: {
          image_name: { type: 'string', description: 'list_images 返回的图库文件名' },
          name: { type: 'string', maxLength: 100 },
          note: { type: 'string', maxLength: 6000 },
          tags: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 20 },
        },
        required: ['image_name'],
      },
      annotations: WRITE,
      run: async (argumentsRecord) => {
        if (!imagePath(str(argumentsRecord.image_name))) {
          throw new Error('图库中没有这张图片')
        }
        let item = createRecipe(str(argumentsRecord.image_name))
        const nextTags = tags(argumentsRecord.tags)
        if (argumentsRecord.name !== undefined || argumentsRecord.note !== undefined || nextTags) {
          item = updateRecipe(item.id, {
            name: str(argumentsRecord.name).trim() || item.name,
            note: argumentsRecord.note === undefined ? item.note : str(argumentsRecord.note),
            tags: nextTags ?? item.tags,
          })
        }
        return json({ outcome: 'saved', favorite: summary(item) })
      },
    },
    {
      name: 'update_favorite',
      title: '修改收藏信息',
      description: '修改收藏的名称、备注或标签；未提供的字段保持不变。不改动图片与生成配置。',
      inputSchema: {
        type: 'object',
        properties: {
          id: FAVORITE_ID,
          name: { type: 'string', maxLength: 100 },
          note: { type: 'string', maxLength: 6000 },
          tags: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 20 },
        },
        required: ['id'],
      },
      annotations: { ...WRITE, idempotentHint: true },
      run: async (argumentsRecord) => {
        const item = favorite(argumentsRecord.id)
        const updated = updateRecipe(item.id, {
          name: argumentsRecord.name === undefined ? item.name : str(argumentsRecord.name),
          note: argumentsRecord.note === undefined ? item.note : str(argumentsRecord.note),
          tags: tags(argumentsRecord.tags) ?? item.tags,
        })
        return json({ outcome: 'updated', favorite: summary(updated) })
      },
    },
    {
      name: 'delete_favorite',
      title: '取消收藏',
      description:
        '删除一条收藏及其收藏副本。图库中的来源图片和同组其他收藏保留。不可撤销，须先征得用户同意。',
      inputSchema: { type: 'object', properties: { id: FAVORITE_ID }, required: ['id'] },
      annotations: DELETE,
      run: async (argumentsRecord) => {
        const item = favorite(argumentsRecord.id)
        deleteRecipe(item.id)
        return json({ outcome: 'deleted', id: item.id, name: item.name })
      },
    },
  ]
}

function snippetTools(): McpTool[] {
  return [
    {
      name: 'list_snippets',
      title: '查看提示词片段',
      description:
        '列出用户保存的提示词片段（常用画风、构图、角色设定等，可直接插入提示词）。query 匹配名称与正文，category 只看某个分类。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 200 },
          category: { type: 'string', maxLength: 80 },
        },
      },
      annotations: READ_ONLY,
      run: async (argumentsRecord) => {
        const query = str(argumentsRecord.query).trim().toLowerCase()
        const category = str(argumentsRecord.category).trim()
        const all = listSnippets()
        return json({
          items: all.filter(
            (item) =>
              (!category || item.category === category) &&
              (!query || `${item.name}\n${item.text}`.toLowerCase().includes(query)),
          ),
          categories: [...new Set(all.map((item) => item.category).filter(Boolean))].sort(),
        })
      },
    },
    {
      name: 'save_snippet',
      title: '保存提示词片段',
      description:
        '新建或修改提示词片段。提供 id 时修改该片段，省略时新建。修改会覆盖原正文，修改用户已有片段前须先征得同意。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要修改的片段 id；省略时新建' },
          name: { type: 'string', maxLength: 120 },
          text: { type: 'string', maxLength: 100000 },
          category: { type: 'string', maxLength: 80, description: '分类，可留空' },
        },
        required: ['name', 'text'],
      },
      annotations: WRITE,
      run: async (argumentsRecord) => {
        const snippet = saveSnippet({
          ...(argumentsRecord.id ? { id: str(argumentsRecord.id) } : {}),
          name: str(argumentsRecord.name),
          text: str(argumentsRecord.text),
          category: str(argumentsRecord.category),
        })
        return json({ outcome: argumentsRecord.id ? 'updated' : 'created', snippet })
      },
    },
    {
      name: 'delete_snippet',
      title: '删除提示词片段',
      description: '删除一条提示词片段。不可撤销，须先征得用户同意。',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'list_snippets 返回的片段 id' } },
        required: ['id'],
      },
      annotations: DELETE,
      run: async (argumentsRecord) => {
        const item = listSnippets().find((snippet) => snippet.id === argumentsRecord.id)
        if (!item) {
          throw new Error('片段不存在，请重新调用 list_snippets')
        }
        deleteSnippet(item.id)
        return json({ outcome: 'deleted', id: item.id, name: item.name })
      },
    },
  ]
}

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i
const MAX_BYTES = 25 * 1024 * 1024

function reverseSource(argumentsRecord: Record<string, unknown>): Uint8Array {
  const name = str(argumentsRecord.image_name)
  const path = str(argumentsRecord.path)
  if (!!name === !!path) {
    throw new Error('image_name 与 path 二选一')
  }
  const file = name ? imagePath(name) : path
  if (!file) {
    throw new Error('图库中没有这张图片')
  }
  if (path && (!isAbsolute(path) || !IMAGE_FILE.test(extname(path)) || !existsSync(path))) {
    throw new Error('path 须为本机已存在的 PNG / JPG / WebP 绝对路径')
  }
  if (statSync(file).size > MAX_BYTES) {
    throw new Error('图片不能超过 25 MB')
  }
  return new Uint8Array(readFileSync(file))
}

function reverseTools(): McpTool[] {
  return [
    {
      name: 'reverse_image',
      title: '图片反推',
      description:
        '用本机的识图模型反推图片：基础标签（WD）、角色候选，以及 Kaloscope 2 / 3 的画师风格候选，全部在本地运行，不消耗 AI 或 NovelAI 额度。模型需先在「图片反推」页下载。画师候选用于辅助选择画风，不代表原作者判定。与界面共用识别进程，界面正在识别时需等待。',
      inputSchema: {
        type: 'object',
        properties: {
          image_name: { type: 'string', description: 'list_images 返回的图库文件名' },
          path: {
            type: 'string',
            description: '本机图片绝对路径（PNG / JPG / WebP，≤25 MB），与 image_name 二选一',
          },
          models: {
            type: 'array',
            items: { type: 'string', enum: ['k2', 'k3', 'wd', 'pixai'] },
            minItems: 1,
            uniqueItems: true,
            description: '默认 k2、k3、wd；pixai 为可选角色模型',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 200,
            description: '每类最多返回的候选数，默认 60',
          },
        },
      },
      annotations: { ...READ_ONLY, idempotentHint: true },
      run: async (argumentsRecord, signal, progress) => {
        const bytes = reverseSource(argumentsRecord)
        const models = reverseModels(argumentsRecord.models)
        const runtime = reverseRuntime()
        const stop = () => runtime.cancel()
        signal.addEventListener('abort', stop, { once: true })
        try {
          const result = await runtime.analyze(bytes, models, (message) => progress?.(message))
          const limit = num(argumentsRecord.limit, 60, 1, 200)
          return json({
            tags: result.tags.slice(0, limit),
            characters: result.characters.slice(0, limit),
            characterModel: result.characterModel ?? null,
            artists: result.artists.map((group) => ({
              model: group.model,
              tags: group.tags.slice(0, limit),
            })),
            seconds: result.seconds,
            warnings: result.warnings,
          })
        } finally {
          signal.removeEventListener('abort', stop)
        }
      },
    },
  ]
}

export function libraryTools(): McpTool[] {
  return [...favoriteTools(), ...snippetTools(), ...reverseTools()]
}
