import { reactive } from 'vue'
import type { NaiImage, SavedRecipe } from '@shared/images/types'
import { toast } from '../lib/notifications'
import { shellState } from './shell'

export const favorites = reactive({
  items: [] as SavedRecipe[],
  loaded: false,
  busy: [] as string[],
  /** 其他页面请求在收藏页中打开的收藏 id；收藏页处理后清空 */
  focusId: '',
  /** 收藏页当前分页，其他页面可直接跳到「提示词片段」 */
  tab: 'recipes' as 'recipes' | 'snippets',
})
/** 跳转到收藏页并直接打开指定收藏 */
export function revealFavorite(id: string) {
  favorites.focusId = id
  shellState.tab = 'favorites'
}
/** 跳转到收藏页的提示词片段库 */
export function revealSnippets() {
  favorites.tab = 'snippets'
  shellState.tab = 'favorites'
}
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
      toast('这张图片已收藏', { label: '查看', run: () => revealFavorite(existing.id) })
    } else {
      const item = await window.api.recipesCreate(image.name)
      favorites.items = [item, ...favorites.items.filter((other) => other.id !== item.id)]
      toast('已收藏图片与生成记录', { label: '查看收藏', run: () => revealFavorite(item.id) })
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
