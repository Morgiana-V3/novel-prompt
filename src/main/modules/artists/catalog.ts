import type {
  ArtistCatalogPage,
  ArtistCatalogQuery,
  ArtistCatalogSource,
  ArtistReference,
} from '../../../shared/artists/catalog'
import { artistCatalogGallery, artistNameKey } from '../../../shared/artists/catalog'
import { isNaiVersion, type NaiVersion } from '../../../shared/generation/types'
import { parsePrompt } from '../../../shared/prompts/parser'
import { fetchNaxCatalog } from '../../providers/nax'
import { fetchArtistCodex } from '../../providers/quicktagcloud'

interface CatalogData {
  entries: ArtistReference[]
  updated: string
}

const cache = new Map<string, { expires: number; data: Promise<CatalogData> }>()
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

export function normalizeNaxCatalog(value: unknown, version: NaiVersion): CatalogData {
  const data = record(value)
  const galleryId = artistCatalogGallery(version)
  const gallery = record(record(data.galleries)[galleryId])
  if (!Array.isArray(gallery.tags) || gallery.version !== version) {
    throw new Error(`NAX 图鉴没有有效的 ${version.toUpperCase()} 词条数据`)
  }
  const entries: ArtistReference[] = []
  const names = new Set<string>()
  for (const raw of gallery.tags) {
    const entry = record(raw)
    if (
      typeof entry.tag !== 'string' ||
      entry.tag.length > 200 ||
      typeof entry.filename !== 'string' ||
      entry.filename.length > 600
    ) {
      continue
    }
    const name = entry.tag.trim()
    const tags = `artist:${name}`
    const artists = parsePrompt(tags)
    if (
      artists.length !== 1 ||
      artists[0].prefix !== 'artist:' ||
      artists[0].core !== name ||
      names.has(artistNameKey(name))
    ) {
      continue
    }
    const filename = entry.filename
    if (
      !/\.(webp|png|jpe?g)$/i.test(filename) ||
      filename.includes('..') ||
      /[\\/:\x00-\x1f]/.test(filename)
    ) {
      continue
    }
    names.add(artistNameKey(name))
    entries.push({
      id: `nax:${galleryId}:${name}`,
      name,
      title: name,
      tags,
      // Export filenames contain literal percent signs, as on NAX's own image links.
      image: `https://cdn.zele.st/data/NAX/Images/${galleryId}/${encodeURIComponent(filename)}`,
      source: `NAX · ${version.toUpperCase()} · 固定提示词例图`,
    })
  }
  if (!entries.length) {
    throw new Error('NAX 图鉴没有可用的画师例图')
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const metadata = record(data.metadata)
  return {
    entries,
    updated: typeof metadata.generated_at === 'string' ? metadata.generated_at : '',
  }
}

function load(version: NaiVersion, source: ArtistCatalogSource): Promise<CatalogData> {
  // Only the two validated sources × two model versions can enter this cache.
  const key = `${source}:${version}`
  const existing = cache.get(key)
  if (existing && existing.expires > Date.now()) {
    return existing.data
  }
  const data =
    source === 'nax'
      ? fetchNaxCatalog().then((value) => normalizeNaxCatalog(value, version))
      : fetchArtistCodex(version).then((value) => normalizeArtistCodex(value, version))
  cache.set(key, { data, expires: Date.now() + 3600000 })
  void data.catch(() => {
    if (cache.get(key)?.data === data) {
      cache.delete(key)
    }
  })
  return data
}

export async function queryArtistCatalog(input: ArtistCatalogQuery): Promise<ArtistCatalogPage> {
  if (
    !input ||
    !isNaiVersion(input.version) ||
    (input.source !== undefined && input.source !== 'codex' && input.source !== 'nax') ||
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
  const source = input.source ?? 'codex'
  const data = await load(input.version, source)
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
    source,
    entries: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: matches.length,
    page,
    pageSize: PAGE_SIZE,
    version: input.version,
    updated: data.updated,
  }
}
