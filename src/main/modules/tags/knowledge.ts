import { net } from 'electron'
import { writeFileAtomic as writeFileSync } from '../../infrastructure/atomic-file'
import { dataFile } from '../../infrastructure/paths'
import { DANBOORU } from './fetcher'
import { readUser } from './layers'
import { displayTag, normalizeTag, tagStore } from './store'

/**
 * Danbooru 统计知识：共现（related tags）与 wiki 释义。
 * NAI 用 Danbooru 的图和标签训练，这些统计是「模型学到了什么」最好的近似。
 * 在线查询，结果缓存到 userData/data/knowledge-cache.json；离线时返回 null，由调用方降级。
 */

const UA = 'novel-prompt/0.1 (desktop tag tool)'
const CACHE_FILE = 'knowledge-cache.json'
const TTL = 30 * 24 * 3600 * 1000
const TIMEOUT = 10_000
const CONCURRENCY = 3
/** Danbooru 帖子总量的近似值，用于估算一个 tag 的基础出现率（只影响「特征性」排序，不需要很精确） */
const TOTAL_POSTS = 10_000_000

export interface RelatedItem {
  name: string
  display: string
  category: number
  count: number
  zh?: string
  /** 在查询 tag 的图中出现的比例 0~1 */
  freq: number
  /** 相对全站基础出现率的倍数，越大越是该 tag 的「特征」 */
  lift: number
}

export interface Related {
  name: string
  display: string
  category: number
  postCount: number
  items: RelatedItem[]
}

export interface Wiki {
  name: string
  text: string
  otherNames: string[]
}

interface CacheEntry<T> {
  at: number
  data: T | null
}
interface Cache {
  related: Record<string, CacheEntry<Related>>
  wiki: Record<string, CacheEntry<Wiki>>
}

let cache: Cache | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined

function getCache(): Cache {
  if (!cache) {
    const storedCache = readUser<Partial<Cache>>(CACHE_FILE)
    cache = { related: storedCache?.related ?? {}, wiki: storedCache?.wiki ?? {} }
  }
  return cache
}

function scheduleSave(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      writeFileSync(dataFile(CACHE_FILE), JSON.stringify(getCache()), 'utf8')
    } catch {
      /* 缓存写入失败不影响功能 */
    }
  }, 500)
}

class NotFound extends Error {}

/**
 * 连不上 Danbooru（离线、被墙、超时）时短期熔断：之后 5 分钟内直接走缓存 / 降级，
 * 不再让每次 AI 优化、画面推测都先白等 10 秒以上的超时。
 */
const OFFLINE_MS = 5 * 60 * 1000
let offlineUntil = 0
export const danbooruOffline = () => Date.now() < offlineUntil

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT)
  let res: Response
  try {
    res = await net.fetch(url, {
      headers: { 'User-Agent': UA },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (error) {
    if (!signal?.aborted) {
      offlineUntil = Date.now() + OFFLINE_MS
    }
    throw error
  }
  if (res.status === 404) {
    throw new NotFound()
  }
  // 被拦截（403）或限流（429）同样短期不再请求
  if (res.status === 403 || res.status === 429) {
    offlineUntil = Date.now() + OFFLINE_MS
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

async function cached<K extends keyof Cache>(
  kind: K,
  name: string,
  load: () => Promise<NonNullable<Cache[K][string]['data']>>,
): Promise<{ data: Cache[K][string]['data']; ok: boolean }> {
  const store = getCache()[kind] as Record<string, CacheEntry<unknown>>
  const hit = store[name]
  if (hit && Date.now() - hit.at < TTL) {
    return { data: hit.data as Cache[K][string]['data'], ok: true }
  }
  // 熔断期间不联网：有过期缓存先用着，没有就按离线降级
  if (danbooruOffline()) {
    return { data: (hit?.data ?? null) as Cache[K][string]['data'], ok: !!hit }
  }
  try {
    const data = await load()
    store[name] = { at: Date.now(), data }
    scheduleSave()
    return { data, ok: true }
  } catch (error) {
    if (error instanceof NotFound) {
      store[name] = { at: Date.now(), data: null }
      scheduleSave()
      return { data: null, ok: true }
    }
    // 用户取消要向上抛；超时（TimeoutError）和网络错误按离线处理
    if ((error as Error)?.name === 'AbortError') {
      throw error
    }
    // 有过期缓存就先用着
    return { data: (hit?.data ?? null) as Cache[K][string]['data'], ok: !!hit }
  }
}

/* ---------- 共现 ---------- */

interface RawRelated {
  post_count?: number
  tag?: { name: string; category: number; post_count: number }
  related_tags?: {
    tag: { name: string; category: number; post_count: number }
    frequency?: number
    overlap_coefficient?: number
  }[]
}

async function loadRelated(name: string, signal?: AbortSignal): Promise<Related> {
  const qs = new URLSearchParams({
    'search[query]': name,
    'search[category]': 'general',
    limit: '80',
  })
  const raw = await getJson<RawRelated>(`${DANBOORU}/related_tag.json?${qs}`, signal)
  const self = tagStore.get(name)
  const items: RelatedItem[] = (raw.related_tags ?? [])
    .filter((tag) => tag?.tag?.name && tag.tag.name !== name)
    .map((tag) => {
      const freq = tag.frequency ?? tag.overlap_coefficient ?? 0
      const base = Math.max(tag.tag.post_count, 1) / TOTAL_POSTS
      return {
        name: tag.tag.name,
        display: displayTag(tag.tag.name),
        category: tag.tag.category,
        count: tag.tag.post_count,
        zh: tagStore.get(tag.tag.name)?.zh,
        freq: Math.round(freq * 1000) / 1000,
        lift: Math.round((freq / base) * 10) / 10,
      }
    })
  return {
    name,
    display: self?.display ?? displayTag(name),
    category: raw.tag?.category ?? self?.category ?? 0,
    postCount: raw.post_count ?? raw.tag?.post_count ?? self?.count ?? 0,
    items,
  }
}

export interface Lookup<T> {
  results: Map<string, T | null>
  /** 因网络问题没拿到数据的 tag */
  failed: string[]
}

async function batch<T>(
  names: string[],
  one: (text: string) => Promise<{ data: T | null; ok: boolean }>,
): Promise<Lookup<T>> {
  const uniq = [...new Set(names.map(normalizeTag).filter(Boolean))]
  const results = new Map<string, T | null>()
  const failed: string[] = []
  let i = 0
  const worker = async () => {
    while (i < uniq.length) {
      const text = uniq[i++]
      const { data, ok } = await one(text)
      results.set(text, data)
      if (!ok) {
        failed.push(text)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, uniq.length) }, worker))
  return { results, failed }
}

export function relatedTags(names: string[], signal?: AbortSignal): Promise<Lookup<Related>> {
  return batch(names, (text) => cached('related', text, () => loadRelated(text, signal)))
}

/** 署名、水印、网址这类与画面内容无关的 tag，不作为特征 */
const NOISE_RE =
  /(_username|_name|_logo)$|^(signature|watermark|web_address|dated|logo|artist_logo|copyright|commentary.*|translated|.*_request|.*_commentary)$/

/** 角色的默认外观：在该角色的图里经常出现、且明显比全站常见的通用 tag */
export function traitsOf(relatedTagsResult: Related, limit = 16): RelatedItem[] {
  return relatedTagsResult.items
    .filter(
      (relatedTag) =>
        relatedTag.category === 0 &&
        !NOISE_RE.test(relatedTag.name) &&
        relatedTag.freq >= 0.3 &&
        relatedTag.lift >= 1.5,
    )
    .slice(0, limit)
}

/** 画师 / 作品的倾向：出现率不一定很高，但明显比全站常见 */
export function tendenciesOf(relatedTagsResult: Related, limit = 14): RelatedItem[] {
  return relatedTagsResult.items
    .filter(
      (relatedTag) =>
        relatedTag.category === 0 &&
        !NOISE_RE.test(relatedTag.name) &&
        relatedTag.freq >= 0.15 &&
        relatedTag.lift >= 2,
    )
    .sort(
      (relatedTag, relatedTag2) =>
        relatedTag2.freq * Math.log(relatedTag2.lift) - relatedTag.freq * Math.log(relatedTag.lift),
    )
    .slice(0, limit)
}

const pct = (pixelValue: number) => `${Math.round(pixelValue * 100)}%`
export const fmtItem = (relatedTag: RelatedItem) =>
  `${relatedTag.display} ${pct(relatedTag.freq)}${relatedTag.zh ? `（${relatedTag.zh}）` : ''}`

/* ---------- wiki ---------- */

/** DText → 纯文本，只保留定义部分 */
function cleanDText(raw: string): string {
  const body = raw.replace(/\r\n?/g, '\n')
  const cut = body.search(/^h\d\.\s*(see also|related|external links|tags?|examples?|notes?)\b/im)
  const head = cut > 0 ? body.slice(0, cut) : body
  return head
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{([^}]+)\}\}/g, '$1')
    .replace(/"([^"]+)":\[?[^\s\]]+\]?/g, '$1')
    .replace(/\[\/?(b|i|u|s|tn|spoiler|quote|expand[^\]]*|code|nodtext)\]/gi, '')
    .replace(/^h\d\.\s*/gm, '')
    .replace(/^\*+\s*/gm, '- ')
    .replace(/!(post|asset) #\d+/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

async function loadWiki(name: string, signal?: AbortSignal): Promise<Wiki> {
  const raw = await getJson<{ body?: string; other_names?: string[]; is_deleted?: boolean }>(
    `${DANBOORU}/wiki_pages/${encodeURIComponent(name)}.json`,
    signal,
  )
  if (raw.is_deleted || !raw.body?.trim()) {
    throw new NotFound()
  }
  const text = cleanDText(raw.body)
  return {
    name,
    text: text.length > 360 ? text.slice(0, 360) + '…' : text,
    otherNames: (raw.other_names ?? []).slice(0, 6),
  }
}

export function tagWiki(names: string[], signal?: AbortSignal): Promise<Lookup<Wiki>> {
  return batch(names, (text) => cached('wiki', text, () => loadWiki(text, signal)))
}
