import type {
  ArtistCatalogPage,
  ArtistCatalogQuery,
  ArtistReference,
} from '../../../shared/artists/catalog'
import { artistNameKey } from '../../../shared/artists/catalog'
import { isNaiVersion, type NaiVersion } from '../../../shared/generation/types'
import { parsePrompt } from '../../../shared/prompts/parser'
import { fetchArtistCodex } from '../../providers/quicktagcloud'

interface CatalogData {
  entries: ArtistReference[]
  updated: string
}

const cache = new Map<NaiVersion, { expires: number; data: Promise<CatalogData> }>()
const PAGE_SIZE = 24

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function normalizeArtistCodex(value: unknown, version: NaiVersion): CatalogData {
  const data = record(value)
  if (!Array.isArray(data.entries)) {
    throw new Error('图鉴没有有效的词条数据')
  }
  const entries: ArtistReference[] = []
  const codex = `artist_nai${version === 'v5' ? '5' : '45'}_personal`
  for (const raw of data.entries) {
    const entry = record(raw)
    if (
      (entry.rating !== undefined && entry.rating !== 'safe') ||
      typeof entry.tags !== 'string' ||
      typeof entry.image !== 'string'
    ) {
      continue
    }
    const artists = parsePrompt(entry.tags).filter((token) => token.prefix === 'artist:')
    if (artists.length !== 1 || !artists[0].core || typeof entry.id !== 'string') {
      continue
    }
    const image = entry.image
    const assetCodex = typeof entry.assetCodexId === 'string' ? entry.assetCodexId : codex
    if (!/^[\w-]+$/.test(assetCodex) || image.includes('..') || /[\\/:]/.test(image)) {
      continue
    }
    entries.push({
      id: entry.id,
      name: artists[0].core,
      title: typeof entry.title === 'string' ? entry.title : artists[0].core,
      tags: entry.tags,
      image: `https://assets.quicktagcloud.com/images/${assetCodex}/${encodeURIComponent(image)}`,
      source: Array.isArray(entry.path)
        ? entry.path.filter((part) => typeof part === 'string').join(' / ')
        : '',
    })
  }
  return { entries, updated: typeof data.version === 'string' ? data.version : '' }
}

function load(version: NaiVersion): Promise<CatalogData> {
  const existing = cache.get(version)
  if (existing && existing.expires > Date.now()) {
    return existing.data
  }
  const data = fetchArtistCodex(version).then((value) => normalizeArtistCodex(value, version))
  cache.set(version, { data, expires: Date.now() + 3600000 })
  void data.catch(() => {
    if (cache.get(version)?.data === data) {
      cache.delete(version)
    }
  })
  return data
}

export async function queryArtistCatalog(input: ArtistCatalogQuery): Promise<ArtistCatalogPage> {
  if (
    !input ||
    !isNaiVersion(input.version) ||
    typeof input.query !== 'string' ||
    input.query.length > 200 ||
    !Number.isInteger(input.page) ||
    input.page < 1
  ) {
    throw new Error('无效的图鉴查询')
  }
  if (
    input.favorites &&
    (!Array.isArray(input.favorites) ||
      input.favorites.length > 100 ||
      input.favorites.some((name) => typeof name !== 'string'))
  ) {
    throw new Error('无效的收藏筛选')
  }
  const data = await load(input.version)
  const normalize = artistNameKey
  const search = normalize(input.query.trim())
  const favorites = input.favorites ? new Set(input.favorites.map(normalize)) : null
  const matches = data.entries.filter(
    (entry) =>
      (!search || normalize(`${entry.name} ${entry.title} ${entry.tags}`).includes(search)) &&
      (!favorites || favorites.has(normalize(entry.name))),
  )
  const page = Math.min(input.page, Math.max(1, Math.ceil(matches.length / PAGE_SIZE)))
  return {
    entries: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: matches.length,
    page,
    pageSize: PAGE_SIZE,
    version: input.version,
    updated: data.updated,
  }
}
