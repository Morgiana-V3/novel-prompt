import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import {
  compactPageProposals,
  pageCurrent,
  type PageWorkspace,
} from '../../../shared/workspace/model'
import { writeFileAtomic } from '../../infrastructure/atomic-file'
import { imagePath } from '../images/access'
import { pageIndex, rememberPage } from './index-cache'
import { pageLocks } from './locks'
import { clone, pageEvent } from './snapshot'
import { directory, file, fileSignature } from './storage-paths'

export function readPage(id: string): PageWorkspace {
  const path = file(id)
  const signature = fileSignature(path)
  const workspace = JSON.parse(readFileSync(path, 'utf8')) as PageWorkspace
  if (
    ![1, 2].includes(workspace.schema) ||
    workspace.id !== id ||
    !Array.isArray(workspace.versions) ||
    !Array.isArray(workspace.messages)
  ) {
    throw new Error('工作区文件格式不受支持')
  }
  pageCurrent(workspace)
  if (workspace.schema === 1) {
    workspace.schema = 2
    workspace.execution = { kind: 'generate', regionId: null }
    const oldVersions = [...workspace.versions]
    for (const version of oldVersions) {
      for (const region of version.editor.regions.filter((region2) => region2.accepted)) {
        const restored = {
          ...clone(version),
          id: randomUUID(),
          parentId: version.id,
          label: `${version.label} · 区域 ${region.label} 草稿（旧版）`,
          editor: {
            ...clone(version.editor),
            draft: clone(region.accepted!),
            regions: version.editor.regions.map((region2) => ({ ...region2, accepted: null })),
          },
        }
        workspace.versions.push(restored)
      }
      version.editor.regions.forEach((region2) => {
        region2.accepted = null
      })
    }
    if (workspace.title === '未命名漫画页') {
      workspace.title = '未命名项目'
    }
    pageEvent(
      workspace,
      '已升级为通用创作会话。旧版区域独立草稿保留在历史版本；请选择要继续使用的草稿。',
    )
    savePage(workspace)
  }
  for (const version2 of workspace.versions) {
    if (version2.image) {
      const path = imagePath(version2.image.name)
      version2.image.missing = !path
      version2.image.storage = 'workspace'
      if (path && !version2.image.contentHash) {
        version2.image.contentHash = createHash('sha256').update(readFileSync(path)).digest('hex')
      }
    }
  }
  rememberPage(workspace, signature)
  return workspace
}

export function savePage(workspace: PageWorkspace): PageWorkspace {
  compactPageProposals(workspace)
  workspace.updatedAt = Date.now()
  workspace.revision++
  const data = JSON.stringify(workspace)
  if (Buffer.byteLength(data) > 64 * 1024 * 1024) {
    throw new Error('当前工作区超过 64 MB，请减少不再使用的选区')
  }
  writeFileAtomic(file(workspace.id), data)
  pageIndex.delete(file(workspace.id))
  return workspace
}

export function deletePage(id: string, revision: number): void {
  if (pageLocks.has(id)) {
    throw new Error('请等待当前操作完成后删除')
  }
  const workspace = readPage(id)
  if (workspace.revision !== revision) {
    throw new Error('会话已更新，请刷新后删除')
  }
  const removed = join(directory(), 'removed')
  mkdirSync(removed, { recursive: true })
  renameSync(file(id), join(removed, id + '-' + Date.now() + '.json'))
  pageIndex.delete(file(id))
}

export function listRemovedPages(): { token: string; title: string; removedAt: number }[] {
  const dir = join(directory(), 'removed')
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
    .filter((filename) => /^[a-f0-9-]{36}-\d+\.json$/.test(filename))
    .flatMap((token) => {
      try {
        const workspaceRecord = JSON.parse(readFileSync(join(dir, token), 'utf8'))
        return [
          { token, title: String(workspaceRecord.title), removedAt: Number(token.slice(37, -5)) },
        ]
      } catch {
        return []
      }
    })
    .sort((leftEntry, rightEntry) => rightEntry.removedAt - leftEntry.removedAt)
}

export function restorePage(token: string): PageWorkspace {
  if (!listRemovedPages().some((removedPage) => removedPage.token === token)) {
    throw new Error('回收站中的会话不存在')
  }
  const id = token.slice(0, 36)
  if (pageLocks.has(id)) {
    throw new Error('项目图片正在清理，请稍后再恢复记录')
  }
  if (existsSync(file(id))) {
    throw new Error('同名会话已经存在，不能覆盖')
  }
  renameSync(join(directory(), 'removed', token), file(id))
  return readPage(id)
}
