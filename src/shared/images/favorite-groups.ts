import type { SavedRecipe } from './types'

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export interface FavoriteGroup {
  key: string
  items: SavedRecipe[]
  cover: SavedRecipe
}

/** Group for browsing only: every image retains its original record and seed. */
export function groupFavorites(items: SavedRecipe[]): FavoriteGroup[] {
  const groups = new Map<string, FavoriteGroup>()
  for (const item of items) {
    const request = item.recipe.request
    // Edited images may use different source pixels even with the same request settings.
    const key =
      item.recipe.sourceKind === 'inpaint' || item.recipe.sourceKind === 'img2img'
        ? item.id
        : canonical({
            sourceKind: item.recipe.sourceKind,
            request: { ...request, params: { ...request.params, seed: null } },
            img2img: item.img2img,
          })
    const group = groups.get(key) ?? { key, items: [], cover: item }
    group.items.push(item)
    if (!group.cover.thumbnail && item.thumbnail) {
      group.cover = item
    }
    groups.set(key, group)
  }
  return [...groups.values()]
}
