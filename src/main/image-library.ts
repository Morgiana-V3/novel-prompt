import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, rmSync, realpathSync, openSync, readSync, closeSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import { writeFileAtomic } from './fs-safe'
import { pngSize } from './nai/zip'
import type { ImageRecipe, NaiImage } from '../shared/types'
import { workspaceImageNames } from './workspace-image-references'

type Storage = NonNullable<NaiImage['storage']>
const uuid = /^[a-f0-9-]{36}$/
const safeName = /^[\w.-]+\.png$/i
const ensure = (p: string) => { mkdirSync(p, { recursive: true }); return p }
export const legacyImageDir = () => ensure(join(app.getPath('userData'), 'images'))
export const imageLibraryDir = () => ensure(join(app.getPath('userData'), 'image-library'))
const root = imageLibraryDir
const temporary = () => ensure(join(root(), 'temporary'))
const saved = () => ensure(join(root(), 'saved'))
const workspaceRoot = () => ensure(join(root(), 'workspaces'))
export const imageUrl = (name: string) => `np-img://img/${encodeURIComponent(name)}`
const liveTemporaryImages = new Set<string>()
let cleanupStatus = { pending: 0, message: '' }
export const temporaryCleanupStatus = () => ({ ...cleanupStatus })

function workspacePath(name: string): string | null {
  const owner = /^ws-([a-f0-9-]{36})-/.exec(name)?.[1]
  return owner && uuid.test(owner) ? join(workspaceRoot(), owner, name) : null
}
export function libraryImagePath(name: string): string | null {
  if (typeof name !== 'string' || !safeName.test(name) || name.includes('..')) return null
  return [workspacePath(name), join(saved(), name), join(temporary(), name), join(legacyImageDir(), name)].find((p): p is string => !!p && existsSync(p)) ?? null
}
export function imageInfo(name: string, references?: Set<string>): NaiImage | null {
  const p = libraryImagePath(name)
  if (!p) return null
  const storage: Storage = p === workspacePath(name) || (p === join(legacyImageDir(), name) && (references ?? workspaceImageNames()).has(name))
    ? 'workspace' : p === join(temporary(), name) ? 'temporary' : 'saved'
  const header = Buffer.alloc(24), fd = openSync(p, 'r')
  try { readSync(fd, header, 0, 24, 0) } finally { closeSync(fd) }
  const size = pngSize(header)
  let seed: number | undefined
  try { seed = readImageRecipe(name)?.request.params.seed ?? undefined } catch { /* Old images have no sidecar. */ }
  const legacySeed = /^\d{8}-\d{6}-(\d+)/.exec(name)?.[1]
  seed ??= legacySeed === undefined ? undefined : Number(legacySeed)
  return { name, url: imageUrl(name), createdAt: statSync(p).mtimeMs, seed, width: size?.width, height: size?.height, storage }
}
export function readImageRecipe(name: string): ImageRecipe | null {
  if (typeof name !== 'string' || !safeName.test(name) || name.includes('..')) return null
  const p = [workspacePath(name), join(saved(), name), join(temporary(), name), join(legacyImageDir(), name)].find(p => p && existsSync(`${p}.json`))
  if (!p) return null
  const r = JSON.parse(readFileSync(`${p}.json`, 'utf8')) as ImageRecipe
  if (r.schema !== 1 || !r.request?.params) throw new Error('图片生成记录损坏，不能用当前草稿替代')
  return r
}
export function storeGeneratedImage(bytes: Buffer, recipe: ImageRecipe, storage: Storage, owner?: string): NaiImage {
  if (storage === 'workspace' && (!owner || !uuid.test(owner))) throw new Error('工作台标识无效')
  const dir = storage === 'workspace' ? ensure(join(workspaceRoot(), owner!)) : storage === 'saved' ? saved() : temporary()
  const name = `${storage === 'workspace' ? `ws-${owner}-` : ''}${randomUUID()}.png`
  const dest = join(dir, name)
  if (storage === 'temporary') liveTemporaryImages.add(name)
  // Publish metadata first; a visible PNG always has its exact generation record.
  writeFileAtomic(`${dest}.json`, JSON.stringify(recipe))
  writeFileAtomic(dest, bytes)
  return { ...imageInfo(name)!, contentHash: createHash('sha256').update(bytes).digest('hex') }
}
export function retainImage(name: string): NaiImage {
  const image = imageInfo(name), src = libraryImagePath(name)
  if (!image || !src) throw new Error('图片已不存在')
  if (image.storage !== 'temporary') return image
  const dest = join(saved(), name)
  if (existsSync(`${src}.json`)) writeFileAtomic(`${dest}.json`, readFileSync(`${src}.json`))
  writeFileAtomic(dest, readFileSync(src))
  // A cleanup failure must not report a successfully retained image as unsaved.
  try { unlinkSync(src); if (existsSync(`${src}.json`)) unlinkSync(`${src}.json`) } catch { /* Saved copy is authoritative. */ }
  return imageInfo(name)!
}
export function ownWorkspaceImage(name: string, owner: string): NaiImage {
  if (!uuid.test(owner)) throw new Error('工作台标识无效')
  const src = libraryImagePath(name)
  if (!src) throw new Error('图片不存在，无法建立存档')
  if (name.startsWith(`ws-${owner}-`)) return imageInfo(name)!
  const newName = `ws-${owner}-${randomUUID()}.png`, dest = join(ensure(join(workspaceRoot(), owner)), newName)
  if (existsSync(`${src}.json`)) writeFileAtomic(`${dest}.json`, readFileSync(`${src}.json`))
  writeFileAtomic(dest, readFileSync(src))
  return { ...imageInfo(newName)!, contentHash: createHash('sha256').update(readFileSync(dest)).digest('hex') }
}
export function listLibraryImages(limit = 120): NaiImage[] {
  const dirs = [legacyImageDir(), temporary(), saved()]
  for (const d of readdirSync(workspaceRoot(), { withFileTypes: true })) if (d.isDirectory() && uuid.test(d.name)) dirs.push(join(workspaceRoot(), d.name))
  const names = new Set(dirs.flatMap(dir => readdirSync(dir).filter(n => safeName.test(n))))
  const references = workspaceImageNames()
  return [...names].map(name => { try { return imageInfo(name, references) } catch { return null } }).filter((i): i is NaiImage => !!i).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}
/** Called only by the primary host, before accepting work and after all work ends. */
export function clearTemporaryImages(includeCurrentSession = true): ReturnType<typeof temporaryCleanupStatus> {
  cleanupStatus = { pending: 0, message: '' }
  try {
    const dir = temporary(), parent = root()
    const resolved = realpathSync(dir), expected = resolve(parent, 'temporary')
    if (resolved !== expected || !resolved.startsWith(realpathSync(parent) + sep)) throw new Error('临时目录位置异常，已停止自动清理')
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => Number(a.name.endsWith('.json')) - Number(b.name.endsWith('.json')))
    for (const entry of entries) {
      // Retry only previous sessions: newly generated images must remain available.
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.png(?:\.json)?$/.test(entry.name) ||
        !includeCurrentSession && liveTemporaryImages.has(entry.name.replace(/\.json$/, ''))) continue
      // A locked PNG still needs its recipe if the user chooses to retain it.
      if (entry.name.endsWith('.json') && existsSync(join(dir, entry.name.slice(0, -5)))) continue
      try { rmSync(join(dir, entry.name)) } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') cleanupStatus.pending++
      }
    }
    if (cleanupStatus.pending) cleanupStatus.message = `有 ${cleanupStatus.pending} 个上次运行的临时文件未能清理。请释放文件占用或检查目录权限后重试。`
  } catch {
    cleanupStatus.message = '临时目录无法安全清理。请检查目录位置、权限或文件占用后重试。'
  }
  return temporaryCleanupStatus()
}
export function restoreImageFile(name: string, bytes: Buffer): NaiImage {
  if (!safeName.test(name) || name.includes('..')) throw new Error('图片标识无效')
  PNG.sync.read(bytes)
  const dest = workspacePath(name) ?? join(legacyImageDir(), name)
  ensure(resolve(dest, '..'))
  writeFileAtomic(dest, bytes)
  return imageInfo(name)!
}
