import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { dataFile } from '../paths'

/**
 * 两层数据：
 * - 默认层（只读）：项目 default-data/*.json.gz，打包后位于 resources/default-data
 * - 用户层（可写）：%APPDATA%/novel-prompt/data/*.json，下载、AI 翻译、手动编辑都只写这里
 */
export type DataSource = 'default' | 'user'

interface Manifest {
  fetchedAt?: string
  minCount?: number
}

export function defaultDataDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'default-data') : join(app.getAppPath(), 'default-data')
}

export function readUser<T>(name: string): T | undefined {
  const p = dataFile(name)
  if (!existsSync(p)) return undefined
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    return undefined
  }
}

export function readDefault<T>(name: string): T | undefined {
  const p = join(defaultDataDir(), name + '.gz')
  if (!existsSync(p)) return undefined
  try {
    return JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as T
  } catch {
    return undefined
  }
}

export function defaultManifest(): Manifest | undefined {
  const p = join(defaultDataDir(), 'manifest.json')
  if (!existsSync(p)) return undefined
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Manifest
  } catch {
    return undefined
  }
}

/** tag / 别名 / 社区翻译是同一次下载的产物：取抓取时间更新的那一层 */
export function pickTagSource(userFetchedAt?: string): DataSource {
  if (!userFetchedAt) return 'default'
  const def = defaultManifest()?.fetchedAt
  if (!def) return 'user'
  return Date.parse(userFetchedAt) >= Date.parse(def) ? 'user' : 'default'
}

export function readFrom<T>(source: DataSource, name: string): T | undefined {
  return source === 'user' ? readUser<T>(name) : readDefault<T>(name)
}
