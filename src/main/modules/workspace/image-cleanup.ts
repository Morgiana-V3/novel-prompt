import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pageCurrent, type PageWorkspace } from '../../../shared/workspace/model'
import { dataDir } from '../../infrastructure/paths'
import { ownedWorkspaceImages, trashLibraryImage } from '../images/library'
import { workspaceImageNames } from './image-references'
import { pageLocks } from './locks'
import { deletePage, readPage, savePage } from './repository'
import { pageEvent } from './snapshot'

let cleaning = false
const namesIn = (workspace: PageWorkspace) =>
  new Set(
    [
      ...workspace.versions.map((version) => version.image?.name),
      ...workspace.messages.map((message) => message.discussion?.image?.name),
    ].filter((filename): filename is string => !!filename),
  )
/** Shared by the gallery and MCP; never remove a referenced image or leave its recipe behind. */
export async function deleteUnreferencedImage(name: string): Promise<boolean> {
  if (workspaceImageNames({ strict: true }).has(name)) {
    throw new Error('这张图片被 AI 工作台引用，请在对应项目中删除指定图片')
  }
  return trashLibraryImage(name)
}
function writable(id: string, revision: number) {
  if (cleaning || pageLocks.has(id)) {
    throw new Error('请等待当前操作完成后清理')
  }
  const workspace = readPage(id)
  if (workspace.revision !== revision) {
    throw new Error('项目已更新，请重新打开后清理')
  }
  return workspace
}
async function clean(names: Set<string>, protectedNames: Set<string>) {
  let count = 0
  for (const name of names) {
    if (protectedNames.has(name)) {
      continue
    }
    try {
      if (await trashLibraryImage(name)) {
        count++
      }
    } catch {
      throw new Error(`已清理 ${count} 张；图片 ${name} 清理失败，请释放文件占用后重试。`)
    }
  }
  return count
}

export async function clearPageImage(
  id: string,
  revision: number,
  versionId: string,
): Promise<PageWorkspace> {
  const workspace = writable(id, revision)
  const version = workspace.versions.find((version2) => version2.id === versionId)
  if (!version?.image) {
    throw new Error('此版本没有可清理的图片')
  }
  const name = version.image.name
  const shared = workspaceImageNames({ includeRemoved: false, excludeId: id, strict: true })
  cleaning = true
  pageLocks.set(id, new AbortController())
  try {
    await clean(new Set([name]), shared)
    for (const version2 of workspace.versions) {
      if (version2.image?.name === name) {
        version2.image = null
        version2.imageCleared = true
        version2.editor.regions = []
      }
    }
    for (const message of workspace.messages) {
      if (message.discussion?.image?.name === name) {
        message.discussion.image = null
      }
      if (message.externalRequest?.status === 'pending') {
        message.externalRequest.status = 'cancelled'
      }
    }
    if (!pageCurrent(workspace).image) {
      workspace.execution = { kind: 'generate', regionId: null }
    }
    pageEvent(
      workspace,
      `已清理「${version.label}」的图片，提示词、参数和讨论记录保留。${shared.has(name) ? '其他项目仍在引用，保留共享图片文件。' : '图片已移入系统回收站。'}`,
      versionId,
    )
    return savePage(workspace)
  } finally {
    pageLocks.delete(id)
    cleaning = false
  }
}

export async function deletePageWithImages(id: string, revision: number): Promise<void> {
  const workspace = writable(id, revision)
  const names = new Set([...namesIn(workspace), ...ownedWorkspaceImages(id)])
  const shared = workspaceImageNames({ includeRemoved: false, excludeId: id, strict: true })
  cleaning = true
  pageLocks.set(id, new AbortController())
  try {
    await clean(names, shared)
    pageLocks.delete(id)
    deletePage(id, revision)
  } finally {
    pageLocks.delete(id)
    cleaning = false
  }
}

export async function cleanRemovedPageImages(): Promise<number> {
  if (cleaning || pageLocks.size) {
    throw new Error('请等待工作台当前操作完成后清理')
  }
  const root = join(dataDir(), 'page-workspaces')
  const removed = join(root, 'removed')
  const activeIds = new Set(
    existsSync(root)
      ? readdirSync(root)
          .filter((filename) => /^[a-f0-9-]{36}\.json$/.test(filename))
          .map((filename) => filename.slice(0, -5))
      : [],
  )
  const active = workspaceImageNames({ includeRemoved: false, strict: true })
  const names = new Set(ownedWorkspaceImages().filter((name) => !activeIds.has(name.slice(3, 39))))
  const cleanupIds = new Set([...names].map((name) => name.slice(3, 39)))
  if (existsSync(removed)) {
    for (const file of readdirSync(removed).filter((filename) =>
      /^[a-f0-9-]{36}-\d+\.json$/.test(filename),
    )) {
      if (!activeIds.has(file.slice(0, 36))) {
        cleanupIds.add(file.slice(0, 36))
      }
      try {
        for (const name of namesIn(JSON.parse(readFileSync(join(removed, file), 'utf8')))) {
          names.add(name)
        }
      } catch {
        throw new Error('有已删除项目的记录无法读取，请修复后重试清理')
      }
    }
  }
  cleaning = true
  for (const id of cleanupIds) {
    pageLocks.set(id, new AbortController())
  }
  try {
    return await clean(names, active)
  } finally {
    for (const id of cleanupIds) {
      pageLocks.delete(id)
    }
    cleaning = false
  }
}
