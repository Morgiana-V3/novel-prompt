import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'

export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function dataFile(name: string): string {
  return join(dataDir(), name)
}

/** 内置的 skill 文档：nai-prompt = AI 优化，nai-preview = 画面推测 */
export const SKILL_FILES = ['nai-prompt.md', 'nai-preview.md'] as const
export type SkillFile = (typeof SKILL_FILES)[number]

function bundledSkillPath(name: SkillFile): string {
  return app.isPackaged ? join(process.resourcesPath, 'skills', name) : join(app.getAppPath(), 'skills', name)
}

/**
 * skill 文档路径：
 * - 开发模式直接使用项目内 skills/ 下的文档，方便编辑
 * - 打包后首次运行复制到 userData/skills 下，用户可自由修改
 */
export function skillPath(name: SkillFile = 'nai-prompt.md'): string {
  if (!app.isPackaged) return bundledSkillPath(name)
  const dir = join(app.getPath('userData'), 'skills')
  const target = join(dir, name)
  if (!existsSync(target)) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(bundledSkillPath(name), target)
  }
  return target
}
