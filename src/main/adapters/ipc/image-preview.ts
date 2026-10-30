import type { BrowserWindow } from 'electron'

const restores = new WeakMap<BrowserWindow, () => void>()

/** Native caption buttons sit above DOM overlays on Windows. */
export function setImagePreviewActive(win: BrowserWindow, active: boolean): void {
  if (!active) {
    restores.get(win)?.()
    return
  }
  if (restores.has(win)) {
    return
  }
  const previous = {
    closable: win.isClosable(),
    minimizable: win.isMinimizable(),
    maximizable: win.isMaximizable(),
  }
  const restore = () => {
    restores.delete(win)
    if (win.isDestroyed()) {
      return
    }
    win.webContents.removeListener('did-start-loading', restore)
    win.webContents.removeListener('render-process-gone', restore)
    win.setClosable(previous.closable)
    win.setMinimizable(previous.minimizable)
    win.setMaximizable(previous.maximizable)
    if (process.platform === 'darwin') {
      win.setWindowButtonVisibility(true)
    } else {
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: '#6b6c75' })
    }
  }
  restores.set(win, restore)
  win.setClosable(false)
  win.setMinimizable(false)
  win.setMaximizable(false)
  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(false)
  } else {
    win.setTitleBarOverlay({ color: '#00000000', symbolColor: '#74747a' })
  }
  // A renderer reload/crash must not leave the application controls disabled.
  win.webContents.once('did-start-loading', restore)
  win.webContents.once('render-process-gone', restore)
}
