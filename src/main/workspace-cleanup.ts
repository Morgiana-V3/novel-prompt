import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'
import { ownedWorkspaceImages, trashLibraryImage } from './image-library'
import { deletePage, pageEvent, pageLocks, readPage, savePage } from './page-workspaces'
import { workspaceImageNames } from './workspace-image-references'
import { pageCurrent, type PageWorkspace } from '../shared/page-workspace'

let cleaning = false
const namesIn = (w: PageWorkspace) => new Set([...w.versions.map(v => v.image?.name), ...w.messages.map(m => m.discussion?.image?.name)].filter((n): n is string => !!n))
function writable(id: string, revision: number) {
  if (cleaning || pageLocks.has(id)) throw new Error('请等待当前操作完成后清理')
  const w = readPage(id)
  if (w.revision !== revision) throw new Error('项目已更新，请重新打开后清理')
  return w
}
async function clean(names: Set<string>, protectedNames: Set<string>) {
  let count = 0
  for (const name of names) {
    if (protectedNames.has(name)) continue
    try { if (await trashLibraryImage(name)) count++ }
    catch { throw new Error(`已清理 ${count} 张；图片 ${name} 清理失败，请释放文件占用后重试。`) }
  }
  return count
}

export async function clearPageImage(id: string, revision: number, versionId: string): Promise<PageWorkspace> {
  const w = writable(id, revision), version = w.versions.find(v => v.id === versionId)
  if (!version?.image) throw new Error('此版本没有可清理的图片')
  const name = version.image.name
  const shared = workspaceImageNames({ includeRemoved: false, excludeId: id, strict: true })
  cleaning = true; pageLocks.set(id, new AbortController())
  try {
    await clean(new Set([name]), shared)
    for (const v of w.versions) if (v.image?.name === name) { v.image = null; v.imageCleared = true; v.editor.regions = [] }
    for (const m of w.messages) {
      if (m.discussion?.image?.name === name) m.discussion.image = null
      if (m.externalRequest?.status === 'pending') m.externalRequest.status = 'cancelled'
    }
    if (!pageCurrent(w).image) w.execution = { kind: 'generate', regionId: null }
    pageEvent(w, `已清理「${version.label}」的图片，提示词、参数和讨论记录保留。${shared.has(name) ? '其他项目仍在引用，保留共享图片文件。' : '图片已移入系统回收站。'}`, versionId)
    return savePage(w)
  } finally { pageLocks.delete(id); cleaning = false }
}

export async function deletePageWithImages(id: string, revision: number): Promise<void> {
  const w = writable(id, revision)
  const names = new Set([...namesIn(w), ...ownedWorkspaceImages(id)])
  const shared = workspaceImageNames({ includeRemoved: false, excludeId: id, strict: true })
  cleaning = true; pageLocks.set(id, new AbortController())
  try {
    await clean(names, shared)
    pageLocks.delete(id)
    deletePage(id, revision)
  } finally { pageLocks.delete(id); cleaning = false }
}

export async function cleanRemovedPageImages(): Promise<number> {
  if (cleaning || pageLocks.size) throw new Error('请等待工作台当前操作完成后清理')
  const root = join(dataDir(), 'page-workspaces'), removed = join(root, 'removed')
  const activeIds = new Set(existsSync(root) ? readdirSync(root).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(n => n.slice(0, -5)) : [])
  const active = workspaceImageNames({ includeRemoved: false, strict: true })
  const names = new Set(ownedWorkspaceImages().filter(name => !activeIds.has(name.slice(3, 39))))
  const cleanupIds = new Set([...names].map(name => name.slice(3, 39)))
  if (existsSync(removed)) for (const file of readdirSync(removed).filter(n => /^[a-f0-9-]{36}-\d+\.json$/.test(n))) {
    if (!activeIds.has(file.slice(0, 36))) cleanupIds.add(file.slice(0, 36))
    try { for (const name of namesIn(JSON.parse(readFileSync(join(removed, file), 'utf8')))) names.add(name) }
    catch { throw new Error('有已删除项目的记录无法读取，请修复后重试清理') }
  }
  cleaning = true
  for (const id of cleanupIds) pageLocks.set(id, new AbortController())
  try { return await clean(names, active) } finally { for (const id of cleanupIds) pageLocks.delete(id); cleaning = false }
}
