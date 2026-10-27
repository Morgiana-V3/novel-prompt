import { clipboard, ClipboardItem, dialog, shell } from 'electron'
import { copyFileSync, readFileSync } from 'node:fs'
import type { NaiGenParams, NaiSubscription, NaiVersion } from '../../../shared/generation/types'
import { freeCheck } from '../../modules/generation/costs'
import { getSubscription } from '../../modules/generation/service'
import { imagePath, listImages } from '../../modules/images/access'
import {
  clearTemporaryImages,
  imageLibraryDir,
  readImageRecipe,
  retainImage,
  temporaryCleanupStatus,
} from '../../modules/images/library'
import {
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

export function registerImagesIpc(context: IpcContext): void {
  const { send, notifyAppChanged } = context

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
    return retainImage(name)
  })

  handle('nai:recipe', (_e, name: string) => {
    return readImageRecipe(name)
  })

  handle('recipes:list', () => {
    return listRecipes()
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
    return new Uint8Array(readFileSync(src))
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
    copyFileSync(src, saveDialogResult.filePath)
    return true
  })

  handle('nai:copyImage', async (_e, name: string) => {
    const src = imagePath(name)
    if (!src) {
      return false
    }
    const blob = new Blob([readFileSync(src)], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
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
