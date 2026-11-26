import { storageRoot } from '../infrastructure/storage-root'
import { app, BrowserWindow, dialog, screen } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../infrastructure/atomic-file'
import { appWindowIcon, configureWindowIdentity } from './identity'

export function restoreWindowBounds(
  bounds: Electron.Rectangle,
  area: Electron.Rectangle,
): Electron.Rectangle {
  const width = Math.min(Math.max(bounds.width, 1100), area.width)
  const height = Math.min(Math.max(bounds.height, 700), area.height)
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
  }
}

export function createWindowManager(onClosed: () => void) {
  let win: BrowserWindow | null = null
  let canvasWindow: BrowserWindow | null = null
  let canvasLoad: Promise<void> | null = null
  const WINDOW_TITLE = app.isPackaged ? 'NovelPrompt' : 'NovelPrompt · 开发版'
  const CANVAS_TITLE = 'NovelPrompt · 无限画布'

  function createWindow(): void {
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      return
    }
    // The runtime profile is selected after the manager is constructed.
    const statePath = join(storageRoot(), 'window-state.json')
    let restored: Partial<Electron.Rectangle> = {}
    let maximized = false
    try {
      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      if (
        ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(state.bounds?.[key])) &&
        state.bounds.width > 0 &&
        state.bounds.height > 0
      ) {
        restored = restoreWindowBounds(
          state.bounds,
          screen.getDisplayMatching(state.bounds).workArea,
        )
        maximized = state.maximized === true
      }
    } catch {
      /* First launch or an unreadable preference uses the default size. */
    }
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      ...restored,
      minWidth: 1100,
      minHeight: 700,
      backgroundColor: '#ffffff',
      title: WINDOW_TITLE,
      icon: appWindowIcon(),
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#6b6c75', height: 40 },
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        spellcheck: false,
      },
    })
    configureWindowIdentity(win)
    win.show()
    if (maximized) {
      win.maximize()
    }
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    const remember = () => {
      clearTimeout(saveTimer)
      if (!win || win.isDestroyed() || win.isMinimized()) {
        return
      }
      try {
        writeFileAtomic(
          statePath,
          JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }),
        )
      } catch (error) {
        console.error('保存窗口位置失败', error)
      }
    }
    const scheduleSave = () => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(remember, 300)
    }
    win.on('move', scheduleSave)
    win.on('resize', scheduleSave)
    win.on('maximize', scheduleSave)
    win.on('unmaximize', scheduleSave)
    win.on('close', remember)
    win.on('page-title-updated', (event) => {
      event.preventDefault()
      win?.setTitle(WINDOW_TITLE)
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(process.env.ELECTRON_RENDERER_URL).catch((error) => console.error(error))
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html')).catch((error) => console.error(error))
    }
    win.on('closed', () => {
      clearTimeout(saveTimer)
      win = null
      onClosed()
    })
  }

  async function openCanvasWindow(): Promise<void> {
    const existing = canvasWindow
    if (existing && !existing.isDestroyed()) {
      await canvasLoad
      if (!existing.isDestroyed()) {
        existing.show()
        existing.focus()
      }
      return
    }

    const window = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      minWidth: 780,
      minHeight: 560,
      backgroundColor: '#ffffff',
      title: CANVAS_TITLE,
      icon: appWindowIcon(),
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 15 } : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/canvas.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    })
    window.webContents.on('will-prevent-unload', (event) => {
      const discard = dialog.showMessageBoxSync(window, {
        type: 'question',
        buttons: ['继续编辑', '关闭画布'],
        defaultId: 0,
        cancelId: 0,
        message: '画布有未保存的更改或进行中的操作。关闭后将离开当前项目。',
      })
      if (discard === 1) {
        event.preventDefault()
      }
    })
    canvasWindow = window
    configureWindowIdentity(window)
    window.on('page-title-updated', (event) => event.preventDefault())
    window.once('closed', () => {
      if (canvasWindow === window) {
        canvasWindow = null
        canvasLoad = null
      }
    })

    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    canvasLoad = rendererUrl
      ? window.loadURL(new URL('canvas.html', rendererUrl).href)
      : window.loadFile(join(__dirname, '../renderer/canvas.html'))
    try {
      await canvasLoad
      if (!window.isDestroyed()) {
        window.show()
      }
    } catch (error) {
      if (!window.isDestroyed()) {
        window.close()
      }
      throw error
    }
  }

  return {
    get current() {
      return win
    },
    get canvas() {
      return canvasWindow
    },
    createWindow,
    openCanvasWindow,
  }
}
