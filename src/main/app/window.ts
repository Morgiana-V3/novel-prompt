import { app, BrowserWindow, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

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
    win = new BrowserWindow({
      width: 1440,
      height: 900,
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
      },
    })
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
