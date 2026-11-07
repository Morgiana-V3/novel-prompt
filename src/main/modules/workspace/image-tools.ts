import type { AnlasOutcome } from '../../../shared/generation/pricing'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { NaiImage } from '../../../shared/images/types'
import {
  pageCurrent,
  pageImageToolLabel,
  pageImageToolSize,
  type PageImageTool,
  type PageVersion,
  type PageWorkspace,
} from '../../../shared/workspace/model'
import { pngSize } from '../../providers/novelai/png-response'
import { buildOutpaintCanvas, resizeForEnhance, upscaleImage } from '../generation/image-tools'
import { generateImages } from '../generation/service'
import { imagePath } from '../images/access'
import { readImageRecipe } from '../images/library'
import { pageLocks } from './locks'
import { readPage, savePage } from './repository'
import { pageExecutionEvent } from './snapshot'
import { checkPageParams } from './validation'

export interface ImageToolOptions {
  freeOnly?: boolean
  onResult?: (result: AnlasOutcome & { stopped?: string }) => void
}

function checkTool(tool: PageImageTool): PageImageTool {
  if (tool?.kind === 'upscale') {
    return { kind: 'upscale' }
  }
  if (tool?.kind === 'outpaint') {
    return {
      kind: 'outpaint',
      left: Number(tool.left) || 0,
      right: Number(tool.right) || 0,
      top: Number(tool.top) || 0,
      bottom: Number(tool.bottom) || 0,
    }
  }
  if (tool?.kind === 'enhance') {
    if (![1, 1.5].includes(tool.scale)) {
      throw new Error('精修倍数只能是 1× 或 1.5×')
    }
    return { kind: 'enhance', scale: tool.scale, strength: tool.strength, noise: tool.noise }
  }
  throw new Error('请选择修图方式')
}

function nextGroupNumber(workspace: PageWorkspace) {
  const numbers = workspace.versions.map((version, index) => {
    return version.groupNumber ?? (version.generated ? index : 0)
  })
  return Math.max(0, ...numbers) + 1
}

/**
 * 在当前蓝本上执行修图（放大 / 扩图 / 精修）。结果作为新的候选版本保存，
 * 与普通生成一样不会自动替换蓝本；首张没有图片的蓝本除外。
 */
export async function runImageTool(
  id: string,
  revision: number,
  requestedTool: PageImageTool,
  progress: (text: string) => void,
  cancelled: () => boolean,
  options: ImageToolOptions = {},
): Promise<PageWorkspace> {
  if (pageLocks.has(id)) {
    throw new Error('当前页面正在处理')
  }
  const workspace = readPage(id)
  if (workspace.revision !== revision) {
    throw new Error('工作区状态已更新')
  }
  const tool = checkTool(requestedTool)
  const version = pageCurrent(workspace)
  const sourcePath = version.image ? imagePath(version.image.name) : null
  if (!version.image || !sourcePath) {
    throw new Error('修图需要当前蓝本有可读取的图片')
  }
  if (workspace.versions.length >= 1000) {
    throw new Error('此工作区已保留 1000 张候选，请从选定图片新建工作区')
  }
  const sourceBytes = readFileSync(sourcePath)
  pageLocks.set(id, new AbortController())
  const versionIds: string[] = []
  let outcome: (AnlasOutcome & { stopped?: string }) | undefined
  let attempted = false
  let failure: { error: unknown } | undefined
  try {
    try {
      const result = await executeTool(workspace, version, tool, sourceBytes, progress, cancelled, {
        ...options,
        onAttempt: () => {
          attempted = true
        },
        onResult: (result) => {
          outcome = result
          options.onResult?.(result)
        },
      })
      outcome = result
      if (!result.images.length) {
        throw new Error(result.stopped ?? '没有返回图片')
      }
      appendToolVersions(workspace, version, tool, result.images, versionIds)
    } catch (error) {
      failure = { error }
    }
    let errorText: string | undefined
    if (failure) {
      errorText = failure.error instanceof Error ? failure.error.message : String(failure.error)
      errorText ||= '未知执行错误'
    }
    const completion = versionIds.length
      ? `已保存 ${versionIds.length} 张候选，当前蓝本未改变。`
      : '没有保存新候选，当前蓝本未改变。'
    pageExecutionEvent(
      workspace,
      `从「${version.label}」${pageImageToolLabel(tool)}，${completion}${errorText ? `未完成：${errorText}` : ''}`,
      {
        kind: tool.kind,
        sourceVersionId: version.id,
        versionIds,
        requestedCount: tool.kind === 'upscale' ? 1 : version.editor.params.count,
        outcome,
        attempted,
        error: errorText,
      },
    )
    const saved = savePage(workspace)
    if (failure) {
      throw failure.error
    }
    return saved
  } finally {
    pageLocks.delete(id)
  }
}

async function executeTool(
  workspace: PageWorkspace,
  version: PageVersion,
  tool: PageImageTool,
  sourceBytes: Buffer,
  progress: (text: string) => void,
  cancelled: () => boolean,
  options: ImageToolOptions & { onAttempt: () => void },
): Promise<{ images: NaiImage[]; stopped?: string } & AnlasOutcome> {
  if (tool.kind === 'upscale') {
    options.onAttempt()
    const result = await upscaleImage(sourceBytes, readImageRecipe(version.image!.name), progress, {
      freeOnly: options.freeOnly,
      workspaceId: workspace.id,
      collectionId: workspace.collectionId,
    })
    options.onResult?.(result)
    return { ...result, images: [result.image] }
  }
  const draft = structuredClone(version.editor.draft)
  if (!draft.base.trim() && !draft.characters.some((character) => character.prompt.trim())) {
    throw new Error('扩图和精修需要提示词描述画面，请先在配置里填写提示词')
  }
  const sourceSize = pngSize(sourceBytes)
  if (!sourceSize) {
    throw new Error('蓝本图片不是有效 PNG')
  }
  const size = pageImageToolSize(tool, sourceSize.width, sourceSize.height)
  const params = { ...version.editor.params, ...size }
  checkPageParams(params)
  if (workspace.versions.length + params.count > 1000) {
    throw new Error('生成后将超过 1000 张候选，请减少生成张数或新建项目')
  }
  const base = { ...draft, params, version: workspace.model, collectionId: workspace.collectionId }
  const generateOptions = { freeOnly: options.freeOnly, workspaceId: workspace.id }
  let result
  if (tool.kind === 'outpaint') {
    const outpaint = buildOutpaintCanvas(sourceBytes, tool)
    options.onAttempt()
    result = await generateImages(
      {
        ...base,
        inpaint: { imageName: version.image!.name, mask: outpaint.maskBase64, strength: 1 },
      },
      progress,
      cancelled,
      { ...generateOptions, sourceBytes: outpaint.canvas },
    )
  } else {
    const resized = await resizeForEnhance(sourceBytes, size.width, size.height)
    options.onAttempt()
    result = await generateImages(
      { ...base, img2img: { strength: tool.strength, noise: tool.noise } },
      progress,
      cancelled,
      { ...generateOptions, sourceBytes: resized },
    )
  }
  if (cancelled()) {
    result.stopped ??= '已停止，已完成的图片已保留'
  }
  options.onResult?.(result)
  return result
}

function appendToolVersions(
  workspace: PageWorkspace,
  version: PageVersion,
  tool: PageImageTool,
  images: NaiImage[],
  versionIds: string[],
) {
  const groupId = randomUUID()
  const groupNumber = nextGroupNumber(workspace)
  for (const [index, image] of images.entries()) {
    const recipe = readImageRecipe(image.name)?.request
    const params = recipe?.params ?? version.editor.params
    const draft = recipe
      ? { base: recipe.base, negative: recipe.negative, characters: recipe.characters }
      : structuredClone(version.editor.draft)
    // 放大结果通常超出生成尺寸上限：下一版配置沿用原尺寸，扩图/精修沿用结果尺寸
    const editorParams =
      tool.kind === 'upscale'
        ? { ...version.editor.params }
        : { ...version.editor.params, width: params.width, height: params.height }
    const next: PageVersion = {
      id: randomUUID(),
      parentId: version.id,
      groupId,
      groupNumber,
      candidateNumber: index + 1,
      label: `方案 V${groupNumber} · 候选 ${index + 1}`,
      image,
      createdAt: Date.now(),
      generated: {
        model: workspace.model,
        draft,
        params,
        execution: { kind: 'generate', regionId: null },
        sourceVersionId: version.id,
        editor: {
          model: workspace.model,
          draft: structuredClone(version.editor.draft),
          params: { ...editorParams },
        },
        tool,
      },
      editor: {
        ...structuredClone(version.editor),
        draft: structuredClone(version.editor.draft),
        params: editorParams,
        regions: [],
      },
    }
    workspace.versions.push(next)
    versionIds.push(next.id)
    workspace.latestGeneratedVersionId = next.id
  }
}
