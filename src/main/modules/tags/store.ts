import { pinyin } from 'pinyin-pro'
import type {
  DbStatus,
  SearchHit,
  SearchOptions,
  TagCategory,
  TagInfo,
} from '../../../shared/tags/types'
import { writeFileAtomic as writeFileSync } from '../../infrastructure/atomic-file'
import { dataFile } from '../../infrastructure/paths'
import type { RawTag } from './fetcher'
import { pickTagSource, readDefault, readFrom, readUser, type DataSource } from './layers'
import { NAI_TAGS, YEAR_TAG_RE } from './nai-tags'

/** 统一成 danbooru 形式：小写、去转义、空格转下划线 */
export function normalizeTag(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\\([()[\]{}])/g, '$1')
    .replace(/\s+/g, '_')
}

/** 转成 NAI 书写形式（空格分隔，颜文字类短 tag 保留下划线） */
export function displayTag(name: string): string {
  if (name.length <= 3) {
    return name
  }
  return name.replace(/_/g, ' ')
}

interface Entry {
  info: TagInfo
  lower: string
  py?: string
  pyInit?: string
}

type Dict<T = string> = Record<string, T>
type TagsFile = { fetchedAt?: string; minCount?: number; tags: RawTag[] }

function levenshtein(leftText: string, rightText: string, max: number): number {
  if (Math.abs(leftText.length - rightText.length) > max) {
    return max + 1
  }
  let prev = Array.from({ length: rightText.length + 1 }, (_, i) => i)
  for (let i = 1; i <= leftText.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= rightText.length; j++) {
      const pixelValue = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (leftText[i - 1] === rightText[j - 1] ? 0 : 1),
      )
      cur.push(pixelValue)
      if (pixelValue < rowMin) {
        rowMin = pixelValue
      }
    }
    if (rowMin > max) {
      return max + 1
    }
    prev = cur
  }
  return prev[rightText.length]
}

const HAS_ZH = /[\u4e00-\u9fff]/
const ASCII_LETTERS = /^[a-z]+$/

class TagStore {
  private entries: Entry[] = []
  private byName = new Map<string, Entry>()
  private byLength = new Map<number, Entry[]>()
  private aliases = new Map<string, string>()
  private aliasList: [string, string][] = []
  private zhCommunity: Dict = {}
  /** 合并后的视图（默认层 + 用户层，用户层优先） */
  private zhAi: Dict = {}
  private zhUser: Dict = {}
  private pyCache: Dict<[string, string]> = {}
  /** 只属于用户层、需要写回磁盘的部分 */
  private zhAiMine: Dict = {}
  private zhUserMine: Dict = {}
  private pyMine: Dict<[string, string]> = {}
  private suggestCache = new Map<string, TagInfo[]>()
  private implications = new Map<string, string[]>()
  private impliedCache = new Map<string, Set<string>>()
  private implicationCount = 0
  private meta: { fetchedAt?: string; minCount?: number; source?: DataSource } = {}
  loaded = false

  load(): void {
    const userTags = readUser<TagsFile>('tags.json')
    const source = pickTagSource(userTags?.fetchedAt)
    const raw = (source === 'user' ? userTags : readDefault<TagsFile>('tags.json')) ?? { tags: [] }
    this.meta = { fetchedAt: raw.fetchedAt, minCount: raw.minCount, source }
    this.aliasList = readFrom<[string, string][]>(source, 'aliases.json') ?? []
    this.zhCommunity = readFrom<Dict>(source, 'zh-community.json') ?? {}

    this.zhAiMine = readUser<Dict>('zh-ai.json') ?? {}
    this.zhUserMine = readUser<Dict>('zh-user.json') ?? {}
    this.pyMine = readUser<Dict<[string, string]>>('pinyin-cache.json') ?? {}
    this.zhAi = { ...readDefault<Dict>('zh-ai.json'), ...this.zhAiMine }
    this.zhUser = { ...readDefault<Dict>('zh-user.json'), ...this.zhUserMine }
    this.pyCache = { ...readDefault<Dict<[string, string]>>('pinyin-cache.json'), ...this.pyMine }

    this.entries = []
    this.byName.clear()
    this.byLength.clear()
    this.suggestCache.clear()

    for (const [name, category, count] of raw.tags) {
      this.addEntry({ name, display: displayTag(name), category: category as TagCategory, count })
    }
    for (const tagDefinition of NAI_TAGS) {
      const name = normalizeTag(tagDefinition.name)
      if (this.byName.has(name)) {
        continue
      }
      this.addEntry({
        name,
        display: tagDefinition.name,
        category: 100,
        count: 0,
        zh: tagDefinition.zh,
        versions: tagDefinition.versions,
      })
    }
    this.entries.sort((entry, entry2) => entry2.info.count - entry.info.count)

    this.aliases = new Map(this.aliasList)
    this.loadImplications()
    this.applyTranslations()
    this.loaded = raw.tags.length > 0
  }

  /** 包含关系独立于 tag 下载：用户层有就用用户层（可单独补下载），否则用内置数据 */
  loadImplications(): void {
    const list =
      readUser<[string, string][]>('implications.json') ??
      readDefault<[string, string][]>('implications.json') ??
      []
    this.implications.clear()
    this.implicationCount = 0
    for (const [a, c] of list) {
      if (!this.implications.has(a)) {
        this.implications.set(a, [])
      }
      this.implications.get(a)!.push(c)
      this.implicationCount++
    }
    this.impliedCache.clear()
  }

  /** a 所包含的全部 tag（传递闭包），如 white_thighhighs → thighhighs, legwear */
  implied(name: string): Set<string> {
    const normalizedTag = normalizeTag(name)
    const cached = this.impliedCache.get(normalizedTag)
    if (cached) {
      return cached
    }
    const out = new Set<string>()
    const stack = [...(this.implications.get(normalizedTag) ?? [])]
    while (stack.length) {
      const text = stack.pop()!
      if (out.has(text) || text === normalizedTag) {
        continue
      }
      out.add(text)
      stack.push(...(this.implications.get(text) ?? []))
    }
    this.impliedCache.set(normalizedTag, out)
    return out
  }

  /** 找出一组 tag 中被其他 tag 包含（因而冗余）的项：返回 [更具体的 tag, 被包含的 tag] */
  redundantPairs(names: string[]): [string, string][] {
    const set = new Set(names.map(normalizeTag))
    const pairs: [string, string][] = []
    for (const leftText of set) {
      for (const text of this.implied(leftText)) {
        if (set.has(text)) {
          pairs.push([leftText, text])
        }
      }
    }
    return pairs
  }

  get hasImplications(): boolean {
    return this.implicationCount > 0
  }

  /** 当前 tag 库中所有标准 tag 名（用于单独下载包含关系时过滤） */
  names(): Set<string> {
    return new Set(this.byName.keys())
  }

  private addEntry(info: TagInfo): void {
    const entry: Entry = { info, lower: info.display.toLowerCase() }
    this.entries.push(entry)
    this.byName.set(info.name, entry)
    const len = info.name.length
    if (!this.byLength.has(len)) {
      this.byLength.set(len, [])
    }
    this.byLength.get(len)!.push(entry)
  }

  private zhOf(name: string, fallback?: string): string | undefined {
    return this.zhUser[name] ?? this.zhAi[name] ?? this.zhCommunity[name] ?? fallback
  }

  private applyTranslations(): void {
    let cacheDirty = false
    for (const entry of this.entries) {
      const builtin =
        entry.info.category === 100
          ? NAI_TAGS.find((tagDefinition) => normalizeTag(tagDefinition.name) === entry.info.name)
              ?.zh
          : undefined
      entry.info.zh = this.zhOf(entry.info.name, builtin)
      if (entry.info.zh) {
        let py = this.pyCache[entry.info.zh]
        if (!py) {
          const text = pinyin(entry.info.zh, {
            toneType: 'none',
            type: 'array',
            nonZh: 'removed',
          }) as string[]
          py = [text.join(''), text.map((text2) => text2[0] ?? '').join('')]
          this.pyCache[entry.info.zh] = py
          this.pyMine[entry.info.zh] = py
          cacheDirty = true
        }
        entry.py = py[0]
        entry.pyInit = py[1]
      } else {
        entry.pyInit = undefined
        entry.py = undefined
      }
    }
    if (cacheDirty) {
      writeFileSync(dataFile('pinyin-cache.json'), JSON.stringify(this.pyMine), 'utf8')
    }
  }

  status(): DbStatus {
    const zhCount = this.entries.filter((entry) => entry.info.zh).length
    return {
      loaded: this.loaded,
      tagCount: this.entries.length,
      aliasCount: this.aliases.size,
      zhCount,
      implicationCount: this.implicationCount,
      fetchedAt: this.meta.fetchedAt,
      minCount: this.meta.minCount,
      source: this.meta.source,
    }
  }

  get(name: string): TagInfo | undefined {
    return this.byName.get(normalizeTag(name))?.info
  }

  /** 精确查找：返回标准 tag 或别名指向的 tag */
  lookup(core: string): { tag?: TagInfo; aliasOf?: TagInfo } {
    const normalizedTag = normalizeTag(core)
    const hit = this.byName.get(normalizedTag)
    if (hit) {
      return { tag: hit.info }
    }
    const target = this.aliases.get(normalizedTag)
    if (target) {
      const entry = this.byName.get(target)
      if (entry) {
        return { aliasOf: entry.info }
      }
    }
    if (YEAR_TAG_RE.test(core.trim().toLowerCase())) {
      return {
        tag: {
          name: normalizedTag,
          display: core.trim(),
          category: 100,
          count: 0,
          zh: `年份 ${core.replace(/\D/g, '')}`,
        },
      }
    }
    return {}
  }

  search(opts: SearchOptions): SearchHit[] {
    const text = opts.query.trim().toLowerCase()
    if (!text) {
      return []
    }
    const limit = opts.limit ?? 60
    const cats = opts.categories?.length ? new Set(opts.categories) : null
    const qSpace = text.replace(/_/g, ' ')
    const isZh = HAS_ZH.test(text)
    const isLetters = ASCII_LETTERS.test(text)
    const hits: SearchHit[] = []
    const seen = new Set<string>()

    for (const entry of this.entries) {
      if (cats && !cats.has(entry.info.category)) {
        continue
      }
      let s = 0
      if (isZh) {
        const zh = entry.info.zh
        if (zh) {
          if (zh === text) {
            s = 1000
          } else if (zh.startsWith(text)) {
            s = 600
          } else if (zh.includes(text)) {
            s = 300
          }
        }
      } else {
        const text2 = entry.lower
        if (text2 === qSpace) {
          s = 1000
        } else if (text2.startsWith(qSpace)) {
          s = 600
        } else if (text2.includes(' ' + qSpace)) {
          s = 400
        } else if (text2.includes(qSpace)) {
          s = 200
        }
        if (isLetters && entry.pyInit) {
          if (entry.pyInit === text) {
            s = Math.max(s, 550)
          } else if (entry.py!.startsWith(text)) {
            s = Math.max(s, 450)
          } else if (text.length >= 2 && entry.pyInit.startsWith(text)) {
            s = Math.max(s, 350)
          } else if (text.length >= 3 && entry.py!.includes(text)) {
            s = Math.max(s, 150)
          }
        }
      }
      if (s > 0) {
        hits.push({ ...entry.info, score: s + Math.log10(entry.info.count + 1) * 40 })
        seen.add(entry.info.name)
      }
    }

    if (!isZh) {
      const qUnder = normalizeTag(text)
      for (const [alias, target] of this.aliasList) {
        if (seen.has(target)) {
          continue
        }
        let s = 0
        if (alias === qUnder) {
          s = 900
        } else if (alias.startsWith(qUnder)) {
          s = 450
        }
        if (!s) {
          continue
        }
        const entry2 = this.byName.get(target)
        if (!entry2 || (cats && !cats.has(entry2.info.category))) {
          continue
        }
        hits.push({
          ...entry2.info,
          viaAlias: displayTag(alias),
          score: s + Math.log10(entry2.info.count + 1) * 40,
        })
        seen.add(target)
      }
    }

    hits.sort((searchHit, searchHit2) => searchHit2.score - searchHit.score)
    return hits.slice(0, limit)
  }

  /** 为不存在的 tag 给出候选 */
  suggest(core: string, limit = 5): TagInfo[] {
    const normalizedTag = normalizeTag(core)
    const cached = this.suggestCache.get(normalizedTag)
    if (cached) {
      return cached
    }
    const resolveMax = () => {
      if (normalizedTag.length <= 4) {
        return 1
      }
      if (normalizedTag.length <= 8) {
        return 2
      }
      return 3
    }
    const max = resolveMax()
    const scored: { info: TagInfo; s: number }[] = []
    for (let len = normalizedTag.length - max; len <= normalizedTag.length + max; len++) {
      for (const entry of this.byLength.get(len) ?? []) {
        const fallback = levenshtein(normalizedTag, entry.info.name, max)
        if (fallback <= max) {
          scored.push({
            info: entry.info,
            s: 1000 - fallback * 300 + Math.log10(entry.info.count + 1) * 30,
          })
        }
      }
    }
    for (const searchHit of this.search({ query: core, limit: 10 })) {
      if (!scored.some((rankedMatch) => rankedMatch.info.name === searchHit.name)) {
        scored.push({ info: searchHit, s: searchHit.score * 0.5 })
      }
    }
    const res = scored
      .sort((leftMatch, rightMatch) => rightMatch.s - leftMatch.s)
      .slice(0, limit)
      .map((rankedMatch) => rankedMatch.info)
    this.suggestCache.set(normalizedTag, res)
    return res
  }

  setTranslation(name: string, zh: string): void {
    const normalizedTag = normalizeTag(name)
    if (zh.trim()) {
      this.zhUserMine[normalizedTag] = zh.trim()
      this.zhUser[normalizedTag] = zh.trim()
    } else {
      delete this.zhUserMine[normalizedTag]
      delete this.zhUser[normalizedTag]
    }
    writeFileSync(dataFile('zh-user.json'), JSON.stringify(this.zhUserMine), 'utf8')
    this.applyTranslations()
  }

  untranslated(minCount: number): TagInfo[] {
    return this.entries
      .filter(
        (entry) => !entry.info.zh && entry.info.count >= minCount && entry.info.category !== 1,
      )
      .map((entry) => entry.info)
  }

  addAiTranslations(map: Record<string, string>): void {
    Object.assign(this.zhAiMine, map)
    Object.assign(this.zhAi, map)
    writeFileSync(dataFile('zh-ai.json'), JSON.stringify(this.zhAiMine), 'utf8')
  }

  refreshTranslations(): void {
    this.applyTranslations()
  }
}

export const tagStore = new TagStore()
