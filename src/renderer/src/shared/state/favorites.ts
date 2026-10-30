import { reactive } from 'vue'
import type { NaiImage, SavedRecipe } from '@shared/images/types'
import { toast } from '../lib/notifications'

export const favorites = reactive({
  items: [] as SavedRecipe[],
  loaded: false,
  busy: [] as string[],
})
let loading: Promise<void> | undefined
export function refreshFavorites(): Promise<void> {
  loading ??= window.api
    .recipesList()
    .then((items) => {
      favorites.items = items
      favorites.loaded = true
    })
    .finally(() => {
      loading = undefined
    })
  return loading
}
export function favoriteFor(image: NaiImage) {
  return favorites.items.find(
    (item) =>
      item.sourceImage === image.name ||
      item.sourceImages?.includes(image.name) ||
      (!!image.contentHash && image.contentHash === item.contentHash),
  )
}
export async function saveFavorite(image: NaiImage) {
  if (favorites.busy.includes(image.name)) {
    return
  }
  favorites.busy.push(image.name)
  try {
    if (loading || !favorites.loaded) {
      await refreshFavorites()
    }
    const existing = favoriteFor(image)
    if (existing) {
      toast('这张图片已收藏')
    } else {
      const item = await window.api.recipesCreate(image.name)
      favorites.items = [item, ...favorites.items.filter((other) => other.id !== item.id)]
      toast('已收藏图片与生成记录')
    }
  } finally {
    favorites.busy = favorites.busy.filter((name) => name !== image.name)
  }
}

export async function removeFavorite(item: SavedRecipe) {
  if (favorites.busy.includes(item.id)) {
    return
  }
  favorites.busy.push(item.id)
  try {
    if (loading) {
      await loading
    }
    await window.api.recipesDelete(item.id)
    favorites.items = favorites.items.filter((other) => other.id !== item.id)
    toast('已取消这张图片的收藏，来源图片保留')
  } finally {
    favorites.busy = favorites.busy.filter((id) => id !== item.id)
  }
}
