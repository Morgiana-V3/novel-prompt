import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SkillResource } from '../../../shared/skills/types'
import { writeFileAtomic } from '../../infrastructure/atomic-file'

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const MAX_BYTES = 20 * 1024 * 1024
const MAX_FILES = 100

export function recoverPackage(root: string): void {
  if (existsSync(root) || !existsSync(dirname(root))) {
    return
  }
  const prefix = root.slice(dirname(root).length + 1) + '.backup-'
  const backups = readdirSync(dirname(root)).filter(
    (name) => name.startsWith(prefix) && /^[a-f0-9-]{36}$/.test(name.slice(prefix.length)),
  )
  if (backups.length === 1) {
    renameSync(join(dirname(root), backups[0]), root)
  }
}

export function resourceKind(path: string): SkillResource['kind'] | null {
  const extension = extname(path).toLowerCase()
  if (extension === '.md') {
    return 'markdown'
  }
  return imageExtensions.has(extension) ? 'image' : null
}

export function validateResourcePath(path: string): void {
  if (
    typeof path !== 'string' ||
    path.length > 240 ||
    path.toLowerCase() === 'skill.md' ||
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[\\:\x00-\x1f<>"|?*]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      )
  ) {
    throw new Error('资源路径必须是包内相对路径，且不能覆盖 SKILL.md')
  }
}

export function validateResources(resources: SkillResource[]): void {
  if (!Array.isArray(resources) || resources.length > MAX_FILES) {
    throw new Error('每份 Skill 最多包含 100 个参考文件')
  }
  const paths = new Set<string>()
  let bytes = 0
  for (const resource of resources) {
    validateResourcePath(resource.path)
    const key = resource.path.toLowerCase()
    if (
      paths.has(key) ||
      resourceKind(resource.path) !== resource.kind ||
      typeof resource.content !== 'string'
    ) {
      throw new Error(`资源格式无效或路径重复：${resource.path}`)
    }
    paths.add(key)
    if (
      resource.kind === 'image' &&
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(resource.content)
    ) {
      throw new Error(`图片编码无效：${resource.path}`)
    }
    bytes += Buffer.byteLength(resource.content, resource.kind === 'image' ? 'base64' : 'utf8')
    if (bytes > MAX_BYTES) {
      throw new Error('Skill 参考文件总大小不能超过 20 MB')
    }
  }
}

export function readPackage(root: string): {
  entry: string
  resources: SkillResource[]
  warnings: string[]
} {
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) {
    throw new Error('请选择实际的 Skill 文件夹，不支持目录链接')
  }
  const resources: SkillResource[] = []
  const warnings: string[] = []
  let entry = ''
  let bytes = 0
  let visited = 0
  function visit(directory: string, prefix = ''): void {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 500) {
        throw new Error('目录内容过多，请选择单份 Skill 的文件夹')
      }
      const path = prefix + item.name
      const absolute = join(directory, item.name)
      const stats = lstatSync(absolute)
      if (stats.isSymbolicLink()) {
        throw new Error(`不支持符号链接或目录联接：${path}`)
      }
      if (
        item.name.startsWith('.') ||
        ['node_modules', 'scripts', '__pycache__'].includes(item.name)
      ) {
        warnings.push(`未导入：${path}（隐藏文件、依赖或脚本不执行）`)
        continue
      }
      if (stats.isDirectory()) {
        visit(absolute, `${path}/`)
        continue
      }
      const kind = resourceKind(path)
      if (!stats.isFile() || !kind) {
        warnings.push(`未导入：${path}（仅支持 Markdown 和 PNG/JPEG/WebP/GIF）`)
        continue
      }
      bytes += stats.size
      if (bytes > MAX_BYTES) {
        throw new Error('Skill 总大小不能超过 20 MB')
      }
      const content = readFileSync(absolute).toString(kind === 'image' ? 'base64' : 'utf8')
      if (path.toLowerCase() === 'skill.md') {
        entry = content
      } else {
        resources.push({ path, kind, content })
      }
    }
  }
  visit(root)
  if (!entry.trim()) {
    throw new Error('文件夹根目录需要非空的 SKILL.md；请选择单份 Skill 的根目录')
  }
  validateResources(resources)
  return { entry, resources, warnings }
}

/** Stage a complete package before replacing it; failed saves retain the old package. */
export function writePackage(root: string, entry: string, resources: SkillResource[]): void {
  validateResources(resources)
  const stage = `${root}.stage-${randomUUID()}`
  const backup = `${root}.backup-${randomUUID()}`
  mkdirSync(stage, { recursive: true })
  try {
    writeFileAtomic(join(stage, 'SKILL.md'), entry)
    for (const resource of resources) {
      const target = resolve(stage, resource.path)
      if (!target.startsWith(resolve(stage) + sep)) {
        throw new Error('资源不能写入 Skill 文件夹之外')
      }
      mkdirSync(dirname(target), { recursive: true })
      writeFileAtomic(
        target,
        Buffer.from(resource.content, resource.kind === 'image' ? 'base64' : 'utf8'),
      )
    }
    if (existsSync(root)) {
      renameSync(root, backup)
    }
    try {
      renameSync(stage, root)
    } catch (error) {
      if (existsSync(backup)) {
        renameSync(backup, root)
      }
      throw error
    }
  } finally {
    // These paths are generated siblings of the validated package root, never input paths.
    if (existsSync(stage)) {
      rmSync(stage, { recursive: true })
    }
  }
  if (existsSync(backup)) {
    try {
      rmSync(backup, { recursive: true })
    } catch (error) {
      // The new package is already committed. Keep the backup if another process holds it.
      console.warn('Skill 已保存，旧备份暂时无法清理', error)
    }
  }
}
