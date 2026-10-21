import { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { AiOptimizeRequest, SearchOptions, Settings } from '../shared/types'
import { tagStore } from './tagdb/store'
import { updateTagDatabase } from './tagdb/fetcher'
import { analyzePrompt } from './prompt/analyzer'
import { getSettings, saveSettings } from './settings'
import { optimizePrompt } from './ai/optimizer'
import { aiTranslate } from './ai/translator'
import { skillPath } from './paths'

let win: BrowserWindow | null = null
let busy: AbortController | null = null

const APP_ID = 'com.holyxie.novelprompt'

function appIcon(): Electron.NativeImage | undefined {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build')
  for (const name of process.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png']) {
    const p = join(base, name)
    if (existsSync(p)) return nativeImage.createFromPath(p)
  }
  return undefined
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#ffffff',
    title: 'NovelPrompt',
    icon: appIcon(),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#6b6c75', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload)

function registerIpc(): void {
  ipcMain.handle('db:status', () => tagStore.status())
  ipcMain.handle('db:update', async () => {
    if (busy) throw new Error('已有任务在运行')
    busy = new AbortController()
    try {
      await updateTagDatabase(getSettings().minPostCount, (p) => send('progress', p))
      send('progress', { stage: 'index', message: '正在构建索引…' })
      tagStore.load()
      send('progress', { stage: 'done', message: '数据更新完成' })
      return tagStore.status()
    } catch (e) {
      send('progress', { stage: 'error', message: String(e) })
      throw e
    } finally {
      busy = null
    }
  })
  ipcMain.handle('db:aiTranslate', async () => {
    if (busy) throw new Error('已有任务在运行')
    busy = new AbortController()
    try {
      await aiTranslate(getSettings().translateMinCount, (p) => send('progress', p), busy.signal)
      return tagStore.status()
    } catch (e) {
      send('progress', { stage: 'error', message: String(e) })
      throw e
    } finally {
      busy = null
    }
  })
  ipcMain.handle('task:cancel', () => busy?.abort())

  ipcMain.handle('tag:search', (_e, opts: SearchOptions) => tagStore.search(opts))
  ipcMain.handle('tag:setZh', (_e, name: string, zh: string) => tagStore.setTranslation(name, zh))
  ipcMain.handle('prompt:analyze', (_e, text: string) => analyzePrompt(text, getSettings().naiVersion))

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => saveSettings(patch))

  ipcMain.handle('ai:optimize', async (_e, req: AiOptimizeRequest) => {
    const ctrl = new AbortController()
    busy = busy ?? ctrl
    try {
      return await optimizePrompt(req, (step) => send('ai:step', step), ctrl.signal)
    } finally {
      if (busy === ctrl) busy = null
    }
  })

  ipcMain.handle('skill:open', () => shell.openPath(skillPath()))
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
}

app.whenReady().then(() => {
  // 让 Windows 任务栏 / Alt+Tab 使用窗口图标，而不是 electron.exe 的默认图标
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
  tagStore.load()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
