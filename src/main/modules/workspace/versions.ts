import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { pageCurrent, type PageAction, type PageWorkspace } from '../../../shared/workspace/model'
import { imagePath } from '../images/access'
import { restoreImageFile } from '../images/library'
import { savePage } from './repository'
import { pageEvent } from './snapshot'
import { writablePage } from './writable'

export function recoverPageImage(
  id: string,
  revision: number,
  versionId: string,
  path: string,
): PageWorkspace {
  const workspace = writablePage(id, revision)
  const version = workspace.versions.find((version2) => version2.id === versionId)
  if (!version?.image || imagePath(version.image.name)) {
    throw new Error('仅可恢复缺失的历史图片')
  }
  if (!version.image.contentHash) {
    throw new Error('旧记录没有原图校验信息，请将图片导入新会话，避免误替换历史结果')
  }
  if (statSync(path).size > 40 * 1024 * 1024) {
    throw new Error('图片不能超过 40 MB')
  }
  const bytes = readFileSync(path)
  if (createHash('sha256').update(bytes).digest('hex') !== version.image.contentHash) {
    throw new Error('所选文件与原图不同，请选择当时导出的原始 PNG')
  }
  restoreImageFile(version.image.name, bytes)
  version.image.missing = false
  pageEvent(workspace, `已恢复「${version.label}」的原始图片。`)
  return savePage(workspace)
}

export function adoptVersion(
  workspace: PageWorkspace,
  action: Extract<PageAction, { type: 'switch' }>,
): void {
  const version = pageCurrent(workspace)

  const next = workspace.versions.find((version2) => version2.id === action.versionId)
  if (!next || (next.image && !imagePath(next.image.name))) {
    throw new Error('该版本图片已不存在')
  }
  if (next.id !== version.id) {
    workspace.currentVersionId = next.id
    workspace.model =
      next.editor.model ?? next.generated?.model ?? next.initial?.model ?? workspace.model
    workspace.execution = { kind: 'generate', regionId: null }
    pageEvent(workspace, `创作蓝本切换为「${next.label}」。之后从此版本继续，其他结果保留为历史。`)
  }
}
