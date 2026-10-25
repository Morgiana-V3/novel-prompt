import { app, BrowserWindow, ipcMain, shell, clipboard, ClipboardItem, nativeImage, dialog, protocol, net } from 'electron'
import { join, resolve, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type {
  NaiGenParams,
  NaiSubscription,
  NaiVersion,
  McpInfo,
  SearchOptions,
  Settings,
  SkillEntry,
  SkillInput
} from '../shared/types'
import { tagStore } from './tagdb/store'
import { analyzePrompt } from './prompt/analyzer'
import { getSettings, saveSettings } from './settings'
import { createPage, deletePage, editPage, importPage, listPages, pageUsesImage, readPage } from './page-workspaces'
import type { PageAction } from '../shared/page-workspace'
import type { InpaintDraft } from '../shared/types'
import { userSkillDir } from './paths'
import {
  coreText,
  createSkill,
  deleteSkill,
  duplicateSkill,
  getConfig,
  getSkill,
  importSkillFile,
  setConfig,
  skillFilePath,
  updateSkill
} from './skills'
import { IMAGE_SCHEME, freeCheck, getSubscription, imageDir, imagePath, listImages } from './nai/client'
import { readStdinLines, readLog } from './mcp/server'
import { buildTools, MCP_INSTRUCTIONS } from './mcp/tools'
import { createAppUpdater, UPDATE_REPO } from './update'
import { isWebUrl } from '../shared/web-url'
import { SHOT_DIR, prepareScreenshotProfile, takeScreenshots } from './screenshots'
import { registerTaskIpc } from './task-ipc'
import { taskIsActive } from '../shared/tasks'
import { DesktopBridge } from './desktop'
import { startMcpBridge } from './mcp/bridge'
import { desktopTools } from './mcp/desktop-tools'
import { frontendTools } from './mcp/frontend-tools'
import { agentExecutor } from './mcp/runtime'
import type { TaskManager } from './tasks'

let win: BrowserWindow | null = null
let desktop: DesktopBridge
let tasks: TaskManager
let bridge: Awaited<ReturnType<typeof startMcpBridge>> | undefined
let changeTimer: ReturnType<typeof setTimeout> | undefined
function notifyAppChanged() {
  if (changeTimer) return
  changeTimer = setTimeout(() => { changeTimer = undefined; bridge?.changed() }, 100)
}
// Explicit profile override for isolated tests and separate local installations.
if (process.env.NOVELPROMPT_USER_DATA) app.setPath('userData', resolve(process.env.NOVELPROMPT_USER_DATA))

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
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return }
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
    titleBarOverlay: { color: '#00000000', symbolColor: '#6b6c75', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => { win = null; desktop?.disconnected() })
}

const send = (channel: string, payload: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  if (channel === 'tasks:changed') notifyAppChanged()
}

function registerIpc(): void {
  tasks = registerTaskIpc(send)
  const updater = createAppUpdater(info => send('update:state', info), () => tasks.snapshot().tasks.some(taskIsActive))
  const updateTimer = setInterval(() => void updater.check(true), 6 * 60 * 60 * 1000)
  updateTimer.unref()
  ipcMain.handle('window:dark-titlebar', (event, dark: boolean) => {
    if (win && event.sender === win.webContents && process.platform !== 'darwin')
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark === true ? '#f7f7f9' : '#6b6c75' })
  })
  ipcMain.handle('db:status', () => tagStore.status())

  ipcMain.handle('tag:search', (_e, opts: SearchOptions) => tagStore.search(opts))
  ipcMain.handle('tag:setZh', (_e, name: string, zh: string) => tagStore.setTranslation(name, zh))
  ipcMain.handle('prompt:analyze', (_e, text: string) => analyzePrompt(text, getSettings().naiVersion))

  ipcMain.handle('settings:get', () => getSettings())
  // Skill 配置只走 skills:* 接口，避免界面里旧的设置副本把它覆盖
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const { skills: _s, skillsMigrated: _m, ...rest } = patch
    return saveSettings(rest)
  })

  /* ---------- Skill ---------- */
  ipcMain.handle('skills:list', () => getConfig())
  ipcMain.handle('skills:get', (_e, id: string) => getSkill(id))
  ipcMain.handle('skills:core', () => coreText())
  ipcMain.handle('skills:setConfig', (_e, entries: SkillEntry[]) => setConfig(entries))
  ipcMain.handle('skills:create', (_e, input: SkillInput) => createSkill(input))
  ipcMain.handle('skills:update', (_e, id: string, patch: Partial<SkillInput>) => updateSkill(id, patch))
  ipcMain.handle('skills:delete', (_e, id: string) => deleteSkill(id))
  ipcMain.handle('skills:duplicate', (_e, id: string) => duplicateSkill(id))
  ipcMain.handle('skills:import', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '导入 Skill',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (r.canceled) return { imported: [], errors: [] }
    const imported: string[] = []
    const errors: string[] = []
    for (const p of r.filePaths) {
      try {
        imported.push(importSkillFile(p).name)
      } catch (e) {
        errors.push(`${p}：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return { imported, errors }
  })
  ipcMain.handle('skills:reveal', (_e, id?: string) => {
    const p = id ? skillFilePath(id) : null
    if (p) shell.showItemInFolder(p)
    else shell.openPath(userSkillDir())
  })
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('clipboard:read', () => clipboard.readText())

  /* ---------- Agent 接入（MCP） ---------- */
  ipcMain.handle('mcp:info', (): McpInfo => {
    // Node 模式代理连接同一个应用主进程，必要时启动无窗口的宿主。
    // 路径取自当前运行的程序，所以配置跟随用户实际的安装位置。
    const root = app.getAppPath()
    const proxy = app.isPackaged ? join(process.resourcesPath, 'mcp-proxy.cjs') : join(root, 'scripts', 'mcp-proxy.cjs')
    // 便携版每次运行都解压到临时目录，路径会变
    const portable =
      !!process.env.PORTABLE_EXECUTABLE_FILE || resolve(process.execPath).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())
    return {
      command: process.execPath,
      args: app.isPackaged ? [proxy] : [proxy, root],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      packaged: app.isPackaged,
      portable,
      log: readLog()
    }
  })

  /* ---------- 版本检查 ---------- */
  ipcMain.handle('web:open', async (_e, url: unknown) => {
    if (!isWebUrl(url)) throw new Error('仅支持打开 HTTP / HTTPS 网页')
    await shell.openExternal(url)
  })
  ipcMain.handle('update:state', () => updater.snapshot())
  ipcMain.handle('update:check', (_e, force?: boolean) => updater.check(!!force))
  ipcMain.handle('update:download', () => updater.download())
  ipcMain.handle('update:install', async () => {
    if (!win || updater.snapshot().stage !== 'ready') throw new Error('更新尚未准备好')
    if (tasks.snapshot().tasks.some(taskIsActive)) throw new Error('还有任务正在运行，请等任务结束后再更新')
    const result = await dialog.showMessageBox(win, {
      type: 'question', title: '重启并更新', message: `安装 NovelPrompt ${updater.snapshot().latest}？`,
      detail: '应用将关闭并在更新后重新打开。已保存的设置、提示词、会话和图库会保留。',
      buttons: ['稍后', '重启并更新'], defaultId: 0, cancelId: 0, noLink: true
    })
    if (result.response === 1) updater.install()
  })
  // 只允许打开本仓库的 release 页，避免渲染进程被注入后借 shell 打开任意地址
  ipcMain.handle('update:open', (_e, url: string) =>
    shell.openExternal(/^https:\/\/github\.com\/Morgiana-V3\/novel-prompt\/releases(?:[/?#]|$)/.test(url) ? url : `https://github.com/${UPDATE_REPO}/releases/latest`)
  )

  /* ---------- NovelAI 生图 ---------- */
  ipcMain.handle('nai:subscription', () => getSubscription())
  ipcMain.handle('nai:freeCheck', (_e, params: NaiGenParams, version: NaiVersion, sub?: NaiSubscription) =>
    freeCheck(params, version, sub)
  )
  ipcMain.handle('nai:list', () => listImages())
  ipcMain.handle('pages:list', () => listPages())
  ipcMain.handle('pages:delete', (_e, id: string, revision: number) => deletePage(id, revision))
  ipcMain.handle('pages:read', (_e, id: string) => readPage(id))
  ipcMain.handle('pages:create', (_e, image: string | null, params: NaiGenParams, model: NaiVersion, draft: InpaintDraft) => createPage(image, params, model, draft))
  ipcMain.handle('pages:import', async (_e, params: NaiGenParams, model: NaiVersion, draft: InpaintDraft) => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { title: '导入创作会话图片', filters: [{ name: 'PNG 图片', extensions: ['png'] }], properties: ['openFile'] })
    return result.canceled || !result.filePaths[0] ? null : importPage(result.filePaths[0], params, model, draft)
  })
  ipcMain.handle('pages:edit', (_e, id: string, revision: number, action: PageAction) => editPage(id, revision, action))
  // 读回图片原始字节（用于解析图里的提示词）。不走 fetch(np-img://)，避免跨源被拦
  ipcMain.handle('nai:readImage', (_e, name: string) => {
    const src = imagePath(name)
    if (!src) throw new Error('图片不存在或已被删除')
    return new Uint8Array(readFileSync(src))
  })
  ipcMain.handle('nai:saveAs', async (_e, name: string) => {
    const src = imagePath(name)
    if (!src || !win) return false
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'PNG 图片', extensions: ['png'] }] })
    if (r.canceled || !r.filePath) return false
    copyFileSync(src, r.filePath)
    return true
  })
  ipcMain.handle('nai:copyImage', async (_e, name: string) => {
    const src = imagePath(name)
    if (!src) return false
    const blob = new Blob([readFileSync(src)], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  })
  ipcMain.handle('nai:reveal', (_e, name?: string) => {
    const src = name ? imagePath(name) : null
    if (src) shell.showItemInFolder(src)
    else shell.openPath(imageDir())
  })
  ipcMain.handle('nai:delete', async (_e, name: string) => {
    if (pageUsesImage(name)) throw new Error('这张图片被 AI 工作台的会话引用，为保留版本记录暂不能从图库删除')
    const src = imagePath(name)
    if (src) await shell.trashItem(src)
    return !!src
  })
}

/** 图库图片通过自定义协议给渲染进程使用，只能访问图库目录内的 png */
function registerImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''))
    const p = imagePath(name)
    if (!p) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(p).toString())
  })
}

protocol.registerSchemesAsPrivileged([{ scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

/** Legacy --mcp is a relay too; it must never own a second copy of application state. */
const MCP_MODE = process.argv.includes('--mcp')

if (MCP_MODE) {
  // stdout 只能写协议消息，其他输出全部改到 stderr
  const toErr = (...a: unknown[]) => process.stderr.write(a.map(String).join(' ') + '\n')
  console.log = console.info = console.debug = toErr
  app.disableHardwareAcceleration()
  app.setPath('sessionData', join(tmpdir(), `novelprompt-relay-${process.pid}`))
  app.whenReady().then(() => {
    const proxy = app.isPackaged ? join(process.resourcesPath, 'mcp-proxy.cjs') : join(app.getAppPath(), 'scripts/mcp-proxy.cjs')
    const client = spawn(process.execPath, [proxy, ...(app.isPackaged ? [] : [app.getAppPath()])], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] })
    readStdinLines(line => client.stdin.write(line + '\n'), () => client.stdin.end())
    client.stdout.on('data', data => process.stdout.write(data))
    client.on('error', e => { console.error(e); app.exit(1) })
    client.on('exit', code => app.exit(code ?? 0))
  })
} else {
  if (SHOT_DIR) prepareScreenshotProfile()
  const primary = app.requestSingleInstanceLock()
  if (!primary) app.quit()
  else {
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes('--mcp-host')) void app.whenReady().then(createWindow)
  })
  app.whenReady().then(async () => {
    // 让 Windows 任务栏 / Alt+Tab 使用窗口图标，而不是 electron.exe 的默认图标
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
    tagStore.load()
    desktop = new DesktopBridge(() => win, createWindow)
    desktop.onChange = notifyAppChanged
    registerIpc()
    registerImageProtocol()
    const appState = () => ({ version: app.getVersion(), hostPid: process.pid, visible: desktop.visible(), desktop: desktop.state, tasks: tasks.snapshot() })
    bridge = await startMcpBridge(app.isPackaged ? dirname(process.execPath) : app.getAppPath(), process.env.NOVELPROMPT_USER_DATA ?? '',
      [...buildTools(), ...desktopTools(desktop, tasks, appState), ...frontendTools(desktop)], { name: 'novel-prompt', version: app.getVersion(), instructions: MCP_INSTRUCTIONS },
      { state: appState, execute: agentExecutor(tasks, desktop, send) })
    const idleTimer = setInterval(() => {
      if (!win && !bridge?.clients() && !tasks.snapshot().tasks.some(taskIsActive)) app.quit()
    }, 30000)
    idleTimer.unref()
    if (!process.argv.includes('--mcp-host')) createWindow()
    if (SHOT_DIR && win) {
      const w = win
      w.webContents.once('did-finish-load', () =>
        takeScreenshots(w).catch((e) => {
          console.error('[screenshots] 失败：', e)
          app.quit()
        })
      )
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch(e => { console.error('应用服务启动失败', e); app.exit(1) })

  app.on('window-all-closed', () => {
    // Connected agents and in-flight work retain their shared host when the window closes.
    if (process.platform !== 'darwin' && !bridge?.clients() && !tasks?.snapshot().tasks.some(taskIsActive)) app.quit()
  })
  app.on('before-quit', () => bridge?.close())
  }
}
