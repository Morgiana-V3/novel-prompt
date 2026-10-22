import { app, BrowserWindow, ipcMain, shell, clipboard, ClipboardItem, nativeImage, dialog, protocol, net } from 'electron'
import { join } from 'node:path'
import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type {
  AiOptimizeRequest,
  AiPreviewRequest,
  NaiGenParams,
  NaiGenRequest,
  NaiSubscription,
  NaiVersion,
  McpInfo,
  McpInstallTarget,
  SearchOptions,
  Settings
} from '../shared/types'
import { tagStore } from './tagdb/store'
import { updateImplications, updateTagDatabase } from './tagdb/fetcher'
import { analyzePrompt } from './prompt/analyzer'
import { getSettings, saveSettings } from './settings'
import { optimizePrompt } from './ai/optimizer'
import { previewPrompt } from './ai/previewer'
import { aiTranslate } from './ai/translator'
import { skillPath, SKILL_FILES, type SkillFile } from './paths'
import { IMAGE_SCHEME, freeCheck, generateImages, getSubscription, imageDir, imagePath, listImages } from './nai/client'
import { startMcpServer, readLog } from './mcp/server'
import { buildTools, MCP_INSTRUCTIONS } from './mcp/tools'
import { SKILL_TARGETS, bundledSkill, codexConfigPath, installForAgents, installState, isPortable, mcpLaunch } from './mcp/install'

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
  ipcMain.handle('db:implications', async () => {
    if (busy) throw new Error('已有任务在运行')
    busy = new AbortController()
    try {
      const n = await updateImplications(tagStore.names(), (p) => send('progress', p), busy.signal)
      tagStore.loadImplications()
      send('progress', { stage: 'done', message: `包含关系下载完成，共 ${n.toLocaleString()} 条` })
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

  ipcMain.handle('ai:preview', async (_e, req: AiPreviewRequest) => {
    const ctrl = new AbortController()
    busy = busy ?? ctrl
    try {
      return await previewPrompt(req, (step) => send('ai:step', step), ctrl.signal)
    } finally {
      if (busy === ctrl) busy = null
    }
  })

  ipcMain.handle('skill:open', (_e, name?: SkillFile) =>
    shell.openPath(skillPath(name && SKILL_FILES.includes(name) ? name : 'nai-prompt.md'))
  )
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('clipboard:read', () => clipboard.readText())

  /* ---------- Agent 接入（MCP） ---------- */
  ipcMain.handle('mcp:info', (): McpInfo => {
    // agent 以 Node 模式运行同一个可执行文件，跑一个转发代理，代理再拉起 `--mcp` 并过滤掉 Electron 写到 stdout 的杂讯。
    // 路径取自当前运行的程序，所以配置跟随用户实际的安装位置。
    return {
      ...mcpLaunch(),
      packaged: app.isPackaged,
      portable: isPortable(),
      installed: installState(),
      paths: { codexConfig: codexConfigPath(), codexSkill: SKILL_TARGETS.codexSkill(), claudeSkill: SKILL_TARGETS.claudeSkill() },
      skillFile: bundledSkill(),
      log: readLog()
    }
  })
  ipcMain.handle('mcp:install', (_e, targets: McpInstallTarget[]) => installForAgents(targets))
  ipcMain.handle('mcp:openSkill', () => shell.openPath(bundledSkill()))

  /* ---------- NovelAI 生图 ---------- */
  let naiRunning = false
  let naiCancel = false
  ipcMain.handle('nai:subscription', () => getSubscription())
  ipcMain.handle('nai:freeCheck', (_e, params: NaiGenParams, version: NaiVersion, sub?: NaiSubscription) =>
    freeCheck(params, version, sub)
  )
  ipcMain.handle('nai:generate', async (_e, req: NaiGenRequest) => {
    if (naiRunning) throw new Error('上一批还在生成中')
    naiRunning = true
    naiCancel = false
    try {
      return await generateImages(req, (s) => send('nai:step', s), () => naiCancel)
    } finally {
      naiRunning = false
    }
  })
  // 只在两张之间停止，不中断正在进行的请求（中断后服务端可能仍会生成并扣费）
  ipcMain.handle('nai:cancel', () => {
    naiCancel = true
  })
  ipcMain.handle('nai:list', () => listImages())
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

/**
 * MCP 模式（NovelPrompt.exe --mcp）：不开窗口，通过 stdio 给 Codex 等 agent 提供工具。
 * 与界面共用 tag 库、设置和图库；浏览器会话数据单独存放，避免和正在运行的界面抢锁。
 */
const MCP_MODE = process.argv.includes('--mcp')

if (MCP_MODE) {
  // stdout 只能写协议消息，其他输出全部改到 stderr
  const toErr = (...a: unknown[]) => process.stderr.write(a.map(String).join(' ') + '\n')
  console.log = console.info = console.debug = toErr
  app.disableHardwareAcceleration()
  app.setPath('sessionData', join(app.getPath('userData'), 'mcp-session'))
  app.whenReady().then(() => {
    tagStore.load()
    startMcpServer(buildTools(), { name: 'novel-prompt', version: app.getVersion(), instructions: MCP_INSTRUCTIONS }, () => app.quit())
  })
} else {
  app.whenReady().then(() => {
    // 让 Windows 任务栏 / Alt+Tab 使用窗口图标，而不是 electron.exe 的默认图标
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
    tagStore.load()
    registerIpc()
    registerImageProtocol()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
