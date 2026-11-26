import { dialog, type IpcMainInvokeEvent } from 'electron'
import { basename, extname, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { handle } from './handle'
import type { IpcContext } from './context'
import {
  readCanvasFile,
  saveCanvasFile,
  snapshotFavorite,
} from '../../modules/images/canvas-project'

export function registerCanvasProjectIpc(context: IpcContext) {
  const files = new Map<string, { path: string; modified: number }>()
  const saving = new Set<string>()
  let owner = -1
  function sender(event: IpcMainInvokeEvent, tab?: string) {
    const win = context.getCanvasWindow()
    if (
      !win ||
      event.sender !== win.webContents ||
      (tab !== undefined && !/^[a-f0-9-]{36}$/.test(tab))
    ) {
      throw new Error('请在无限画布中操作项目')
    }
    if (owner !== event.sender.id) {
      files.clear()
      owner = event.sender.id
    }
    return win
  }
  const filters = [{ name: 'NovelPrompt 画布', extensions: ['npcanvas'] }]
  handle('canvas:favorite-image', (event, id) => {
    sender(event)
    return snapshotFavorite(id)
  })
  handle('canvas:project-close', (event, tab) => {
    sender(event, tab)
    files.delete(tab)
  })
  handle('canvas:project-open', async (event, tab) => {
    const win = sender(event, tab)
    const picked = await dialog.showOpenDialog(win, { filters, properties: ['openFile'] })
    if (picked.canceled || !picked.filePaths[0]) {
      return null
    }
    const path = picked.filePaths[0]
    const modified = (await stat(path)).mtimeMs
    const session = await readCanvasFile(path)
    files.set(tab, { path, modified })
    return { name: basename(path, extname(path)), session }
  })
  handle('canvas:project-save', async (event, tab, title, session, saveAs) => {
    const win = sender(event, tab)
    const previous = files.get(tab)
    let path = previous?.path
    if (!path || saveAs) {
      const picked = await dialog.showSaveDialog(win, {
        filters,
        defaultPath: path ?? basename(title) + '.npcanvas',
      })
      if (picked.canceled || !picked.filePath) {
        return null
      }
      path = picked.filePath
      if (extname(path).toLowerCase() !== '.npcanvas') {
        throw new Error('请选择 .npcanvas 扩展名')
      }
    }
    const key = resolve(path).toLowerCase()
    if (saving.has(key)) {
      throw new Error('此项目正在保存')
    }
    saving.add(key)
    try {
      if (previous?.path === path && !saveAs && (await stat(path)).mtimeMs !== previous.modified) {
        throw new Error('磁盘文件已变化，请另存为或重新打开')
      }
      await saveCanvasFile(path, session)
      files.set(tab, { path, modified: (await stat(path)).mtimeMs })
      return basename(path, extname(path))
    } finally {
      saving.delete(key)
    }
  })
}
