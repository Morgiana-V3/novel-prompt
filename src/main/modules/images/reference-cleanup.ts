import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
} from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { shell } from 'electron'
import { VIBE_IMAGE_PATTERN } from '../../../shared/generation/vibes'
import { dataDir } from '../../infrastructure/paths'
import { imageLibraryDir, legacyImageDir } from './library'
import { pngTexts } from './png-record'

const graceMs = 24 * 60 * 60 * 1000
const maximumFiles = 200
const maximumReadBytes = 96 * 1024 * 1024
const namePattern = /\bref-[a-f0-9]{64}\.png\b/g

interface RecyclableReference {
  name: string
  bytes: number
}

function addNames(text: string, names: Set<string>) {
  for (const value of text.matchAll(namePattern)) {
    names.add(value[0])
  }
}

function scanKnownRecords(path: string, names: Set<string>, depth = 0) {
  if (!existsSync(path)) {
    return
  }
  if (lstatSync(path).isSymbolicLink() || depth >= 6) {
    throw new Error('素材引用目录无法安全扫描')
  }
  for (const item of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, item.name)
    if (item.isSymbolicLink()) {
      throw new Error('发现链接文件，无法安全清理参考素材')
    }
    if (item.isDirectory()) {
      scanKnownRecords(file, names, depth + 1)
      continue
    }
    if (!item.isFile() || !/\.(?:json(?:\.bak)?|png)$/i.test(item.name)) {
      continue
    }
    try {
      if (lstatSync(file).size > maximumReadBytes) {
        throw new Error('记录过大')
      }
      const content = readFileSync(file)
      if (/\.png$/i.test(item.name)) {
        for (const text of Object.values(pngTexts(content))) {
          addNames(text, names)
        }
      } else {
        const text = content.toString('utf8')
        JSON.parse(text)
        addNames(text, names)
      }
    } catch {
      throw new Error('无法读取素材引用记录：' + basename(file))
    }
  }
}

function protectedNames(live: string[]) {
  if (
    !Array.isArray(live) ||
    live.length > 20_000 ||
    live.some((name) => typeof name !== 'string' || !VIBE_IMAGE_PATTERN.test(name))
  ) {
    throw new Error('创作草稿的参考素材清单无效')
  }
  const used = new Set(live)
  const library = imageLibraryDir()
  for (const path of [
    join(dataDir(), 'page-workspaces'),
    join(dataDir(), 'recipes'),
    legacyImageDir(),
    join(library, 'saved'),
    join(library, 'temporary'),
    join(library, 'workspaces'),
  ]) {
    scanKnownRecords(path, used)
  }
  const caches = join(library, 'vibes')
  if (existsSync(caches)) {
    for (const item of readdirSync(caches)) {
      const match = /^([a-f0-9]{64})-[a-f0-9]{64}\.bin(?:\.pending)?$/.exec(item)
      if (match) {
        used.add('ref-' + match[1] + '.png')
      }
    }
  }
  return used
}

function directory() {
  const library = imageLibraryDir()
  const refs = join(library, 'references')
  if (existsSync(refs) && realpathSync(refs) !== join(realpathSync(library), 'references')) {
    throw new Error('参考素材目录无法安全清理')
  }
  return refs
}

export function scanRecyclableReferences(live: string[]): RecyclableReference[] {
  const root = directory()
  if (!existsSync(root)) {
    return []
  }
  const used = protectedNames(live)
  const cutoff = Date.now() - graceMs
  const result: RecyclableReference[] = []
  for (const item of readdirSync(root, { withFileTypes: true })) {
    if (!item.isFile() || !VIBE_IMAGE_PATTERN.test(item.name) || used.has(item.name)) {
      continue
    }
    const stat = lstatSync(join(root, item.name))
    if (Math.max(stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs) < cutoff) {
      result.push({ name: item.name, bytes: stat.size })
    }
  }
  return result.slice(0, maximumFiles)
}

export async function recycleUnusedReferences(live: string[], requested: string[]) {
  if (
    !Array.isArray(requested) ||
    requested.length > maximumFiles ||
    requested.some((name) => typeof name !== 'string' || !VIBE_IMAGE_PATTERN.test(name))
  ) {
    throw new Error('参考素材回收清单无效')
  }
  const chosen = new Set(requested)
  const candidates = scanRecyclableReferences(live).filter((file) => chosen.has(file.name))
  if (!candidates.length) {
    return { moved: 0, failed: [] as string[] }
  }
  const root = directory()
  const staging = join(root, '.recycle-' + randomUUID())
  mkdirSync(staging)
  const moved: string[] = []
  const failed: string[] = []
  // Stage synchronously after rescanning so other host actions cannot interleave with the move.
  for (const candidate of candidates) {
    try {
      renameSync(join(root, candidate.name), join(staging, candidate.name))
      moved.push(candidate.name)
    } catch {
      failed.push(candidate.name)
    }
  }
  try {
    if (moved.length) {
      await shell.trashItem(staging)
    }
  } catch {
    for (const name of moved) {
      const staged = join(staging, name)
      const original = join(dirname(staging), name)
      if (existsSync(staged) && !existsSync(original)) {
        renameSync(staged, original)
      }
    }
    throw new Error('无法移动到系统回收站，已保留原文件或临时回收目录')
  } finally {
    if (existsSync(staging) && !readdirSync(staging).length) {
      rmdirSync(staging)
    }
  }
  return { moved: moved.length, failed }
}
