import { app, BrowserWindow, ipcMain, shell, clipboard, ClipboardItem, nativeImage, dialog, protocol, net } from 'electron'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, copyFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type {
  AiInpaintRequest,
  AiOptimizeRequest,
  AiPreviewRequest,
  NaiGenParams,
  NaiGenRequest,
  NaiInpaintRequest,
  NaiSubscription,
  NaiVersion,
  McpInfo,
  SearchOptions,
  Settings,
  SkillEntry,
  SkillInput
} from '../shared/types'
import { tagStore } from './tagdb/store'
import { updateImplications, updateTagDatabase, Cancelled } from './tagdb/fetcher'
import { analyzePrompt } from './prompt/analyzer'
import { getSettings, saveSettings } from './settings'
import { planInpaint } from './ai/inpaint-planner'
import { createPage, deletePage, editPage, importPage, listPages, pageLocks, pageUsesImage, readPage } from './page-workspaces'
import { discussPage, renderPage } from './ai/page-collaborator'
import type { PageAction, PageExecution } from '../shared/page-workspace'
import type { InpaintDraft } from '../shared/types'
import { optimizePrompt } from './ai/optimizer'
import { previewPrompt } from './ai/previewer'
import { aiTranslate } from './ai/translator'
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
import { IMAGE_SCHEME, freeCheck, generateImages, getSubscription, imageDir, imagePath, listImages } from './nai/client'
import { startMcpServer, readLog } from './mcp/server'
import { buildTools, MCP_INSTRUCTIONS } from './mcp/tools'
import { checkUpdate, UPDATE_REPO } from './update'
import { isWebUrl } from '../shared/web-url'
import { SHOT_DIR, prepareScreenshotProfile, takeScreenshots } from './screenshots'

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
    titleBarOverlay: { color: '#00000000', symbolColor: '#6b6c75', height: 40 },
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
  ipcMain.handle('window:dark-titlebar', (event, dark: boolean) => {
    if (win && event.sender === win.webContents && process.platform !== 'darwin')
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark === true ? '#f7f7f9' : '#6b6c75' })
  })
  ipcMain.handle('db:status', () => tagStore.status())
  ipcMain.handle('db:update', async () => {
    if (busy) throw new Error('已有任务在运行')
    busy = new AbortController()
    try {
      await updateTagDatabase(getSettings().minPostCount, (p) => send('progress', p), busy.signal)
      send('progress', { stage: 'index', message: '正在构建索引…' })
      tagStore.load()
      send('progress', { stage: 'done', message: '数据更新完成' })
      return tagStore.status()
    } catch (e) {
      if (e instanceof Cancelled) {
        send('progress', { stage: 'done', message: '已取消，原有数据继续使用' })
        return tagStore.status()
      }
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
      if (e instanceof Cancelled) {
        send('progress', { stage: 'done', message: '已取消' })
        return tagStore.status()
      }
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
      if (e instanceof Cancelled) {
        send('progress', { stage: 'done', message: '已取消' })
        return tagStore.status()
      }
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
  // Skill 配置只走 skills:* 接口，避免界面里旧的设置副本把它覆盖
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const { skills: _s, skillsMigrated: _m, ...rest } = patch
    return saveSettings(rest)
  })

  let inpaintPlan: AbortController | null = null
  ipcMain.handle('ai:inpaint-plan-cancel', () => inpaintPlan?.abort())
  ipcMain.handle('ai:inpaint-plan', async (_e, req: AiInpaintRequest) => {
    if (inpaintPlan) throw new Error('正在分析区域，请等待或取消当前分析')
    const ctrl = new AbortController()
    inpaintPlan = ctrl
    try { return await planInpaint(req, ctrl.signal) }
    catch (e) { if (ctrl.signal.aborted) throw new Error('已取消分析'); throw e }
    finally { if (inpaintPlan === ctrl) inpaintPlan = null }
  })

  ipcMain.handle('ai:optimize', async (_e, req: AiOptimizeRequest) => {
    const ctrl = new AbortController()
    busy = busy ?? ctrl
    try {
      return await optimizePrompt(req, (step) => send('ai:step', step), ctrl.signal)
    } catch (e) {
      // 用户主动取消时 fetch 抛的是 AbortError，对界面来说就是「已取消」
      if (ctrl.signal.aborted) throw new Error('已取消')
      throw e
    } finally {
      if (busy === ctrl) busy = null
    }
  })

  ipcMain.handle('ai:preview', async (_e, req: AiPreviewRequest) => {
    const ctrl = new AbortController()
    busy = busy ?? ctrl
    try {
      return await previewPrompt(req, (step) => send('ai:step', step), ctrl.signal)
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error('已取消')
      throw e
    } finally {
      if (busy === ctrl) busy = null
    }
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
    // agent 以 Node 模式运行同一个可执行文件，跑一个转发代理，代理再拉起 `--mcp` 并过滤掉 Electron 写到 stdout 的杂讯。
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
  ipcMain.handle('update:check', (_e, force?: boolean) => checkUpdate(!!force))
  // 只允许打开本仓库的 release 页，避免渲染进程被注入后借 shell 打开任意地址
  ipcMain.handle('update:open', (_e, url: string) =>
    shell.openExternal(/^https:\/\/github\.com\/Morgiana-V3\/novel-prompt\/?/.test(url) ? url : `https://github.com/${UPDATE_REPO}/releases/latest`)
  )

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
  ipcMain.handle('nai:inpaint', async (_e, req: NaiInpaintRequest) => {
    if (naiRunning) throw new Error('上一批还在生成中')
    if (!req?.inpaint) throw new Error('缺少原图或遮罩')
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
  ipcMain.handle('pages:chat', (_e, id: string, revision: number, text: string, region: string | null, refs: string[]) => discussPage(id, revision, text, region, refs))
  ipcMain.handle('pages:cancel', (_e, id: string) => pageLocks.get(id)?.abort())
  ipcMain.handle('pages:generate', async (_e, id: string, revision: number, execution: PageExecution) => {
    if (naiRunning) throw new Error('正在生成图片，请稍候')
    naiRunning = true; naiCancel = false
    try { return await renderPage(id, revision, execution, s => send('nai:step', s), () => naiCancel) }
    finally { naiRunning = false }
  })
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
  if (SHOT_DIR) prepareScreenshotProfile()
  app.whenReady().then(() => {
    // 让 Windows 任务栏 / Alt+Tab 使用窗口图标，而不是 electron.exe 的默认图标
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
    tagStore.load()
    registerIpc()
    registerImageProtocol()
    createWindow()
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
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
