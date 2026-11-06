import { requestConfirmation } from '../adapters/desktop/confirmations'
import { installOperationAuthorization } from './operation-authorization'
import { migrateStorageOnStartup } from '../modules/settings/storage'
import { readStorageLocation, storageRoot } from '../infrastructure/storage-root'
import { app, BrowserWindow, Notification, protocol, dialog } from 'electron'
import { createTaskNotifier } from './task-notifications'
import { getSettings } from '../modules/settings/service'
import type { TaskSnapshot } from '../../shared/tasks/model'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveRuntimeProfile } from '../../runtime/runtime-profile.cjs'
import { taskIsActive } from '../../shared/tasks/model'
import { DesktopBridge } from '../adapters/desktop/bridge'
import { registerApplicationIpc } from '../adapters/ipc/application'
import { registerImagesIpc } from '../adapters/ipc/images'
import { registerReverseIpc } from '../adapters/ipc/reverse'
import { registerSettingsIpc } from '../adapters/ipc/settings'
import { registerSkillsIpc } from '../adapters/ipc/skills'
import { registerTagsIpc } from '../adapters/ipc/tags'
import { registerTaskIpc } from '../adapters/ipc/tasks'
import { registerUpdatesIpc } from '../adapters/ipc/updates'
import { registerWorkspaceIpc } from '../adapters/ipc/workspace'
import { startMcpBridge } from '../adapters/mcp/bridge'
import { desktopTools } from '../adapters/mcp/tools/desktop'
import { frontendTools } from '../adapters/mcp/tools/frontend'
import { agentExecutor } from '../adapters/mcp/runtime'
import { readStdinLines } from '../adapters/mcp/stdio'
import { buildTools, MCP_INSTRUCTIONS } from '../adapters/mcp/tools'
import { IMAGE_SCHEME } from '../modules/images/access'
import { clearTemporaryImages } from '../modules/images/library'
import { tagStore } from '../modules/tags/store'
import { TaskManager } from '../modules/tasks/task-manager'
import { registerImageProtocol } from './image-protocol'
import { prepareScreenshotProfile, SHOT_DIR, takeScreenshots } from './screenshots'
import { appIconPath, createWindowManager } from './window'
export function startApplication(): void {
  const windowManager = createWindowManager(() => desktop?.disconnected())
  const createWindow = windowManager.createWindow
  installOperationAuthorization((options, signal) => {
    createWindow()
    const owner = windowManager.current?.webContents
    return owner ? requestConfirmation(owner, options, signal) : Promise.resolve(false)
  })
  let desktop: DesktopBridge
  let tasks: TaskManager
  let bridge: Awaited<ReturnType<typeof startMcpBridge>> | undefined
  let changeTimer: ReturnType<typeof setTimeout> | undefined
  let migratingStorage = false
  function notifyAppChanged() {
    if (changeTimer) {
      return
    }
    changeTimer = setTimeout(() => {
      changeTimer = undefined
      bridge?.changed()
    }, 100)
  }
  // Apply before the single-instance lock, browser sessions or persistent services.
  let runtimeData = ''
  try {
    runtimeData = resolveRuntimeProfile({
      packaged: app.isPackaged,
      appData: app.getPath('appData'),
      defaultUserData: app.getPath('userData'),
    })
  } catch (error) {
    console.error(String(error))
    app.exit(1)
  }
  app.setPath('userData', runtimeData)
  app.setPath('sessionData', runtimeData)
  let bridgeProfile = !app.isPackaged || process.env.NOVELPROMPT_USER_DATA ? runtimeData : ''
  const runtimeInfo = () => ({
    mode: app.isPackaged ? ('installed' as const) : ('development' as const),
    dataPath: storageRoot(),
    appPath: app.getAppPath(),
  })
  // 开发版改用新身份：旧的 .dev 身份在发过系统通知后被 Windows 关联到 electron.exe，任务栏会显示 Electron 图标
  const APP_ID = app.isPackaged ? 'com.holyxie.novelprompt' : 'com.holyxie.novelprompt.development'

  const notifyTasks = createTaskNotifier({
    window: () =>
      windowManager.current && !windowManager.current.isDestroyed() ? windowManager.current : null,
    // Windows 上 isSupported() 也会初始化通知并创建 Electron.lnk，覆盖开发版任务栏图标。
    enabled: () =>
      getSettings().notifyOnComplete !== false && (!app.isPackaged || Notification.isSupported()),
    notify: ({ title, body, onClick }) => {
      // 开发版实际运行的是 electron.exe：系统通知会让 Windows 把应用身份关联到它，
      // 任务栏随之变成 Electron 图标。开发版只闪烁任务栏，安装版与便携版正常发通知。
      if (!app.isPackaged) {
        return
      }
      // 通知正文旁显示软件图标；左上角的应用名与图标由 Windows 按已登记的应用身份显示
      const icon = appIconPath()
      const notification = new Notification({
        title,
        body,
        silent: false,
        ...(icon ? { icon } : {}),
      })
      notification.on('click', onClick)
      notification.show()
    },
  })
  const send = (channel: string, payload: unknown) => {
    if (windowManager.current && !windowManager.current.isDestroyed()) {
      windowManager.current.webContents.send(channel, payload)
    }
    if (channel === 'tasks:changed') {
      notifyAppChanged()
      notifyTasks(payload as TaskSnapshot)
    }
  }

  function registerIpc(): void {
    tasks = new TaskManager((snapshot) => send('tasks:changed', snapshot))
    registerTaskIpc(send, tasks)
    const context = {
      getWindow: () => windowManager.current,
      send,
      notifyAppChanged,
      runtimeInfo,
      runtimeData,
      bridgeProfile,
      tasks,
    }
    registerApplicationIpc(context)
    registerTagsIpc(context)
    registerSettingsIpc(context)
    registerSkillsIpc(context)
    registerUpdatesIpc(context)
    registerImagesIpc(context)
    registerReverseIpc(context)
    registerWorkspaceIpc(context)
  }

  protocol.registerSchemesAsPrivileged([
    { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])

  /** Legacy --mcp is a relay too; it must never own a second copy of application state. */
  const MCP_MODE = process.argv.includes('--mcp')

  if (MCP_MODE) {
    // stdout 只能写协议消息，其他输出全部改到 stderr
    const toErr = (...values: unknown[]) =>
      process.stderr.write(values.map(String).join(' ') + '\n')
    console.debug = toErr
    console.info = toErr
    console.log = toErr
    app.disableHardwareAcceleration()
    app.setPath('sessionData', join(tmpdir(), `novelprompt-relay-${process.pid}`))
    app
      .whenReady()
      .then(() => {
        const proxy = app.isPackaged
          ? join(process.resourcesPath, 'mcp-proxy.cjs')
          : join(app.getAppPath(), 'src/runtime/mcp-proxy.cjs')
        const client = spawn(
          process.execPath,
          [proxy, ...(app.isPackaged ? [] : [app.getAppPath()])],
          {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
          },
        )
        readStdinLines(
          (line) => client.stdin.write(line + '\n'),
          () => client.stdin.end(),
        )
        client.stdout.on('data', (data) => process.stdout.write(data))
        client.on('error', (error) => {
          console.error(error)
          app.exit(1)
        })
        client.on('exit', (code) => app.exit(code ?? 0))
      })
      .catch((error) => {
        console.error(error)
        app.exit(1)
      })
  } else {
    if (SHOT_DIR) {
      prepareScreenshotProfile()
      runtimeData = app.getPath('userData')
      bridgeProfile = runtimeData
      app.setPath('sessionData', runtimeData)
    }
    const primary = app.requestSingleInstanceLock()
    if (!primary) {
      app.quit()
    } else {
      app.on('second-instance', (_event, argv) => {
        if (!argv.includes('--mcp-host') && !migratingStorage) {
          void app
            .whenReady()
            .then(createWindow)
            .catch((error) => console.error(error))
        }
      })
      app
        .whenReady()
        .then(async () => {
          if (readStorageLocation().pending) {
            migratingStorage = true
            const migrationWindow = new BrowserWindow({
              width: 520,
              height: 220,
              resizable: false,
              closable: false,
              autoHideMenuBar: true,
              webPreferences: { sandbox: true },
            })
            await migrationWindow.loadURL(
              'data:text/html;charset=utf-8,' +
                encodeURIComponent(
                  '<body style="font:14px/1.8 system-ui;padding:28px;background:#fff8fb;color:#3d3340"><h2>正在迁移数据</h2><p>正在复制并校验图片、模型和工作台数据，请稍候。<br>原目录中的文件会保留。完成后自动打开工作台。</p></body>',
                ),
            )
            try {
              await migrateStorageOnStartup((current, total) =>
                migrationWindow.setTitle(
                  `数据迁移 · ${total ? Math.round((current / total) * 100) : 0}%`,
                ),
              )
            } finally {
              migrationWindow.destroy()
              migratingStorage = false
            }
            const failure = readStorageLocation().error
            if (failure) {
              dialog.showErrorBox('数据迁移未完成', failure)
            }
          } else {
            storageRoot()
          }
          clearTemporaryImages(false)
          // 让 Windows 任务栏 / Alt+Tab 使用窗口图标，而不是 electron.exe 的默认图标
          if (process.platform === 'win32') {
            app.setAppUserModelId(APP_ID)
          }
          tagStore.load()
          desktop = new DesktopBridge(() => windowManager.current, createWindow)
          desktop.onChange = notifyAppChanged
          registerIpc()
          registerImageProtocol()
          const appState = () => ({
            version: app.getVersion(),
            hostPid: process.pid,
            runtime: runtimeInfo(),
            visible: desktop.visible(),
            desktop: desktop.state,
            tasks: tasks.snapshot(),
          })
          bridge = await startMcpBridge(
            app.isPackaged ? dirname(process.execPath) : app.getAppPath(),
            bridgeProfile,
            [...buildTools(), ...desktopTools(desktop, tasks, appState), ...frontendTools(desktop)],
            { name: 'novel-prompt', version: app.getVersion(), instructions: MCP_INSTRUCTIONS },
            { state: appState, execute: agentExecutor(tasks, desktop, send) },
          )
          const idleTimer = setInterval(() => {
            if (
              !windowManager.current &&
              !bridge?.clients() &&
              !tasks.snapshot().tasks.some(taskIsActive)
            ) {
              app.quit()
            }
          }, 30000)
          idleTimer.unref()
          if (!process.argv.includes('--mcp-host')) {
            createWindow()
          }
          if (SHOT_DIR && windowManager.current) {
            const window2 = windowManager.current
            window2.webContents.once('did-finish-load', () =>
              takeScreenshots(window2).catch((candidate) => {
                console.error('[screenshots] 失败：', candidate)
                app.quit()
              }),
            )
          }
          app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
              createWindow()
            }
          })
        })
        .catch((candidate) => {
          console.error('应用服务启动失败', candidate)
          dialog.showErrorBox('无法打开数据目录', String(candidate))
          app.exit(1)
        })

      app.on('window-all-closed', () => {
        if (migratingStorage) {
          return
        }
        // Connected agents and in-flight work retain their shared host when the window closes.
        if (
          process.platform !== 'darwin' &&
          !bridge?.clients() &&
          !tasks?.snapshot().tasks.some(taskIsActive)
        ) {
          app.quit()
        }
      })
      app.on('before-quit', () => bridge?.close())
      app.on('will-quit', () => {
        try {
          clearTemporaryImages()
        } catch (error) {
          console.error('临时图片清理失败，将在下次启动重试', error)
        }
      })
    }
  }
}
