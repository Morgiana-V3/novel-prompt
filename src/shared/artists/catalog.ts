import type { NaiVersion } from '../generation/types'

export interface ArtistReference {
  id: string
  name: string
  title: string
  tags: string
  image: string
  source: string
}

export interface ArtistCatalogQuery {
  version: NaiVersion
  query: string
  page: number
  favorites?: string[]
}

export interface ArtistCatalogPage {
  entries: ArtistReference[]
  total: number
  page: number
  pageSize: number
  version: NaiVersion
  updated: string
}

export function artistCatalogUrl(version: NaiVersion): string {
  return `https://novelai.quicktagcloud.com/?c=artist_nai${version === 'v5' ? '5' : '45'}_personal`
}

export function artistNameKey(name: string): string {
  return name.trim().toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ')
}
