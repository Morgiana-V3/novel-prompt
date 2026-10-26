import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { writeFileAtomic as writeFileSync } from './fs-safe'
import type { UpdateInfo } from '../shared/types'
import { dataFile } from './paths'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import { AppUpdateService } from './app-updater'

/**
 * 版本检查：GitHub Releases 是静态存储，不会主动推给客户端，只能客户端启动时来问一次。
 * 安装版使用 electron-updater；下面的网页检测只供开发环境和便携版使用。
 *
 * 不用 api.github.com：未认证限流是每 IP 每小时 60 次，共享出口 IP 很容易被别的程序吃光，
 * 一旦用完整个小时都是 403。改为请求 releases/latest 的网页地址，让它 302 到
 * /releases/tag/<版本号>，从跳转后的 URL 里取版本号——这条路径不占 API 配额。
 * API 只在需要 release 正文时补一次，失败也不影响版本判断。
 */

const REPO = 'Morgiana-V3/novel-prompt'
export const UPDATE_REPO = REPO
const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const PAGE = `https://github.com/${REPO}/releases`
/** 缓存有效期：一天内不重复请求 */
const TTL = 24 * 60 * 60 * 1000
const CACHE = 'update-check.json'
const TIMEOUT = 10_000

export function createAppUpdater(publish: (state: UpdateInfo) => void, isBusy: () => boolean): AppUpdateService {
  const manualReason = !app.isPackaged ? '开发预览不安装更新，请使用 Windows 安装版体验自动更新'
    : process.platform !== 'win32' ? '当前平台暂不支持应用内安装'
      : process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR ? '便携版需手动替换程序；安装版支持自动更新'
        : !existsSync(join(process.resourcesPath, 'app-update.yml')) ? '此安装包未配置更新源，请安装支持自动更新的版本' : undefined
  return new AppUpdateService(manualReason ? null : autoUpdater,
    { current: app.getVersion(), url: LATEST_PAGE, manualReason }, publish, checkUpdate, isBusy)
}

interface Cached {
  checkedAt: number
  latest: string
  url: string
  notes?: string
}

/** 把 v0.2.1 / 0.2 / 0.2.1-beta.1 解析成可用于比较的数字数组 */
function parseVersion(v: string): number[] {
  const core = v.trim().replace(/^v/i, '').split(/[-+]/)[0]
  const parts = core.split('.').map((s) => Number.parseInt(s, 10))
  return [0, 1, 2].map((i) => (Number.isFinite(parts[i]) ? parts[i] : 0))
}

/** a 是否比 b 新 */
export function isNewer(a: string, b: string): boolean {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i]
  }
  return false
}

function readCache(): Cached | null {
  const file = dataFile(CACHE)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Cached
  } catch {
    return null
  }
}

const result = (c: Cached | null, error?: string): UpdateInfo => {
  const current = app.getVersion()
  if (!c) return { current, latest: '', newer: false, url: PAGE, checkedAt: 0, error }
  return {
    current,
    latest: c.latest,
    newer: isNewer(c.latest, current),
    url: c.url || PAGE,
    notes: c.notes,
    checkedAt: c.checkedAt,
    error
  }
}

/** 请求超时（fetch 默认没有超时，网络不通时会挂很久） */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'User-Agent': `novel-prompt/${app.getVersion()}`, ...init.headers }
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从 releases/latest 的跳转结果取版本号：没有 release 时 GitHub 会跳到 /releases 而不是 /releases/tag/xxx。
 * 返回 null 表示「仓库没有任何正式版本的 release」，与「请求失败」区分开。
 */
async function latestFromRedirect(): Promise<{ tag: string; url: string } | null> {
  const res = await fetchWithTimeout(LATEST_PAGE, { redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const m = /\/releases\/tag\/([^/?#]+)/.exec(res.url)
  return m ? { tag: decodeURIComponent(m[1]), url: `https://github.com/${REPO}/releases/tag/${m[1]}` } : null
}

/** release 正文。拿不到就算了，不影响版本判断 */
async function releaseNotes(tag: string): Promise<string | undefined> {
  try {
    const res = await fetchWithTimeout(API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return undefined
    const data = (await res.json()) as { tag_name?: string; body?: string }
    if ((data.tag_name ?? '').trim() !== tag) return undefined
    return (data.body ?? '').trim().slice(0, 1500) || undefined
  } catch {
    return undefined
  }
}

/** 读缓存；超过 TTL 才去请求。force = 用户手动点检查 */
export async function checkUpdate(force = false): Promise<UpdateInfo> {
  const cached = readCache()
  if (!force && cached && Date.now() - cached.checkedAt < TTL) return result(cached)
  try {
    const hit = await latestFromRedirect()
    if (!hit) return result(cached, '还没有发布过正式版本')
    const fresh: Cached = {
      checkedAt: Date.now(),
      latest: hit.tag,
      url: hit.url,
      notes: cached?.latest === hit.tag ? cached.notes : await releaseNotes(hit.tag)
    }
    writeFileSync(dataFile(CACHE), JSON.stringify(fresh), 'utf8')
    return result(fresh)
  } catch (e) {
    // 检查失败不是错误：离线、被墙都正常，静默用旧缓存
    const err = e as Error & { name?: string }
    const message = err?.name === 'AbortError' ? '请求超时' : String(err?.message ?? e)
    return result(cached, message)
  }
}
