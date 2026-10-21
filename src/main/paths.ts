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

function bundledSkillPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'skills', 'nai-prompt.md')
    : join(app.getAppPath(), 'skills', 'nai-prompt.md')
}

/**
 * skill 文档路径：
 * - 开发模式直接使用项目内 skills/nai-prompt.md，方便编辑
 * - 打包后首次运行复制到 userData/skills 下，用户可自由修改
 */
export function skillPath(): string {
  if (!app.isPackaged) return bundledSkillPath()
  const dir = join(app.getPath('userData'), 'skills')
  const target = join(dir, 'nai-prompt.md')
  if (!existsSync(target)) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(bundledSkillPath(), target)
  }
  return target
}
