import { app, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { PNG } from 'pngjs'
import { embedRecipe, pngTexts } from './png-record'
import { recipeFromTexts, validRecipe } from '../../../shared/images/metadata'
import type { ImageRecipe, NaiImage } from '../../../shared/images/types'
import { writeFileAtomic } from '../../infrastructure/atomic-file'
import { pngSize } from '../../providers/novelai/png-response'
import { workspaceImageNames } from '../workspace/image-references'

type Storage = NonNullable<NaiImage['storage']>
const uuid = /^[a-f0-9-]{36}$/
const safeName = /^[\w.-]+\.png$/i
const ensure = (path: string) => {
  mkdirSync(path, { recursive: true })
  return path
}
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
  if (typeof name !== 'string' || !safeName.test(name) || name.includes('..')) {
    return null
  }
  return (
    [
      workspacePath(name),
      join(saved(), name),
      join(temporary(), name),
      join(legacyImageDir(), name),
    ].find((path): path is string => !!path && existsSync(path)) ?? null
  )
}
export function imageInfo(name: string, references?: Set<string>): NaiImage | null {
  const path = libraryImagePath(name)
  if (!path) {
    return null
  }
  const resolveStorage = () => {
    if (
      path === workspacePath(name) ||
      (path === join(legacyImageDir(), name) && (references ?? workspaceImageNames()).has(name))
    ) {
      return 'workspace' as const
    }
    if (path === join(temporary(), name)) {
      return 'temporary' as const
    }
    return 'saved' as const
  }
  const storage: Storage = resolveStorage()
  const header = Buffer.alloc(24)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, header, 0, 24, 0)
  } finally {
    closeSync(fd)
  }
  const size = pngSize(header)
  let seed: number | undefined
  try {
    seed = readImageRecipe(name)?.request.params.seed ?? undefined
  } catch {
    /* A damaged record must not hide an otherwise viewable image. */
  }
  const legacySeed = /^\d{8}-\d{6}-(\d+)/.exec(name)?.[1]
  seed ??= legacySeed === undefined ? undefined : Number(legacySeed)
  return {
    name,
    url: imageUrl(name),
    createdAt: statSync(path).mtimeMs,
    seed,
    width: size?.width,
    height: size?.height,
    storage,
  }
}
const recipeCache = new Map<string, { stamp: string; recipe: ImageRecipe | null }>()
export function readImageRecipe(name: string): ImageRecipe | null {
  const path = libraryImagePath(name)
  if (!path) {
    return null
  }
  const stat = statSync(path)
  const sidecar = existsSync(`${path}.json`) ? statSync(`${path}.json`) : null
  const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${sidecar?.mtimeMs}:${sidecar?.ctimeMs}:${sidecar?.size}`
  const cached = recipeCache.get(path)
  if (cached?.stamp === stamp) {
    return structuredClone(cached.recipe)
  }
  const texts = pngTexts(readFileSync(path))
  let recipe: ImageRecipe | null
  // v0.8 stored the actual request beside the PNG. Keep embedded NovelPrompt records authoritative.
  if (sidecar && texts.NovelPrompt === undefined) {
    const legacy: unknown = JSON.parse(readFileSync(`${path}.json`, 'utf8'))
    if (!validRecipe(legacy)) {
      throw new Error('旧版图片生成记录损坏，无法恢复准确配置')
    }
    recipe = legacy
  } else {
    recipe = recipeFromTexts(texts, stat.mtimeMs)
  }
  if (recipeCache.size >= 128) {
    recipeCache.clear()
  }
  recipeCache.set(path, { stamp, recipe })
  return structuredClone(recipe)
}

/** Copies/exports of v0.8 images carry their sidecar record inside the new PNG. */
export function imageBytesWithRecipe(name: string): Buffer {
  const path = libraryImagePath(name)
  if (!path) {
    throw new Error('图片不存在或已被删除')
  }
  const bytes = readFileSync(path)
  if (!existsSync(`${path}.json`)) {
    return bytes
  }
  const recipe = readImageRecipe(name)
  return recipe ? embedRecipe(bytes, recipe) : bytes
}

export function storeGeneratedImage(
  bytes: Buffer,
  recipe: ImageRecipe,
  storage: Storage,
  owner?: string,
): NaiImage {
  if (storage === 'workspace' && (!owner || !uuid.test(owner))) {
    throw new Error('工作台标识无效')
  }
  const resolveDir = () => {
    if (storage === 'workspace') {
      return ensure(join(workspaceRoot(), owner!))
    }
    if (storage === 'saved') {
      return saved()
    }
    return temporary()
  }
  const dir = resolveDir()
  const name = `${storage === 'workspace' ? `ws-${owner}-` : ''}${randomUUID()}.png`
  const dest = join(dir, name)
  if (storage === 'temporary') {
    liveTemporaryImages.add(name)
  }
  const png = embedRecipe(bytes, recipe)
  writeFileAtomic(dest, png)
  return { ...imageInfo(name)!, contentHash: createHash('sha256').update(png).digest('hex') }
}
export function retainImage(name: string): NaiImage {
  const image = imageInfo(name)
  const src = libraryImagePath(name)
  if (!image || !src) {
    throw new Error('图片已不存在')
  }
  if (image.storage !== 'temporary') {
    return image
  }
  const dest = join(saved(), name)
  writeFileAtomic(dest, imageBytesWithRecipe(name))
  // A cleanup failure must not report a successfully retained image as unsaved.
  try {
    unlinkSync(src)
    if (existsSync(`${src}.json`)) {
      unlinkSync(`${src}.json`)
    }
  } catch {
    /* Saved copy is authoritative. */
  }
  return imageInfo(name)!
}
export function ownWorkspaceImage(name: string, owner: string): NaiImage {
  if (!uuid.test(owner)) {
    throw new Error('工作台标识无效')
  }
  const src = libraryImagePath(name)
  if (!src) {
    throw new Error('图片不存在，无法建立存档')
  }
  if (name.startsWith(`ws-${owner}-`)) {
    return imageInfo(name)!
  }
  const newName = `ws-${owner}-${randomUUID()}.png`
  const dest = join(ensure(join(workspaceRoot(), owner)), newName)
  writeFileAtomic(dest, imageBytesWithRecipe(name))
  return {
    ...imageInfo(newName)!,
    contentHash: createHash('sha256').update(readFileSync(dest)).digest('hex'),
  }
}
export function listLibraryImages(limit = 120): NaiImage[] {
  const dirs = [legacyImageDir(), temporary(), saved()]
  for (const entry of readdirSync(workspaceRoot(), { withFileTypes: true })) {
    if (entry.isDirectory() && uuid.test(entry.name)) {
      dirs.push(join(workspaceRoot(), entry.name))
    }
  }
  const names = new Set(
    dirs.flatMap((dir) => readdirSync(dir).filter((imageName) => safeName.test(imageName))),
  )
  const references = workspaceImageNames()
  return [...names]
    .map((name) => {
      try {
        return imageInfo(name, references)
      } catch {
        return null
      }
    })
    .filter((image): image is NaiImage => !!image)
    .sort((image, image2) => image2.createdAt - image.createdAt)
    .slice(0, limit)
}
/** Called only by the primary host, before accepting work and after all work ends. */
export function clearTemporaryImages(
  includeCurrentSession = true,
): ReturnType<typeof temporaryCleanupStatus> {
  cleanupStatus = { pending: 0, message: '' }
  try {
    const dir = temporary()
    const parent = root()
    const resolved = realpathSync(dir)
    const expected = resolve(parent, 'temporary')
    if (resolved !== expected || !resolved.startsWith(realpathSync(parent) + sep)) {
      throw new Error('临时目录位置异常，已停止自动清理')
    }
    const entries = readdirSync(dir, { withFileTypes: true }).sort(
      (entry, entry2) =>
        Number(entry.name.endsWith('.json')) - Number(entry2.name.endsWith('.json')),
    )
    for (const entry of entries) {
      // Retry only previous sessions: newly generated images must remain available.
      if (
        !entry.isFile() ||
        !/^[a-f0-9-]{36}\.png(?:\.json)?$/.test(entry.name) ||
        (!includeCurrentSession && liveTemporaryImages.has(entry.name.replace(/\.json$/, '')))
      ) {
        continue
      }
      // A locked PNG still needs its recipe if the user chooses to retain it.
      if (entry.name.endsWith('.json') && existsSync(join(dir, entry.name.slice(0, -5)))) {
        continue
      }
      try {
        rmSync(join(dir, entry.name))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          cleanupStatus.pending++
        }
      }
    }
    if (cleanupStatus.pending) {
      cleanupStatus.message = `有 ${cleanupStatus.pending} 个上次运行的临时文件未能清理。请释放文件占用或检查目录权限后重试。`
    }
  } catch {
    cleanupStatus.message = '临时目录无法安全清理。请检查目录位置、权限或文件占用后重试。'
  }
  return temporaryCleanupStatus()
}
export function restoreImageFile(name: string, bytes: Buffer): NaiImage {
  if (!safeName.test(name) || name.includes('..')) {
    throw new Error('图片标识无效')
  }
  PNG.sync.read(bytes)
  const dest = workspacePath(name) ?? join(legacyImageDir(), name)
  ensure(resolve(dest, '..'))
  writeFileAtomic(dest, bytes)
  return imageInfo(name)!
}

/** Include recipe-only leftovers so an interrupted cleanup can be retried. */
export function ownedWorkspaceImages(owner?: string): string[] {
  if (owner && !uuid.test(owner)) {
    throw new Error('工作台标识无效')
  }
  const owners = owner
    ? [owner]
    : readdirSync(workspaceRoot(), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && uuid.test(entry.name))
        .map((entry) => entry.name)
  return owners.flatMap((id) => {
    const dir = join(workspaceRoot(), id)
    if (!existsSync(dir)) {
      return []
    }
    return [
      ...new Set(
        readdirSync(dir)
          .map((imageName) => imageName.replace(/\.json$/, ''))
          .filter((imageName) => safeName.test(imageName) && imageName.startsWith(`ws-${id}-`)),
      ),
    ]
  })
}

/** Remove only empty, directly owned folders. Never recurse or follow directory links. */
export function pruneWorkspaceImageDirectories(
  options: { owner?: string; keep?: ReadonlySet<string> } = {},
): number {
  if (options.owner && !uuid.test(options.owner)) {
    throw new Error('工作台标识无效')
  }
  const root = join(imageLibraryDir(), 'workspaces')
  if (
    !existsSync(root) ||
    lstatSync(root).isSymbolicLink() ||
    realpathSync(root) !== resolve(root)
  ) {
    return 0
  }
  const owners = options.owner ? [options.owner] : readdirSync(root)
  let removed = 0
  for (const owner of owners) {
    if (!uuid.test(owner) || options.keep?.has(owner)) {
      continue
    }
    const dir = join(root, owner)
    try {
      const stat = lstatSync(dir)
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(dir) !== resolve(dir)) {
        continue
      }
      if (readdirSync(dir).length) {
        continue
      }
      // rmdir itself refuses a folder populated after the emptiness check.
      rmdirSync(dir)
      removed++
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
        throw new Error(`空目录 ${owner} 清理失败，请释放占用或检查权限后重试。`)
      }
    }
  }
  return removed
}

/** Move both the PNG and its generation recipe to the system recycle bin. */
export async function trashLibraryImage(name: string): Promise<boolean> {
  if (typeof name !== 'string' || !safeName.test(name) || name.includes('..')) {
    throw new Error('图片标识无效')
  }
  let removed = false
  for (const path of [
    workspacePath(name),
    join(saved(), name),
    join(temporary(), name),
    join(legacyImageDir(), name),
  ]) {
    if (!path) {
      continue
    }
    for (const target of [path, `${path}.json`]) {
      if (existsSync(target)) {
        await shell.trashItem(target)
        removed = true
      }
    }
  }
  const owner = /^ws-([a-f0-9-]{36})-/.exec(name)?.[1]
  if (owner) {
    pruneWorkspaceImageDirectories({ owner })
  }
  return removed
}

/** A transient import is owned by the caller until its workspace copy is saved. */
export function stageImportedImage(bytes: Buffer): { name: string; dispose: () => void } {
  const name = 'page-import-' + randomUUID() + '.png'
  const path = join(legacyImageDir(), name)
  writeFileAtomic(path, bytes)
  return { name, dispose: () => unlinkSync(path) }
}
