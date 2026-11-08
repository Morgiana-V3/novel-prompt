import type { NaiVersion } from '../generation/types'

export type ArtistCatalogSource = 'codex' | 'nax'

export interface ArtistReference {
  id: string
  name: string
  title: string
  tags: string
  image: string
  source: string
}

export interface ArtistCatalogQuery {
  source?: ArtistCatalogSource
  version: NaiVersion
  query: string
  page: number
  favorites?: string[]
}

export interface ArtistCatalogPage {
  source: ArtistCatalogSource
  entries: ArtistReference[]
  total: number
  page: number
  pageSize: number
  version: NaiVersion
  updated: string
}

export function artistCatalogUrl(
  version: NaiVersion,
  source: ArtistCatalogSource = 'codex',
): string {
  if (source === 'nax') {
    return `https://nax.moe/?gallery=${artistCatalogGallery(version)}`
  }
  return artistCodexUrl(version)
}

export function artistCatalogGallery(version: NaiVersion): string {
  return `danbooru-artist-tags-${version}`
}

export function artistCodexUrl(version: NaiVersion): string {
  return `https://novelai.quicktagcloud.com/?c=artist_nai${version === 'v5' ? '5' : '45'}_personal`
}

export function artistTagsGalleryUrl(version: NaiVersion): string {
  return `https://tags.gallery/en/${version === 'v5' ? 'v5' : 'v4-5'}`
}

/** Published conditions of NAX's constrained-prompt galleries; not generation defaults. */
export function artistCatalogConditions(version: NaiVersion, name: string) {
  if (version === 'v5') {
    return {
      prompt: `0.75::artist:${name} ::, white background, simple background, cowboy shot, -1.5::nipples, nude, nsfw, worst quality, bad quality, bad anatomy, blurry, very displeasing, blush, weird anatomy, wavy hair, nose piercing, bad hands, censor, duplicate, claws, abs, fish, facial tattoo::`,
      character:
        'girl, solo, looking at viewer, standing, faint smile, closed mouth, red lips, black hoodie, hood down, long sleeves, hand in pocket, blue jeans, orange hair, long hair, high ponytail, bangs, green eyes, medium breasts, midriff peek, belt, leather belt, navel, linea alba, hand on railing',
      settings: 'V5 Full · 16 步 · Guidance 4 · 质量词开启 · UC Heavy · 种子 4168358238',
    }
  }
  return {
    prompt: `artist:${name}, neutral background, white background, transparent background, cowboy shot, -1.5::nipples::`,
    character: 'girl, soft smile, red lips, hoodie, jeans, orange hair, small breasts',
    settings: 'V4.5 Full · 28 步 · Guidance 4 · 质量词开启 · UC Heavy · 种子 2710136181',
  }
}

export function artistNameKey(name: string): string {
  return name.trim().toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ')
}
