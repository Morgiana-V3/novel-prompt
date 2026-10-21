import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pinyin } from 'pinyin-pro'
import type { DbStatus, SearchHit, SearchOptions, TagCategory, TagInfo } from '../../shared/types'
import { dataFile } from '../paths'
import { NAI_TAGS, YEAR_TAG_RE } from './nai-tags'
import type { RawTag } from './fetcher'

/** 统一成 danbooru 形式：小写、去转义、空格转下划线 */
export function normalizeTag(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\\([()[\]{}])/g, '$1')
    .replace(/\s+/g, '_')
}

/** 转成 NAI 书写形式（空格分隔，颜文字类短 tag 保留下划线） */
export function displayTag(name: string): string {
  if (name.length <= 3) return name
  return name.replace(/_/g, ' ')
}

interface Entry {
  info: TagInfo
  lower: string
  py?: string
  pyInit?: string
}

function readJson<T>(file: string, fallback: T): T {
  const p = dataFile(file)
  if (!existsSync(p)) return fallback
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

const HAS_ZH = /[\u4e00-\u9fff]/
const ASCII_LETTERS = /^[a-z]+$/

class TagStore {
  private entries: Entry[] = []
  private byName = new Map<string, Entry>()
  private byLength = new Map<number, Entry[]>()
  private aliases = new Map<string, string>()
  private aliasList: [string, string][] = []
  private zhCommunity: Record<string, string> = {}
  private zhAi: Record<string, string> = {}
  private zhUser: Record<string, string> = {}
  private pyCache: Record<string, [string, string]> = {}
  private suggestCache = new Map<string, TagInfo[]>()
  private meta: { fetchedAt?: string; minCount?: number } = {}
  loaded = false

  load(): void {
    const raw = readJson<{ fetchedAt?: string; minCount?: number; tags: RawTag[] }>('tags.json', { tags: [] })
    this.meta = { fetchedAt: raw.fetchedAt, minCount: raw.minCount }
    this.aliasList = readJson<[string, string][]>('aliases.json', [])
    this.zhCommunity = readJson('zh-community.json', {})
    this.zhAi = readJson('zh-ai.json', {})
    this.zhUser = readJson('zh-user.json', {})
    this.pyCache = readJson('pinyin-cache.json', {})

    this.entries = []
    this.byName.clear()
    this.byLength.clear()
    this.suggestCache.clear()

    for (const [name, category, count] of raw.tags) {
      this.addEntry({ name, display: displayTag(name), category: category as TagCategory, count })
    }
    for (const t of NAI_TAGS) {
      const name = normalizeTag(t.name)
      if (this.byName.has(name)) continue
      this.addEntry({ name, display: t.name, category: 100, count: 0, zh: t.zh, versions: t.versions })
    }
    this.entries.sort((a, b) => b.info.count - a.info.count)

    this.aliases = new Map(this.aliasList)
    this.applyTranslations()
    this.loaded = raw.tags.length > 0
  }

  private addEntry(info: TagInfo): void {
    const e: Entry = { info, lower: info.display.toLowerCase() }
    this.entries.push(e)
    this.byName.set(info.name, e)
    const len = info.name.length
    if (!this.byLength.has(len)) this.byLength.set(len, [])
    this.byLength.get(len)!.push(e)
  }

  private zhOf(name: string, fallback?: string): string | undefined {
    return this.zhUser[name] ?? this.zhAi[name] ?? this.zhCommunity[name] ?? fallback
  }

  private applyTranslations(): void {
    let cacheDirty = false
    for (const e of this.entries) {
      const builtin = e.info.category === 100 ? NAI_TAGS.find((t) => normalizeTag(t.name) === e.info.name)?.zh : undefined
      e.info.zh = this.zhOf(e.info.name, builtin)
      if (e.info.zh) {
        let py = this.pyCache[e.info.zh]
        if (!py) {
          const arr = pinyin(e.info.zh, { toneType: 'none', type: 'array', nonZh: 'removed' }) as string[]
          py = [arr.join(''), arr.map((s) => s[0] ?? '').join('')]
          this.pyCache[e.info.zh] = py
          cacheDirty = true
        }
        e.py = py[0]
        e.pyInit = py[1]
      } else {
        e.py = e.pyInit = undefined
      }
    }
    if (cacheDirty) writeFileSync(dataFile('pinyin-cache.json'), JSON.stringify(this.pyCache), 'utf8')
  }

  status(): DbStatus {
    const zhCount = this.entries.filter((e) => e.info.zh).length
    return {
      loaded: this.loaded,
      tagCount: this.entries.length,
      aliasCount: this.aliases.size,
      zhCount,
      fetchedAt: this.meta.fetchedAt,
      minCount: this.meta.minCount
    }
  }

  get(name: string): TagInfo | undefined {
    return this.byName.get(normalizeTag(name))?.info
  }

  /** 精确查找：返回标准 tag 或别名指向的 tag */
  lookup(core: string): { tag?: TagInfo; aliasOf?: TagInfo } {
    const n = normalizeTag(core)
    const hit = this.byName.get(n)
    if (hit) return { tag: hit.info }
    const target = this.aliases.get(n)
    if (target) {
      const t = this.byName.get(target)
      if (t) return { aliasOf: t.info }
    }
    if (YEAR_TAG_RE.test(core.trim().toLowerCase())) {
      return {
        tag: { name: n, display: core.trim(), category: 100, count: 0, zh: `年份 ${core.replace(/\D/g, '')}` }
      }
    }
    return {}
  }

  search(opts: SearchOptions): SearchHit[] {
    const q = opts.query.trim().toLowerCase()
    if (!q) return []
    const limit = opts.limit ?? 60
    const cats = opts.categories?.length ? new Set(opts.categories) : null
    const qSpace = q.replace(/_/g, ' ')
    const isZh = HAS_ZH.test(q)
    const isLetters = ASCII_LETTERS.test(q)
    const hits: SearchHit[] = []
    const seen = new Set<string>()

    for (const e of this.entries) {
      if (cats && !cats.has(e.info.category)) continue
      let s = 0
      if (isZh) {
        const zh = e.info.zh
        if (zh) {
          if (zh === q) s = 1000
          else if (zh.startsWith(q)) s = 600
          else if (zh.includes(q)) s = 300
        }
      } else {
        const l = e.lower
        if (l === qSpace) s = 1000
        else if (l.startsWith(qSpace)) s = 600
        else if (l.includes(' ' + qSpace)) s = 400
        else if (l.includes(qSpace)) s = 200
        if (isLetters && e.pyInit) {
          if (e.pyInit === q) s = Math.max(s, 550)
          else if (e.py!.startsWith(q)) s = Math.max(s, 450)
          else if (q.length >= 2 && e.pyInit.startsWith(q)) s = Math.max(s, 350)
          else if (q.length >= 3 && e.py!.includes(q)) s = Math.max(s, 150)
        }
      }
      if (s > 0) {
        hits.push({ ...e.info, score: s + Math.log10(e.info.count + 1) * 40 })
        seen.add(e.info.name)
      }
    }

    if (!isZh) {
      const qUnder = normalizeTag(q)
      for (const [alias, target] of this.aliasList) {
        if (seen.has(target)) continue
        let s = 0
        if (alias === qUnder) s = 900
        else if (alias.startsWith(qUnder)) s = 450
        if (!s) continue
        const t = this.byName.get(target)
        if (!t || (cats && !cats.has(t.info.category))) continue
        hits.push({ ...t.info, viaAlias: displayTag(alias), score: s + Math.log10(t.info.count + 1) * 40 })
        seen.add(target)
      }
    }

    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, limit)
  }

  /** 为不存在的 tag 给出候选 */
  suggest(core: string, limit = 5): TagInfo[] {
    const n = normalizeTag(core)
    const cached = this.suggestCache.get(n)
    if (cached) return cached
    const max = n.length <= 4 ? 1 : n.length <= 8 ? 2 : 3
    const scored: { info: TagInfo; s: number }[] = []
    for (let len = n.length - max; len <= n.length + max; len++) {
      for (const e of this.byLength.get(len) ?? []) {
        const d = levenshtein(n, e.info.name, max)
        if (d <= max) scored.push({ info: e.info, s: 1000 - d * 300 + Math.log10(e.info.count + 1) * 30 })
      }
    }
    for (const h of this.search({ query: core, limit: 10 })) {
      if (!scored.some((x) => x.info.name === h.name)) scored.push({ info: h, s: h.score * 0.5 })
    }
    const res = scored
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.info)
    this.suggestCache.set(n, res)
    return res
  }

  setTranslation(name: string, zh: string): void {
    const n = normalizeTag(name)
    if (zh.trim()) this.zhUser[n] = zh.trim()
    else delete this.zhUser[n]
    writeFileSync(dataFile('zh-user.json'), JSON.stringify(this.zhUser), 'utf8')
    this.applyTranslations()
  }

  untranslated(minCount: number): TagInfo[] {
    return this.entries
      .filter((e) => !e.info.zh && e.info.count >= minCount && e.info.category !== 1)
      .map((e) => e.info)
  }

  addAiTranslations(map: Record<string, string>): void {
    Object.assign(this.zhAi, map)
    writeFileSync(dataFile('zh-ai.json'), JSON.stringify(this.zhAi), 'utf8')
  }

  refreshTranslations(): void {
    this.applyTranslations()
  }
}

export const tagStore = new TagStore()
