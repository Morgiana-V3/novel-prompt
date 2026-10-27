import { isNaiVersion } from '../../../shared/generation/types'
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { PNG } from 'pngjs'
import type { NaiGenParams, NaiVersion } from '../../../shared/generation/types'
import type { InpaintDraft } from '../../../shared/prompts/types'
import { pageCurrent, type PageAction, type PageWorkspace } from '../../../shared/workspace/model'
import { pngSize } from '../../providers/novelai/png-response'
import { imagePath } from '../images/access'
import {
  imageInfo,
  ownWorkspaceImage,
  readImageRecipe,
  stageImportedImage,
} from '../images/library'
import { readPngPrompt } from '../prompts/png-import'
import { applyEditor, applyExecution, applyNotes, applyRecipe } from './editor-actions'
import { pageLocks } from './locks'
import { applyProposalDecision } from './proposals'
import { readPage, savePage } from './repository'
import { clone, pageEvent } from './snapshot'
import { checkDraft, checkPageParams } from './validation'
import { adoptVersion } from './versions'

export async function createPage(
  imageName: string | null,
  params: NaiGenParams,
  model: NaiVersion,
  fallback: InpaintDraft,
): Promise<PageWorkspace> {
  if (!isNaiVersion(model)) {
    throw new Error('不支持的生图模型')
  }
  let image = imageName ? imageInfo(imageName) : null
  const src = imageName ? imagePath(imageName) : null
  if (imageName && (!image || !src)) {
    throw new Error('请选择仍在图库中的图片')
  }
  let draft = fallback
  let imported = false
  if (src) {
    try {
      draft = await readPngPrompt(readFileSync(src))
      imported = true
    } catch {
      /* Explicit fallback from current prompt. */
    }
  }
  const recorded = imageName ? readImageRecipe(imageName) : null
  if (recorded) {
    const request = recorded.request
    draft = { base: request.base, negative: request.negative, characters: request.characters }
    params = request.params
    model = request.version
    imported = true
  }
  checkDraft(draft, model)
  checkPageParams(params)
  const now = Date.now()
  const versionId = randomUUID()
  const id = randomUUID()
  if (imageName) {
    image = ownWorkspaceImage(imageName, id)
  }
  const workspace: PageWorkspace = {
    schema: 2,
    id,
    title: '新项目',
    goal: '',
    preserve: '',
    model,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    currentVersionId: versionId,
    composer: '',
    execution: { kind: 'generate', regionId: null },
    versions: [
      {
        id: versionId,
        parentId: null,
        label: image ? '原稿' : '起点',
        image,
        createdAt: now,
        editor: {
          draft: clone(draft),
          regions: [],
          params: {
            ...params,
            width: image?.width ?? params.width,
            height: image?.height ?? params.height,
            count: 1,
            qualityTags: false,
            ucPreset: 'none',
          },
          strength: 1,
        },
      },
    ],
    messages: [],
  }
  workspace.versions[0].editor.model = model
  workspace.versions[0].initial = {
    model,
    draft: clone(draft),
    params: clone(workspace.versions[0].editor.params),
  }
  const resolveValue = () => {
    if (imported) {
      return '会话已建立，已读取原图提示词。' as const
    }
    if (image) {
      return '会话已建立。图片没有可读取的提示词，初始草稿请核对。' as const
    }
    return '会话已建立。' as const
  }
  pageEvent(workspace, resolveValue())
  return savePage(workspace)
}

/** Keep an owned copy so moving the user's original cannot break page history. */
export async function importPage(
  path: string,
  params: NaiGenParams,
  model: NaiVersion,
  fallback: InpaintDraft,
): Promise<PageWorkspace> {
  if (statSync(path).size > 40 * 1024 * 1024) {
    throw new Error('导入图片不能超过 40 MB')
  }
  const bytes = readFileSync(path)
  const size = pngSize(bytes)
  if (!size || !size.width || !size.height || size.width * size.height > 4 * 1024 * 1024) {
    throw new Error('请选择有效 PNG，最多 4096×1024 总像素')
  }
  PNG.sync.read(bytes)
  const staged = stageImportedImage(bytes)
  let workspace: PageWorkspace
  try {
    workspace = await createPage(staged.name, params, model, fallback)
  } finally {
    staged.dispose()
  }
  workspace.title =
    basename(path)
      .replace(/\.png$/i, '')
      .slice(0, 100) || '未命名项目'
  return savePage(workspace)
}

export function editPage(id: string, revision: number, action: PageAction): PageWorkspace {
  if (pageLocks.has(id)) {
    throw new Error('请等待当前分析或生成完成')
  }
  const workspace = readPage(id)
  if (workspace.revision !== revision) {
    throw new Error('工作区已在别处更新，请重新打开后继续')
  }
  pageCurrent(workspace)
  if (action.type === 'recipe') {
    applyRecipe(workspace, action)
  } else if (action.type === 'notes') {
    applyNotes(workspace, action)
  } else if (action.type === 'editor') {
    applyEditor(workspace, action)
  } else if (action.type === 'execution') {
    applyExecution(workspace, action)
  } else if (action.type === 'switch') {
    adoptVersion(workspace, action)
  } else if (action.type === 'proposal') {
    applyProposalDecision(workspace, action)
  } else {
    throw new Error('不支持的工作区操作')
  }
  return savePage(workspace)
}
