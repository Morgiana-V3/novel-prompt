import { net } from 'electron'
import { writeFileSync } from 'node:fs'
import type { UpdateProgress } from '../../shared/types'
import { dataFile } from '../paths'

const UA = 'novel-prompt/0.1 (desktop tag tool)'
export const DANBOORU = 'https://danbooru.donmai.us'
const COMMUNITY_ZH_URLS = [
  'https://raw.githubusercontent.com/byzod/a1111-sd-webui-tagcomplete-CN/main/tags/Tags-zh-full-pack.csv'
]

type Progress = (p: UpdateProgress) => void

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getText(url: string, retries = 5): Promise<string> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      const res = await net.fetch(url, { headers: { 'User-Agent': UA } })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return await res.text()
    } catch (e) {
      lastErr = e
      await sleep(1000 * 2 ** i)
    }
  }
  throw lastErr
}

/** [name, category, count] */
export type RawTag = [string, number, number]

async function fetchTags(minCount: number, onProgress: Progress): Promise<RawTag[]> {
  const out: RawTag[] = []
  let cursor = 999_999_999
  for (;;) {
    const qs = new URLSearchParams({
      limit: '1000',
      page: `b${cursor}`,
      'search[post_count]': `>=${minCount}`,
      'search[is_deprecated]': 'false',
      only: 'id,name,category,post_count'
    })
    const list = JSON.parse(await getText(`${DANBOORU}/tags.json?${qs}`)) as {
      id: number
      name: string
      category: number
      post_count: number
    }[]
    if (!list.length) break
    for (const t of list) out.push([t.name, t.category, t.post_count])
    cursor = Math.min(...list.map((t) => t.id))
    onProgress({ stage: 'tags', message: `已获取 ${out.length} 个 tag`, current: out.length })
    await sleep(250)
  }
  return out
}

async function fetchAliases(valid: Set<string>, onProgress: Progress): Promise<[string, string][]> {
  const out: [string, string][] = []
  let cursor = 999_999_999
  let scanned = 0
  for (;;) {
    const qs = new URLSearchParams({
      limit: '1000',
      page: `b${cursor}`,
      'search[status]': 'active',
      only: 'id,antecedent_name,consequent_name'
    })
    const list = JSON.parse(await getText(`${DANBOORU}/tag_aliases.json?${qs}`)) as {
      id: number
      antecedent_name: string
      consequent_name: string
    }[]
    if (!list.length) break
    scanned += list.length
    for (const a of list) {
      if (valid.has(a.consequent_name)) out.push([a.antecedent_name, a.consequent_name])
    }
    cursor = Math.min(...list.map((a) => a.id))
    onProgress({ stage: 'aliases', message: `已扫描 ${scanned} 条别名，保留 ${out.length} 条`, current: scanned })
    await sleep(250)
  }
  return out
}

function parseCsv(text: string, into: Record<string, string>): void {
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(',')
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim().replace(/^"|"$/g, '').toLowerCase().replace(/ /g, '_')
    const zh = line
      .slice(idx + 1)
      .split(',')[0]
      .trim()
      .replace(/^"|"$/g, '')
    if (name && zh && !(name in into)) into[name] = zh
  }
}

async function fetchCommunityZh(onProgress: Progress): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const url of COMMUNITY_ZH_URLS) {
    onProgress({ stage: 'translations', message: `下载社区中文翻译：${url.split('/').pop()}` })
    try {
      parseCsv(await getText(url), out)
    } catch (e) {
      onProgress({ stage: 'translations', message: `翻译源下载失败（已跳过）：${String(e)}` })
    }
  }
  return out
}

/**
 * 包含关系（tag implication）：antecedent 必然意味着 consequent，例如 white_thighhighs → thighhighs。
 * 只保留两端都在本地库中的条目。
 */
async function fetchImplications(valid: Set<string>, onProgress: Progress, signal?: AbortSignal): Promise<[string, string][]> {
  const out: [string, string][] = []
  let cursor = 999_999_999
  let scanned = 0
  for (;;) {
    if (signal?.aborted) throw new Error('已取消')
    const qs = new URLSearchParams({
      limit: '1000',
      page: `b${cursor}`,
      'search[status]': 'active',
      only: 'id,antecedent_name,consequent_name'
    })
    const list = JSON.parse(await getText(`${DANBOORU}/tag_implications.json?${qs}`)) as {
      id: number
      antecedent_name: string
      consequent_name: string
    }[]
    if (!list.length) break
    scanned += list.length
    for (const a of list) {
      if (valid.has(a.antecedent_name) && valid.has(a.consequent_name)) out.push([a.antecedent_name, a.consequent_name])
    }
    cursor = Math.min(...list.map((a) => a.id))
    onProgress({ stage: 'implications', message: `已扫描 ${scanned} 条包含关系，保留 ${out.length} 条`, current: scanned })
    await sleep(250)
  }
  return out
}

/** 只下载包含关系（不重新下载 tag），用于内置数据缺少该文件时补齐 */
export async function updateImplications(valid: Set<string>, onProgress: Progress, signal?: AbortSignal): Promise<number> {
  const list = await fetchImplications(valid, onProgress, signal)
  writeFileSync(dataFile('implications.json'), JSON.stringify(list), 'utf8')
  return list.length
}

export async function updateTagDatabase(minCount: number, onProgress: Progress): Promise<void> {
  const tags = await fetchTags(minCount, onProgress)
  const valid = new Set(tags.map((t) => t[0]))
  const aliases = await fetchAliases(valid, onProgress)
  const implications = await fetchImplications(valid, onProgress)
  const zh = await fetchCommunityZh(onProgress)

  writeFileSync(
    dataFile('tags.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), minCount, tags }),
    'utf8'
  )
  writeFileSync(dataFile('aliases.json'), JSON.stringify(aliases), 'utf8')
  writeFileSync(dataFile('implications.json'), JSON.stringify(implications), 'utf8')
  writeFileSync(dataFile('zh-community.json'), JSON.stringify(zh), 'utf8')
}
