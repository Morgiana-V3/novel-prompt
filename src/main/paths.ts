import { app } from 'electron'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'

export function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function dataFile(name: string): string {
  return join(dataDir(), name)
}

/** 内置的 skill 文档：nai-prompt = AI 优化（也是 MCP prompt_guide 的内容），nai-preview = 画面推测 */
export const SKILL_FILES = ['nai-prompt.md', 'nai-preview.md'] as const
export type SkillFile = (typeof SKILL_FILES)[number]

/**
 * 历史版本里随安装包发布过的 skill 内容指纹（换行统一为 \n 后 sha256 的前 16 位）。
 * 用来判断用户目录里的旧副本是不是「没改过的旧默认版」：是就直接升级，否则保留用户的修改。
 */
const KNOWN_DEFAULTS: Record<SkillFile, string[]> = {
  'nai-prompt.md': ['21f8661e8a634288', 'a08684a449026b80', 'bc996c88eb5cd654'],
  'nai-preview.md': ['60de9340e6b762c0']
}
/** 记录每份 skill 最近一次同步到的内置版本指纹 */
const STATE_FILE = '.bundled.json'

const fingerprint = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)

function bundledSkillPath(name: SkillFile): string {
  return app.isPackaged ? join(process.resourcesPath, 'skills', name) : join(app.getAppPath(), 'skills', name)
}

function readState(dir: string): Partial<Record<SkillFile, string>> {
  try {
    return JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8'))
  } catch {
    return {}
  }
}

/** 新版默认 skill 的旁路副本：用户改过的 skill 不覆盖，新版放在这里供对照 */
export const defaultCopyName = (name: SkillFile) => name.replace(/\.md$/, '.default.md')

/**
 * 内置版本更新时同步到用户目录：
 * - 用户没改过（等于上次同步的版本或任一历史默认版）→ 直接升级
 * - 用户改过 → 保留用户的版本，新版写到 *.default.md 供对照
 */
function syncSkill(dir: string, name: SkillFile, target: string): void {
  const bundled = readFileSync(bundledSkillPath(name), 'utf8')
  const latest = fingerprint(bundled)
  const state = readState(dir)
  if (state[name] === latest) return
  const current = fingerprint(readFileSync(target, 'utf8'))
  const pristine = current === latest || (state[name] ? current === state[name] : KNOWN_DEFAULTS[name].includes(current))
  if (pristine) {
    if (current !== latest) writeFileSync(target, bundled, 'utf8')
  } else {
    writeFileSync(join(dir, defaultCopyName(name)), bundled, 'utf8')
  }
  writeFileSync(join(dir, STATE_FILE), JSON.stringify({ ...state, [name]: latest }), 'utf8')
}

/**
 * skill 文档路径：
 * - 开发模式直接使用项目内 skills/ 下的文档，方便编辑
 * - 打包后复制到 userData/skills 下，用户可自由修改；新版本发布后按 syncSkill 的规则同步
 */
export function skillPath(name: SkillFile = 'nai-prompt.md'): string {
  if (!app.isPackaged) return bundledSkillPath(name)
  const dir = join(app.getPath('userData'), 'skills')
  const target = join(dir, name)
  if (!existsSync(target)) {
    mkdirSync(dir, { recursive: true })
    copyFileSync(bundledSkillPath(name), target)
    const state = readState(dir)
    writeFileSync(join(dir, STATE_FILE), JSON.stringify({ ...state, [name]: fingerprint(readFileSync(target, 'utf8')) }), 'utf8')
    return target
  }
  try {
    syncSkill(dir, name, target)
  } catch {
    /* 同步失败时继续使用现有副本 */
  }
  return target
}
