import { isNaiVersion } from '../../../shared/generation/types'
import { pageCurrent, type PageAction, type PageWorkspace } from '../../../shared/workspace/model'
import { clone, pageEvent, pageMessage } from './snapshot'
import { checkDraft, checkEditor, checkPageParams, validateExecution } from './validation'

export function applyRecipe(
  workspace: PageWorkspace,
  action: Extract<PageAction, { type: 'recipe' }>,
): void {
  const version = pageCurrent(workspace)

  const request = clone(action.request)
  if (!isNaiVersion(request.version)) {
    throw new Error('不支持的模型')
  }
  checkDraft(request, request.version)
  checkPageParams(request.params)
  workspace.model = request.version
  version.editor.model = request.version
  version.editor.draft = {
    base: request.base,
    negative: request.negative,
    characters: request.characters,
  }
  version.editor.params = { ...request.params, count: 1 }
  version.editor.regions = []
  workspace.execution = { kind: 'generate', regionId: null }
  pageEvent(workspace, '已加载收藏配方，替换提示词、模型和生成设置，清除旧选区；尚未生成图片。')
}

export function applyNotes(
  workspace: PageWorkspace,
  action: Extract<PageAction, { type: 'notes' }>,
): void {
  for (const text of [action.title, action.goal, action.preserve, action.composer]) {
    if (typeof text !== 'string' || text.length > 6000) {
      throw new Error('文本过长')
    }
  }
  workspace.title = action.title.trim().slice(0, 100) || '未命名项目'
  workspace.goal = action.goal
  workspace.preserve = action.preserve
  workspace.composer = action.composer
}

export function applyEditor(
  workspace: PageWorkspace,
  action: Extract<PageAction, { type: 'editor' }>,
): void {
  const version = pageCurrent(workspace)

  if (action.versionId !== version.id) {
    throw new Error('编辑器对应的版本已切换')
  }
  const updated = clone(action.editor)
  if (updated.draft.characters.length !== version.editor.draft.characters.length) {
    updated.regions.forEach((region) => {
      region.target = null
    })
  }
  const unchangedMasks =
    updated.params.width === version.editor.params.width &&
    updated.params.height === version.editor.params.height &&
    updated.regions.every((region) =>
      version.editor.regions.some((old) => old.id === region.id && old.mask === region.mask),
    )
  checkEditor(updated, version.image?.name, !!version.image?.missing && unchangedMasks)
  checkDraft(action.editor.draft, workspace.model)
  if (JSON.stringify(version.editor.draft) !== JSON.stringify(action.editor.draft)) {
    const message = pageMessage('event', '手动修改了当前提示词。', version.id)
    message.draftBefore = clone(version.editor.draft)
    message.draftAfter = clone(action.editor.draft)
    workspace.messages.push(message)
  }
  updated.model = workspace.model
  version.editor = updated
  version.editor.regions.forEach((region) => {
    region.accepted = null
  })
  if (
    workspace.execution.regionId &&
    !version.editor.regions.some((region) => region.id === workspace.execution.regionId)
  ) {
    workspace.execution = { kind: 'generate', regionId: null }
  }
}

export function applyExecution(
  workspace: PageWorkspace,
  action: Extract<PageAction, { type: 'execution' }>,
): void {
  workspace.execution = validateExecution(workspace, action.execution)
}
