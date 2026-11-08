import type { NaiGenRequest, NaiVersion } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { creationSnapshots } from '../creation/public/navigation'

export interface ArtistBlueprint {
  kind: 'creation' | 'gallery' | 'favorite' | 'reverse'
  id: string
  title: string
  request: NaiGenRequest
  image?: NaiImage
}

export function creationBlueprints(version: NaiVersion): ArtistBlueprint[] {
  return creationSnapshots().map(({ id, title, content }) => ({
    kind: 'creation',
    id,
    title,
    request: {
      version,
      base: content.prompt,
      negative: content.negative,
      characters: content.characters,
      params: { ...content.params, ...content.gen },
    },
  }))
}

export function blueprintKey(blueprint: ArtistBlueprint): string {
  const { base, negative, characters, params } = blueprint.request
  return JSON.stringify([blueprint.id, base, negative, characters, params])
}
