import { regionIds, selectRegions } from '../../../shared/workspace/regions'
import { isUcPreset, isNaiSampler, isNaiNoiseSchedule } from '../../../shared/generation/types'
import { readFileSync } from 'node:fs'
import { MAX_CHARACTERS, isGridPosition, parsePosition } from '../../../shared/generation/presets'
import type { NaiGenParams, NaiVersion } from '../../../shared/generation/types'
import type { InpaintDraft } from '../../../shared/prompts/types'
import type { PageExecution } from '../../../shared/workspace/model'
import {
  pageCurrent,
  type PageEditorState,
  type PageWorkspace,
} from '../../../shared/workspace/model'
import { prepareInpaint } from '../generation/inpaint'
import { imagePath } from '../images/access'

export function checkDraft(draft: InpaintDraft, model: NaiVersion = 'v5') {
  if (
    !draft ||
    typeof draft.base !== 'string' ||
    typeof draft.negative !== 'string' ||
    !Array.isArray(draft.characters) ||
    draft.characters.length > MAX_CHARACTERS[model] ||
    [
      draft.base,
      draft.negative,
      ...draft.characters.flatMap((character) => [
        character.prompt,
        character.negative ?? '',
        character.position ?? '',
      ]),
    ].some((text) => typeof text !== 'string' || text.length > 30000)
  ) {
    throw new Error('提示词格式无效')
  }
  if (
    draft.characters.some(
      (character) =>
        character.position?.trim() &&
        (!parsePosition(character.position) ||
          (model === 'v4.5' && !isGridPosition(character.position))),
    )
  ) {
    throw new Error('角色位置格式无效')
  }
}

export function checkPageParams(parameters: NaiGenParams) {
  if (
    !parameters ||
    ![1, 2, 4].includes(parameters.count) ||
    typeof parameters.qualityTags !== 'boolean' ||
    !isUcPreset(parameters.ucPreset)
  ) {
    throw new Error('张数或提示词预设无效')
  }
  if (
    !parameters ||
    !Number.isInteger(parameters.width) ||
    !Number.isInteger(parameters.height) ||
    parameters.width < 64 ||
    parameters.height < 64 ||
    parameters.width % 64 ||
    parameters.height % 64 ||
    parameters.width * parameters.height > 4 * 1024 * 1024 ||
    !Number.isInteger(parameters.steps) ||
    parameters.steps < 1 ||
    parameters.steps > 50 ||
    !Number.isFinite(parameters.scale) ||
    parameters.scale < 0 ||
    parameters.scale > 10 ||
    (parameters.seed !== null &&
      (!Number.isInteger(parameters.seed) || parameters.seed < 0 || parameters.seed > 4294967295))
  ) {
    throw new Error('生成参数无效：尺寸需为 64 的倍数，步数为 1–50，种子留空或为有效整数')
  }
}

export function checkEditor(
  editor: PageEditorState,
  imageName: string | undefined,
  allowMissingRegions = false,
) {
  checkDraft(editor.draft)
  checkPageParams(editor.params)
  if (
    !Number.isFinite(editor.params.cfgRescale) ||
    editor.params.cfgRescale < 0 ||
    editor.params.cfgRescale > 1 ||
    !isNaiSampler(editor.params.sampler) ||
    !isNaiNoiseSchedule(editor.params.noiseSchedule)
  ) {
    throw new Error('采样器、噪声调度或引导重缩放无效')
  }
  if (
    !Array.isArray(editor.regions) ||
    editor.regions.length > 16 ||
    !Number.isFinite(editor.strength) ||
    editor.strength < 0.01 ||
    editor.strength > 1
  ) {
    throw new Error('选区或重绘强度无效')
  }
  const image = imageName ? imagePath(imageName) : null
  if (!image && editor.regions.length && !allowMissingRegions) {
    throw new Error('工作区图片不存在，不能修改遮罩；可加载历史设置后重新生成')
  }
  const ids = new Set<string>()
  for (const region of editor.regions) {
    if (
      !region.id ||
      ids.has(region.id) ||
      typeof region.mask !== 'string' ||
      region.mask.length > 8 * 1024 * 1024 ||
      typeof region.instruction !== 'string' ||
      region.instruction.length > 6000 ||
      !/^[A-Z]{2,16}$/.test(region.label) ||
      (region.target !== null &&
        (!Number.isInteger(region.target) || !editor.draft.characters[region.target]))
    ) {
      throw new Error('批注格式无效')
    }
    ids.add(region.id)
    if (region.accepted) {
      checkDraft(region.accepted)
    }
    if (image) {
      prepareInpaint(readFileSync(image), region.mask, editor.params.width, editor.params.height)
    }
  }
}

export function validateExecution(
  workspace: PageWorkspace,
  execution: PageExecution,
  allowedIds?: string[],
) {
  if (!execution || !['generate', 'inpaint'].includes(execution.kind)) {
    throw new Error('请选择执行方式')
  }
  if (execution.kind === 'generate') {
    return { kind: 'generate' as const, regionId: null }
  }
  const version = pageCurrent(workspace)
  const ids = regionIds(execution)
  const regions = selectRegions(version, ids)
  if (!version.image || !imagePath(version.image.name) || !regions.length) {
    throw new Error('局部重绘需要可读取的底图和明确的遮罩')
  }
  if (
    allowedIds &&
    (ids.length !== allowedIds.length || ids.some((id) => !allowedIds.includes(id)))
  ) {
    throw new Error('重绘方案必须包含本轮选中的全部区域，不能遗漏或加入未勾选区域')
  }
  return { kind: 'inpaint' as const, regionId: ids[0], regionIds: ids }
}
