import { readFileSync } from 'node:fs'
import { regionIds, regionNotes, selectRegions } from '../../../shared/workspace/regions'
import { imagePath } from '../images/access'
import { mergeRegionMasks } from './region-mask'
import { createHash, randomUUID } from 'node:crypto'
import type { PageExecution } from '../../../shared/workspace/model'
import { pageCurrent, pageDraft, type PageWorkspace } from '../../../shared/workspace/model'
import { generateImages } from '../generation/service'
import { readImageRecipe } from '../images/library'
import { pageLocks } from './locks'
import { readPage, savePage } from './repository'
import { pageEvent } from './snapshot'
import { checkPageParams, validateExecution } from './validation'

export async function renderPage(
  id: string,
  revision: number,
  execution: PageExecution,
  progress: (text: string) => void,
  cancelled: () => boolean,
  options: { freeOnly?: boolean; onResult?: (result: { stopped?: string }) => void } = {},
): Promise<PageWorkspace> {
  if (pageLocks.has(id)) {
    throw new Error('当前页面正在处理')
  }
  const workspace = readPage(id)
  const version = pageCurrent(workspace)
  if (workspace.revision !== revision) {
    throw new Error('工作区状态已更新')
  }
  if (workspace.versions.length >= 1000) {
    throw new Error('此工作区已保留 1000 张候选，请从选定图片新建工作区')
  }
  const selectedExecution = validateExecution(workspace, execution)
  const regions = selectRegions(version, regionIds(selectedExecution))
  const regionLabel = regions.map((region) => region.label).join('、')
  const instruction =
    regions.length === 1
      ? regions[0].instruction
      : regions.map((region) => `${region.label}：${region.instruction}`).join('\n')
  const mask = regions.length
    ? mergeRegionMasks(
        readFileSync(imagePath(version.image!.name)!),
        regions,
        version.editor.params.width,
        version.editor.params.height,
      )
    : ''
  pageLocks.set(id, new AbortController())
  try {
    const draft = structuredClone(pageDraft(version, null))
    if (!draft.base.trim() && !draft.characters.some((character) => character.prompt.trim())) {
      throw new Error('请先填写提示词，或让 AI 提出修改并采纳后再重绘')
    }
    const params = { ...version.editor.params }
    checkPageParams(params)
    if (workspace.versions.length + params.count > 1000) {
      throw new Error('生成后将超过 1000 张候选，请减少生成张数或新建项目')
    }
    const request = {
      ...draft,
      params,
      version: workspace.model,
      ...(selectedExecution.kind === 'inpaint'
        ? {
            inpaint: {
              imageName: version.image!.name,
              mask,
              strength: version.editor.strength,
            },
          }
        : {}),
    }
    const effectiveParams = {
      ...params,
      noiseSchedule:
        selectedExecution.kind === 'inpaint' &&
        (workspace.model === 'v5' || params.noiseSchedule === 'native')
          ? ('karras' as const)
          : params.noiseSchedule,
    }
    const schemeKey = createHash('sha256')
      .update(JSON.stringify({ ...request, params: { ...effectiveParams, seed: null, count: 1 } }))
      .digest('hex')
    const latest = workspace.versions.at(-1)
    const same =
      latest?.schemeKey === schemeKey &&
      (latest.parentId === version.id || latest.groupId === version.groupId)
    const groupId = same ? latest!.groupId! : randomUUID()
    const resolveGroupNumber = () => {
      if (same) {
        return latest!.groupNumber!
      }
      return (
        Math.max(
          0,
          ...workspace.versions.map(
            (version2, i) => version2.groupNumber ?? (version2.generated ? i : 0),
          ),
        ) + 1
      )
    }
    const groupNumber = resolveGroupNumber()
    const candidateNumber = same ? (latest!.candidateNumber ?? 1) + 1 : 1
    const result = await generateImages(request, progress, cancelled, {
      ...options,
      workspaceId: id,
    })
    if (cancelled()) {
      result.stopped ??= '已停止，已完成的图片已保留'
    }
    options.onResult?.(result)
    if (!result.images.length) {
      throw new Error(result.stopped ?? '没有返回图片')
    }
    for (const [index, image] of result.images.entries()) {
      const actual = readImageRecipe(image.name)!.request
      const number = candidateNumber + index
      const next = {
        id: randomUUID(),
        parentId: version.id,
        groupId,
        groupNumber,
        candidateNumber: number,
        schemeKey,
        label: `方案 V${groupNumber} · 候选 ${number}`,
        image,
        createdAt: Date.now(),
        generated: {
          model: workspace.model,
          draft: { base: actual.base, negative: actual.negative, characters: actual.characters },
          params: actual.params,
          execution: selectedExecution,
          sourceVersionId: version.id,
          ...(selectedExecution.kind === 'inpaint'
            ? {
                inpaint: {
                  mask,
                  strength: version.editor.strength,
                  label: regionLabel,
                  instruction,
                  regions: regionNotes(regions),
                  target: regions.length === 1 ? regions[0].target : null,
                },
              }
            : {}),
        },
        editor: {
          ...structuredClone(version.editor),
          draft,
          regions:
            selectedExecution.kind === 'inpaint'
              ? version.editor.regions.map((region2) => ({ ...region2, accepted: null }))
              : [],
        },
      }
      workspace.versions.push(next)
      workspace.latestGeneratedVersionId = next.id
      workspace.execution = selectedExecution
      const first = !version.image && index === 0
      if (first) {
        workspace.currentVersionId = next.id
      }
      pageEvent(
        workspace,
        `从「${version.label}」${regions.length ? `局部重绘 ${regionLabel}` : '按提示词生成'}，得到「${next.label}」。${first ? '首张结果已设为创作蓝本。' : '已保存，当前蓝本未改变。'}`,
        next.id,
      )
    }
    if (result.stopped) {
      pageEvent(workspace, result.stopped, workspace.latestGeneratedVersionId)
    }
    return savePage(workspace)
  } catch (error) {
    pageEvent(
      workspace,
      `本次重绘未完成：${error instanceof Error ? error.message : String(error)}。当前版本未替换。`,
    )
    savePage(workspace)
    throw error
  } finally {
    pageLocks.delete(id)
  }
}
