import { app, BrowserWindow, nativeImage, screen } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../infrastructure/atomic-file'

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
  const WINDOW_TITLE = app.isPackaged ? 'NovelPrompt' : 'NovelPrompt · 开发版'

  function appIcon(): Electron.NativeImage | undefined {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build')
    for (const name of process.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png']) {
      const path = join(base, name)
      if (existsSync(path)) {
        return nativeImage.createFromPath(path)
      }
    }
    return undefined
  }

  function createWindow(): void {
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      return
    }
    // The runtime profile is selected after the manager is constructed.
    const statePath = join(app.getPath('userData'), 'window-state.json')
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
      width: 1440,
      height: 900,
      ...restored,
      minWidth: 1100,
      minHeight: 700,
      backgroundColor: '#ffffff',
      title: WINDOW_TITLE,
      icon: appIcon(),
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#6b6c75', height: 40 },
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        spellcheck: false,
      },
    })
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
  return {
    get current() {
      return win
    },
    createWindow,
  }
}
