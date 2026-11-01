import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  statfs,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { app } from 'electron'
import { writeFileAtomic } from '../../infrastructure/atomic-file'
import {
  readStorageLocation,
  storageLocationFile,
  storageRoot,
} from '../../infrastructure/storage-root'
import type { StorageInfo } from '../../../shared/settings/storage'

// All durable application data. Electron's session/lock files stay in the stable bootstrap profile.
const entries = ['data', 'images', 'image-library', 'models', 'skills', 'window-state.json']
const marker = '.novelprompt-migration.json'
const contains = (parent: string, child: string) => {
  const path = relative(parent, child)
  return !path || (!path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path))
}
async function files(root: string): Promise<{ name: string; bytes: number }[]> {
  const result: { name: string; bytes: number }[] = []
  async function visit(name: string) {
    const path = join(root, name)
    let info
    try {
      info = await lstat(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }
    if (info.isSymbolicLink()) {
      throw new Error(`目录包含链接，无法安全迁移：${name}`)
    }
    if (info.isDirectory()) {
      for (const child of await readdir(path)) {
        await visit(join(name, child))
      }
    } else if (info.isFile()) {
      result.push({ name, bytes: info.size })
    } else {
      throw new Error(`不支持的文件类型：${name}`)
    }
  }
  for (const name of entries) {
    await visit(name)
  }
  return result
}
async function digest(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}
async function validateTarget(source: string, target: string) {
  const from = await realpath(source)
  const to = await realpath(target)
  if (contains(from, to) || contains(to, from)) {
    throw new Error('新目录不能是当前目录或其父子目录')
  }
  // Keep development/test data isolated from the installed application's default profile.
  if (!app.isPackaged) {
    for (const name of ['novel-prompt', 'NovelPrompt']) {
      const production = resolve(app.getPath('appData'), name)
      if (contains(production, to) || contains(to, production)) {
        throw new Error('开发版不能迁移到安装版数据目录')
      }
    }
  }
  await access(to, constants.W_OK)
  return to
}
export async function storageInfo(): Promise<StorageInfo> {
  const location = readStorageLocation()
  const path = storageRoot()
  return {
    path,
    bytes: (await files(path)).reduce((sum, file) => sum + file.bytes, 0),
    pending: location.pending?.target ?? null,
    previous: location.previous ?? null,
    error: location.error ?? null,
  }
}
export async function scheduleMigration(target: string): Promise<StorageInfo> {
  const location = readStorageLocation()
  if (location.pending) {
    throw new Error('已有待执行的迁移，请先取消')
  }
  const source = storageRoot()
  const to = await validateTarget(source, target)
  if ((await readdir(to)).length) {
    throw new Error('请选择一个空文件夹，避免覆盖已有文件')
  }
  const size = (await files(source)).reduce((sum, file) => sum + file.bytes, 0)
  const disk = await statfs(to)
  if (disk.bavail * disk.bsize < size + 64 * 1024 * 1024) {
    throw new Error('目标磁盘剩余空间不足')
  }
  writeFileAtomic(
    storageLocationFile(),
    JSON.stringify({
      ...location,
      error: undefined,
      pending: { source, target: to, id: randomUUID() },
    }),
  )
  return storageInfo()
}
export async function cancelMigration(): Promise<StorageInfo> {
  const location = readStorageLocation()
  delete location.pending
  writeFileAtomic(storageLocationFile(), JSON.stringify(location))
  return storageInfo()
}
/** Run under the single-instance lock, before loading any data services or accepting IPC/MCP. */
export async function migrateStorageOnStartup(
  progress: (current: number, total: number) => void = () => {},
): Promise<void> {
  const location = readStorageLocation()
  const pending = location.pending
  if (!pending) {
    storageRoot()
    return
  }
  try {
    const to = await validateTarget(pending.source, pending.target)
    const names = await readdir(to)
    if (names.length) {
      const record = JSON.parse(await readFile(join(to, marker), 'utf8'))
      if (record.id !== pending.id || record.source !== pending.source) {
        throw new Error('目标目录已被其他文件占用')
      }
    } else {
      writeFileAtomic(join(to, marker), JSON.stringify(pending))
    }
    const inventory = await files(pending.source)
    const disk = await statfs(to)
    if (disk.bavail * disk.bsize < inventory.reduce((sum, file) => sum + file.bytes, 0)) {
      throw new Error('目标磁盘剩余空间不足')
    }
    let copied = 0
    const total = inventory.reduce((sum, file) => sum + file.bytes, 0)
    progress(0, total)
    for (const file of inventory) {
      const source = join(pending.source, file.name)
      const target = join(to, file.name)
      // Refuse links anywhere in the destination, including after an interrupted copy.
      const parts = file.name.split(sep)
      let directory = to
      for (const part of parts.slice(0, -1)) {
        directory = join(directory, part)
        await mkdir(directory, { recursive: true })
        if ((await lstat(directory)).isSymbolicLink()) {
          throw new Error('目标目录包含链接')
        }
      }
      try {
        if (!(await lstat(target)).isFile() || (await lstat(target)).isSymbolicLink()) {
          throw new Error('目标文件类型不安全')
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
      await copyFile(source, target)
      if ((await digest(source)) !== (await digest(target))) {
        throw new Error(`文件校验失败：${file.name}`)
      }
      copied += file.bytes
      progress(copied, total)
    }
    writeFileAtomic(storageLocationFile(), JSON.stringify({ path: to, previous: pending.source }))
  } catch (error) {
    // After falling back, the source may change. Never merge a later snapshot into a stale partial copy.
    writeFileAtomic(
      storageLocationFile(),
      JSON.stringify({
        ...location,
        pending: undefined,
        error: `迁移未完成，仍使用原目录。目标目录中的副本已保留；重试请选择空目录。${String(error)}`,
      }),
    )
  }
}
