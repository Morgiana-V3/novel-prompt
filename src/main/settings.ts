import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import type { Settings } from '../shared/types'
import { dataFile } from './paths'

export const DEFAULT_MODEL = 'deepseek-flash'
/** 已下线的旧模型名，读取设置时自动迁移到 V4.1-Flash */
const LEGACY_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner'])

const DEFAULTS: Settings = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: DEFAULT_MODEL,
  reasoningEffort: 'low',
  minPostCount: 10,
  naiVersion: 'v4.5',
  translateMinCount: 50,
  naiToken: '',
  naiFreeOnly: true,
  mcpAllowAi: false,
  mcpAllowGenerate: false
}

let cache: Settings | null = null
let cacheMtime = 0

const mtimeOf = (file: string) => (existsSync(file) ? statSync(file).mtimeMs : 0)

/**
 * 读取设置。文件被其他进程改过（例如界面里改了设置，而 MCP 进程还在运行）时自动重新读取。
 */
export function getSettings(): Settings {
  const file = dataFile('settings.json')
  const mtime = mtimeOf(file)
  if (cache && mtime === cacheMtime) return cache
  let saved: Partial<Settings> = {}
  if (mtime) {
    try {
      saved = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      saved = {}
    }
  }
  if (saved.model && LEGACY_MODELS.has(saved.model)) saved.model = DEFAULT_MODEL
  cache = { ...DEFAULTS, ...saved }
  cacheMtime = mtime
  return cache
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  const file = dataFile('settings.json')
  writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8')
  cacheMtime = mtimeOf(file)
  return cache
}
