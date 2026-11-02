import { storageRoot } from '../../infrastructure/storage-root'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BundledSkill, BundledUserSkill } from './catalog'
/** Installation seeds only; once copied, these are ordinary editable user Skills. */
export function bundledUserSkillPath(name: BundledUserSkill): string {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'skill-templates')
    : join(app.getAppPath(), 'resources/skills/user-seeds')
  return join(root, name, 'SKILL.md')
}

/** Stable legacy keys resolve to package entries; core remains a standalone document. */
export function bundledSkillPath(name: BundledSkill): string {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'skills')
    : join(app.getAppPath(), 'resources/skills/builtin')
  const entry = join(root, name.replace(/\.md$/, ''), 'SKILL.md')
  return name !== 'core.md' && existsSync(entry) ? entry : join(root, name)
}

/** 用户 Skill 目录（每份一个 .md） */
export function userSkillDir(): string {
  const dir = join(storageRoot(), 'skills', 'user')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 旧版本把内置 skill 复制到这里供用户直接修改；现在只用于迁移 */
export const legacySkillDir = () => join(storageRoot(), 'skills')
