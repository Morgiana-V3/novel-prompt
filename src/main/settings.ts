import { readFileSync, writeFileSync, existsSync } from 'node:fs'
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
  translateMinCount: 50
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  const file = dataFile('settings.json')
  let saved: Partial<Settings> = {}
  if (existsSync(file)) {
    try {
      saved = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      saved = {}
    }
  }
  if (saved.model && LEGACY_MODELS.has(saved.model)) saved.model = DEFAULT_MODEL
  cache = { ...DEFAULTS, ...saved }
  return cache
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch }
  writeFileSync(dataFile('settings.json'), JSON.stringify(cache, null, 2), 'utf8')
  return cache
}
