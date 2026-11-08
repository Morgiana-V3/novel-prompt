import { queryArtistCatalog } from '../../modules/artists/catalog'
import { app, clipboard, ClipboardItem, dialog, shell } from 'electron'
import { copyFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileAtomic } from '../../infrastructure/atomic-file'
import type { NaiGenParams, NaiSubscription, NaiVersion } from '../../../shared/generation/types'
import { freeCheck } from '../../modules/generation/costs'
import { getSubscription } from '../../modules/generation/service'
import { imagePath, listImages } from '../../modules/images/access'
import {
  clearTemporaryImages,
  imageLibraryDir,
  imageBytesWithRecipe,
  readImageRecipe,
  retainImage,
  temporaryCleanupStatus,
} from '../../modules/images/library'
import {
  favoriteImagePath,
  createConfigRecipe,
  createRecipe,
  createWorkspaceRecipe,
  deleteRecipe,
  listRecipes,
  updateRecipe,
} from '../../modules/images/recipes'
import { deleteUnreferencedImage } from '../../modules/workspace/image-cleanup'
import type { IpcContext } from './context'
import { handle } from './handle'
import { imageCollections } from '../../modules/images/collections'

export function registerImagesIpc(context: IpcContext): void {
  const { send, notifyAppChanged } = context
  handle('artists:catalog', (_event, query) => queryArtistCatalog(query))
  const collectionsChanged = () => {
    send('gallery:changed', null)
    notifyAppChanged()
  }
  handle('collections:list', () => imageCollections.list())
  handle('collections:create', (_e, name) => {
    const item = imageCollections.create(name)
    collectionsChanged()
    return item
  })
  handle('collections:rename', (_e, id, name) => {
    imageCollections.rename(id, name)
    collectionsChanged()
  })
  handle('collections:delete', (_e, id) => {
    imageCollections.remove(id)
    collectionsChanged()
  })
  handle('collections:assign', (_e, names, id) => {
    if (!Array.isArray(names) || names.some((name) => !imagePath(name))) {
      throw new Error('部分图片已不存在，请刷新图库')
    }
    imageCollections.assign(names, id)
    collectionsChanged()
  })

  /* ---------- NovelAI 生图 ---------- */
  handle('nai:subscription', () => {
    return getSubscription()
  })

  handle(
    'nai:freeCheck',
    (_e, params: NaiGenParams, version: NaiVersion, sub?: NaiSubscription) => {
      return freeCheck(params, version, sub)
    },
  )

  handle('nai:list', () => {
    return listImages(10000)
  })

  handle('nai:retain', (_e, name: string) => {
    try {
      return retainImage(name)
    } finally {
      // 留存状态变了：图集管理的「临时 / 已留存」筛选需要刷新
      send('gallery:changed', null)
      notifyAppChanged()
    }
  })

  handle('nai:recipe', (_e, name: string) => {
    return readImageRecipe(name)
  })

  handle('recipes:list', () => {
    return listRecipes()
  })
  handle('recipes:export', async (_e, id) => {
    const src = favoriteImagePath(id)
    const win = context.getWindow()
    if (!src || !win) {
      throw new Error('收藏原图不存在')
    }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `favorite-${id}.png`,
      filters: [{ name: 'PNG 图片（含生成记录）', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) {
      return false
    }
    copyFileSync(src, result.filePath)
    return true
  })

  handle('recipes:create', (_e, name: string) => {
    return createRecipe(name)
  })

  handle('recipes:config', (_e, request) => {
    return createConfigRecipe(request)
  })

  handle('recipes:workspace', (_e, id: string, versionId: string) => {
    return createWorkspaceRecipe(id, versionId)
  })

  handle('images:cleanup-status', () => {
    return temporaryCleanupStatus()
  })

  handle('images:cleanup-retry', () => {
    const status = clearTemporaryImages(false)
    send('gallery:changed', null)
    return status
  })

  handle('recipes:update', (_e, id, patch) => {
    return updateRecipe(id, patch)
  })

  handle('recipes:delete', (_e, id: string) => {
    return deleteRecipe(id)
  })

  // 读回图片原始字节（用于解析图里的提示词）。不走 fetch(np-img://)，避免跨源被拦
  handle('nai:readImage', (_e, name: string) => {
    const src = imagePath(name)
    if (!src) {
      throw new Error('图片不存在或已被删除')
    }
    return new Uint8Array(imageBytesWithRecipe(name))
  })

  handle('nai:saveAs', async (_e, name: string) => {
    const win = context.getWindow()

    const src = imagePath(name)
    if (!src || !win) {
      return false
    }
    const saveDialogResult = await dialog.showSaveDialog(win, {
      defaultPath: name,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    })
    if (saveDialogResult.canceled || !saveDialogResult.filePath) {
      return false
    }
    // Historical workspace recovery verifies the exact original file hash.
    copyFileSync(src, saveDialogResult.filePath)
    return true
  })

  handle('nai:copyImage', async (_e, name: string) => {
    const src = imagePath(name)
    if (!src) {
      return false
    }
    const bytes = imageBytesWithRecipe(name)
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
    // A clipboard file snapshot survives deletion/temporary-library cleanup after copying.
    const directory = join(app.getPath('temp'), 'NovelPrompt-clipboard')
    mkdirSync(directory, { recursive: true })
    const original = join(directory, `${createHash('sha256').update(bytes).digest('hex')}.png`)
    writeFileAtomic(original, bytes)
    // Image-only receivers get a compatible bitmap; file-aware receivers get the exact
    // encoded PNG, including text chunks, generation recipe and alpha-channel metadata.
    await clipboard.write([
      new ClipboardItem({
        'image/png': blob,
        'text/uri-list': new Blob([pathToFileURL(original).href + '\r\n']),
      }),
    ])
    return true
  })

  handle('nai:reveal', (_e, name?: string) => {
    const src = name ? imagePath(name) : null
    if (src) {
      shell.showItemInFolder(src)
    } else {
      shell.openPath(imageLibraryDir()).catch((error) => console.error(error))
    }
  })

  handle('nai:delete', async (_e, name: string) => {
    try {
      return await deleteUnreferencedImage(name)
    } finally {
      send('gallery:changed', null)
      notifyAppChanged()
    }
  })
}
