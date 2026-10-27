import { app, clipboard, shell } from 'electron'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { McpInfo } from '../../../shared/contracts/mcp'
import { isWebUrl } from '../../../shared/web-url'
import { readLog } from '../mcp/call-log'
import type { IpcContext } from './context'
import { handle } from './handle'

export function registerApplicationIpc(context: IpcContext): void {
  const { runtimeInfo } = context
  const runtimeData = context.runtimeData
  const bridgeProfile = context.bridgeProfile

  handle('window:dark-titlebar', (event, dark: boolean) => {
    const win = context.getWindow()

    if (win && event.sender === win.webContents && process.platform !== 'darwin') {
      win.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: dark === true ? '#f7f7f9' : '#6b6c75',
      })
    }
  })

  handle('clipboard:write', (_e, text: string) => {
    return clipboard.writeText(text)
  })

  handle('clipboard:read', () => {
    return clipboard.readText()
  })

  /* ---------- Agent 接入（MCP） ---------- */
  handle('mcp:info', (): McpInfo => {
    // Node 模式代理连接同一个应用主进程，必要时启动无窗口的宿主。
    // 路径取自当前运行的程序，所以配置跟随用户实际的安装位置。
    const root = app.getAppPath()
    const proxy = app.isPackaged
      ? join(process.resourcesPath, 'mcp-proxy.cjs')
      : join(root, 'src', 'runtime', 'mcp-proxy.cjs')
    // 便携版每次运行都解压到临时目录，路径会变
    const portable =
      !!process.env.PORTABLE_EXECUTABLE_FILE ||
      resolve(process.execPath).toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())
    return {
      command: process.execPath,
      args: app.isPackaged ? [proxy] : [proxy, root],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        NOVELPROMPT_MCP_GROUPS: 'all',
        ...(bridgeProfile ? { NOVELPROMPT_USER_DATA: runtimeData } : {}),
      },
      runtime: runtimeInfo(),
      serverName: app.isPackaged ? 'novel-prompt' : 'novel-prompt-dev',
      packaged: app.isPackaged,
      portable,
      log: readLog(),
    }
  })

  /* ---------- 版本检查 ---------- */
  handle('web:open', async (_e, url: unknown) => {
    if (!isWebUrl(url)) {
      throw new Error('仅支持打开 HTTP / HTTPS 网页')
    }
    await shell.openExternal(url)
  })
}
