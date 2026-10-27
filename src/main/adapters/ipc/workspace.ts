import { dialog } from 'electron'
import type { NaiGenParams, NaiVersion } from '../../../shared/generation/types'
import type { InpaintDraft } from '../../../shared/prompts/types'
import type { PageAction } from '../../../shared/workspace/model'
import {
  cleanRemovedPageImages,
  clearPageImage,
  deletePageWithImages,
} from '../../modules/workspace/image-cleanup'
import { listPages } from '../../modules/workspace/queries'
import { listRemovedPages, readPage, restorePage } from '../../modules/workspace/repository'
import { createPage, editPage, importPage } from '../../modules/workspace/service'
import { recoverPageImage } from '../../modules/workspace/versions'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerWorkspaceIpc(context: IpcContext): void {
  const { send, notifyAppChanged } = context

  handle('pages:removed', () => {
    return listRemovedPages()
  })

  handle('pages:restore', (_e, token: string) => {
    return restorePage(token)
  })

  handle('pages:recover-image', async (_e, id: string, revision: number, versionId: string) => {
    const win = context.getWindow()

    if (!win) {
      return null
    }
    const result = await dialog.showOpenDialog(win, {
      title: '恢复原始图片',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      properties: ['openFile'],
    })
    return result.canceled || !result.filePaths[0]
      ? null
      : recoverPageImage(id, revision, versionId, result.filePaths[0])
  })

  handle('pages:list', () => {
    return listPages()
  })

  handle('pages:delete', async (_e, id: string, revision: number) => {
    try {
      await deletePageWithImages(id, revision)
    } finally {
      send('gallery:changed', null)
      notifyAppChanged()
    }
  })

  handle('pages:clear-image', async (_e, id: string, revision: number, versionId: string) => {
    try {
      return await clearPageImage(id, revision, versionId)
    } finally {
      send('gallery:changed', null)
      notifyAppChanged()
    }
  })

  handle('pages:cleanup-removed-images', async () => {
    try {
      return await cleanRemovedPageImages()
    } finally {
      send('gallery:changed', null)
      notifyAppChanged()
    }
  })

  handle('pages:read', (_e, id: string) => {
    return readPage(id)
  })

  handle(
    'pages:create',
    (_e, image: string | null, params: NaiGenParams, model: NaiVersion, draft: InpaintDraft) => {
      return createPage(image, params, model, draft)
    },
  )

  handle(
    'pages:import',
    async (_e, params: NaiGenParams, model: NaiVersion, draft: InpaintDraft) => {
      const win = context.getWindow()

      if (!win) {
        return null
      }
      const result = await dialog.showOpenDialog(win, {
        title: '导入创作会话图片',
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        properties: ['openFile'],
      })
      return result.canceled || !result.filePaths[0]
        ? null
        : importPage(result.filePaths[0], params, model, draft)
    },
  )

  handle('pages:edit', (_e, id: string, revision: number, action: PageAction) => {
    return editPage(id, revision, action)
  })
}
