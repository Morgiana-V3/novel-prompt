import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function dataFile(name: string): string {
  return join(dataDir(), name)
}

/** 随安装包发布的使用总则、提示词编排、画面推测与局部重绘规则。 */
export const BUNDLED_SKILLS = [
  'core.md',
  'nai-prompt.md',
  'nai-preview.md',
  'nai-inpaint.md',
] as const
export type BundledSkill = (typeof BUNDLED_SKILLS)[number]

export const SKILL_TEMPLATES = ['nai-manga-prompt-design'] as const
export type SkillTemplate = (typeof SKILL_TEMPLATES)[number]

export function bundledTemplatePath(name: SkillTemplate): string {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return join(root, 'skill-templates', name, 'SKILL.md')
}

/** Stable legacy keys resolve to package entries; core remains a standalone document. */
export function bundledSkillPath(name: BundledSkill): string {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'skills')
    : join(app.getAppPath(), 'skills')
  const entry = join(root, name.replace(/\.md$/, ''), 'SKILL.md')
  return name !== 'core.md' && existsSync(entry) ? entry : join(root, name)
}

/** 用户 Skill 目录（每份一个 .md） */
export function userSkillDir(): string {
  const dir = join(app.getPath('userData'), 'skills', 'user')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 旧版本把内置 skill 复制到这里供用户直接修改；现在只用于迁移 */
export const legacySkillDir = () => join(app.getPath('userData'), 'skills')

/**
 * 历史版本里随安装包发布过的 skill 内容指纹（换行统一为 \n 后 sha256 的前 16 位）。
 * 迁移时用来判断旧副本是不是「没改过的默认版」：是就丢弃，否则转成一份用户 Skill。
 */
export const KNOWN_DEFAULTS: Record<'nai-prompt.md' | 'nai-preview.md', string[]> = {
  'nai-prompt.md': [
    '21f8661e8a634288',
    'a08684a449026b80',
    'bc996c88eb5cd654',
    'bb5958b1e8e40872',
    '8974f19147708d36',
    '2db7ee1a2f3bfeb5',
  ],
  'nai-preview.md': ['60de9340e6b762c0', '5ec7316b05f7cffd', '8e7316a442c036bd'],
}

export const fingerprint = (text: string) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)
