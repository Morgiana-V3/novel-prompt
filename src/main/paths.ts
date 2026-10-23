import { app } from 'electron'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'

export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function dataFile(name: string): string {
  return join(dataDir(), name)
}

/** 随安装包发布的 skill 文档：core = 固定的使用总则，nai-prompt = 内置编排规范，nai-preview = 内置画面推测 */
export const BUNDLED_SKILLS = ['core.md', 'nai-prompt.md', 'nai-preview.md'] as const
export type BundledSkill = (typeof BUNDLED_SKILLS)[number]

/** 内置 skill 只读，直接读安装包里的文件 */
export function bundledSkillPath(name: BundledSkill): string {
  return app.isPackaged ? join(process.resourcesPath, 'skills', name) : join(app.getAppPath(), 'skills', name)
}

/** 用户 Skill 目录（每份一个 .md） */
export function userSkillDir(): string {
  const dir = join(app.getPath('userData'), 'skills', 'user')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** 旧版本把内置 skill 复制到这里供用户直接修改；现在只用于迁移 */
export const legacySkillDir = () => join(app.getPath('userData'), 'skills')

/**
 * 历史版本里随安装包发布过的 skill 内容指纹（换行统一为 \n 后 sha256 的前 16 位）。
 * 迁移时用来判断旧副本是不是「没改过的默认版」：是就丢弃，否则转成一份用户 Skill。
 */
export const KNOWN_DEFAULTS: Record<'nai-prompt.md' | 'nai-preview.md', string[]> = {
  'nai-prompt.md': ['21f8661e8a634288', 'a08684a449026b80', 'bc996c88eb5cd654', 'bb5958b1e8e40872', '8974f19147708d36'],
  'nai-preview.md': ['60de9340e6b762c0', '5ec7316b05f7cffd']
}

export const fingerprint = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)
