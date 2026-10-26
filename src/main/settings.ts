import { readFileSync, existsSync, statSync, copyFileSync } from 'node:fs'
import type { Settings } from '../shared/types'
import { dataFile } from './paths'
import { quarantine, writeFileAtomic } from './fs-safe'

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

function parseFile(file: string): Partial<Settings> | undefined {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined
  } catch {
    return undefined
  }
}

/**
 * 读取设置。文件被其他进程改过（例如界面里改了设置，而 MCP 进程还在运行）时自动重新读取。
 * 文件损坏时不静默清空：坏文件改名留存，并尝试从上一次保存的备份恢复（API Key、Token 不丢）。
 */
export function getSettings(): Settings {
  const file = dataFile('settings.json')
  const mtime = mtimeOf(file)
  if (cache && mtime === cacheMtime) return cache
  let saved: Partial<Settings> = {}
  let restored = false
  if (mtime) {
    const parsed = parseFile(file)
    if (parsed) saved = parsed
    else {
      quarantine(file)
      const backup = parseFile(`${file}.bak`)
      if (backup) { saved = backup; restored = true }
    }
  }
  if (saved.model && LEGACY_MODELS.has(saved.model)) saved.model = DEFAULT_MODEL
  cache = { ...DEFAULTS, ...saved }
  if (restored) {
    try { writeFileAtomic(file, JSON.stringify(cache, null, 2)) } catch { /* 写回失败时下次仍会从备份恢复 */ }
  }
  cacheMtime = mtimeOf(file)
  return cache
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  const file = dataFile('settings.json')
  // 保留上一份完好的设置作为备份，主文件意外损坏时可从这里恢复
  if (existsSync(file) && parseFile(file)) {
    try { copyFileSync(file, `${file}.bak`) } catch { /* 备份失败不阻止保存 */ }
  }
  writeFileAtomic(file, JSON.stringify(cache, null, 2))
  cacheMtime = mtimeOf(file)
  return cache
}
