import { app, nativeImage, shell, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function appUserModelId(): string {
  return app.isPackaged ? 'com.holyxie.novelprompt' : 'com.holyxie.novelprompt.development'
}

/** 软件图标文件；安装版在 resources 目录，开发版在 build 目录。 */
export function appIconPath(names = ['icon.png']): string | undefined {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build')
  return names.map((name) => join(base, name)).find((path) => existsSync(path))
}

export function appWindowIcon(): Electron.NativeImage | undefined {
  const names = process.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png']
  for (const name of names) {
    const path = appIconPath([name])
    if (path) {
      const icon = nativeImage.createFromPath(path)
      if (!icon.isEmpty()) {
        return icon
      }
    }
  }
  return undefined
}

/** Repair only the notification shortcut created by this development executable. */
export function repairDevelopmentShortcut(): void {
  if (process.platform !== 'win32' || app.isPackaged) {
    return
  }
  const shortcutPath = join(
    app.getPath('appData'),
    'Microsoft/Windows/Start Menu/Programs/Electron.lnk',
  )
  const icon = appIconPath(['icon.ico'])
  if (!icon || !existsSync(shortcutPath)) {
    return
  }
  try {
    const shortcut = shell.readShortcutLink(shortcutPath)
    if (
      shortcut.appUserModelId !== appUserModelId() ||
      resolve(shortcut.target).toLowerCase() !== resolve(process.execPath).toLowerCase()
    ) {
      return
    }
    const args = `"${app.getAppPath()}"`
    const description = 'NovelPrompt · 开发版'
    if (
      shortcut.icon === icon &&
      shortcut.iconIndex === 0 &&
      shortcut.args === args &&
      shortcut.cwd === app.getAppPath() &&
      shortcut.description === description
    ) {
      return
    }
    if (
      !shell.writeShortcutLink(shortcutPath, 'update', {
        target: process.execPath,
        icon,
        iconIndex: 0,
        args,
        cwd: app.getAppPath(),
        description,
      })
    ) {
      console.warn('无法更新开发版任务栏快捷方式图标')
    }
  } catch (error) {
    console.warn('无法修复开发版任务栏快捷方式', error)
  }
}

export function configureWindowIdentity(window: BrowserWindow): void {
  if (process.platform !== 'win32' || app.isPackaged) {
    return
  }
  // An existing Start Menu shortcut takes precedence over window relaunch metadata.
  // Repair our legacy notification shortcut before Windows groups the visible window.
  repairDevelopmentShortcut()
  window.setAppDetails({
    appId: appUserModelId(),
    appIconPath: appIconPath(['icon.ico']),
    appIconIndex: 0,
    relaunchCommand: `"${process.execPath}" "${app.getAppPath()}"`,
    relaunchDisplayName: 'NovelPrompt · 开发版',
  })
}
