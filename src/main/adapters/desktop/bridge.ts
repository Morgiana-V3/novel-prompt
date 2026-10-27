import { ipcMain, nativeImage, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import type {
  DesktopCaptureReady,
  DesktopCommand,
  DesktopReply,
  DesktopState,
} from '../../../shared/contracts/desktop'
import { cancelFrontend, frontendActive } from './frontend-operations'

/** Only the application's own renderer can publish state or acknowledge a typed command. */
export class DesktopBridge {
  state: DesktopState | null = null
  private capturing = false
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }
  >()
  onChange = () => {}
  private liveWindow() {
    const window2 = this.window()
    return window2 && !window2.isDestroyed() && !window2.webContents.isDestroyed() ? window2 : null
  }
  constructor(
    private window: () => BrowserWindow | null,
    private show: () => void,
  ) {
    ipcMain.on('desktop:cancel-frontend', (event) => {
      if (event.sender === this.liveWindow()?.webContents) {
        cancelFrontend()
      }
    })
    ipcMain.on('desktop:state', (event, value: DesktopState) => {
      if (event.sender !== this.liveWindow()?.webContents) {
        return
      }
      this.state = value
      this.onChange()
    })
    ipcMain.on('desktop:reply', (event, reply: DesktopReply) => {
      if (event.sender !== this.liveWindow()?.webContents) {
        return
      }
      const item = this.pending.get(reply.id)
      if (!item) {
        return
      }
      item.cleanup()
      this.pending.delete(reply.id)
      if (reply.error) {
        item.reject(new Error(reply.error))
      } else {
        item.resolve(reply.result)
      }
    })
  }
  connected() {
    return !!this.liveWindow()
  }
  visible() {
    return this.liveWindow()?.isVisible() ?? false
  }
  disconnected() {
    cancelFrontend()
    this.state = null
    for (const pendingRequest of this.pending.values()) {
      pendingRequest.cleanup()
      pendingRequest.reject(new Error('应用窗口已关闭，请重新读取状态'))
    }
    this.pending.clear()
    this.onChange()
  }
  cancelVisibleAction(actionId: string) {
    this.liveWindow()?.webContents.send('desktop:frontend-cancel', actionId)
  }
  async request(
    type: DesktopCommand['type'],
    args: Record<string, unknown> = {},
    reveal = false,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (
      frontendActive() &&
      !['frontend', 'snapshot', 'capture-prepare', 'capture-end', 'workspace-release'].includes(
        type,
      )
    ) {
      throw new Error('前台操作仍在执行，请等待完成后再操作界面')
    }
    if (reveal) {
      this.show()
    }
    const window2 = this.liveWindow()
    if (!window2) {
      throw new Error('桌面窗口尚未打开，请先调用 navigate_app 打开应用')
    }
    const contents = window2.webContents
    if (contents.isLoading()) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer)
          contents.removeListener('did-finish-load', loaded)
          contents.removeListener('destroyed', destroyed)
        }
        const loaded = () => {
          cleanup()
          resolve()
        }
        const destroyed = () => {
          cleanup()
          reject(new Error('应用窗口已关闭，请重新读取状态'))
        }
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('界面加载超时'))
        }, 15000)
        contents.once('did-finish-load', loaded)
        contents.once('destroyed', destroyed)
      })
    }
    if (this.liveWindow() !== window2) {
      throw new Error('应用窗口已关闭或更换，请重新读取状态')
    }
    if (signal?.aborted) {
      throw new Error('前台操作已停止')
    }
    // A Windows host spawned with windowsHide can suppress its first window's
    // default visibility. Reveal explicitly after load, including minimized apps.
    if (reveal) {
      if (window2.isMinimized()) {
        window2.restore()
      }
      window2.show()
      window2.focus()
    }
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        contents.removeListener('destroyed', destroyed)
      }
      const destroyed = () => {
        cleanup()
        this.pending.delete(id)
        reject(new Error('应用窗口已关闭，请重新读取状态'))
      }
      const timer = setTimeout(
        () => {
          cleanup()
          this.pending.delete(id)
          if (type === 'frontend') {
            cancelFrontend()
            this.cancelVisibleAction(String(args.actionId))
          }
          reject(new Error('界面操作未确认完成，请读取最新状态后再决定是否重试'))
        },
        type === 'frontend' ? 300000 : 20000,
      )
      this.pending.set(id, { resolve, reject, cleanup })
      contents.once('destroyed', destroyed)
      try {
        contents.send('desktop:command', { id, type, args } satisfies DesktopCommand)
      } catch (error) {
        cleanup()
        this.pending.delete(id)
        reject(error)
      }
    })
  }
  async capture(maxEdge: number, signal: AbortSignal) {
    const window2 = this.liveWindow()
    if (!window2) {
      throw new Error('应用窗口未打开，请先使用 navigate_app 或 ui_open_workspace')
    }
    if (!window2.isVisible() || window2.isMinimized()) {
      throw new Error('应用窗口已隐藏或最小化，请先显示窗口后截图')
    }
    if (this.capturing) {
      throw new Error('正在获取另一张应用截图，请稍后重试')
    }
    if (signal.aborted) {
      throw new Error('已取消')
    }
    this.capturing = true
    const lease = randomUUID()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const before = (await this.request('capture-prepare', { lease })) as DesktopCaptureReady
      if (signal.aborted) {
        throw new Error('已取消')
      }
      if (this.liveWindow() !== window2) {
        throw new Error('截图期间窗口已关闭或更换，请重新读取状态')
      }
      let image = await Promise.race([
        window2.webContents.capturePage(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('应用截图超时，请重试')), 5000)
        }),
      ])
      const capturedAt = new Date().toISOString()
      if (Date.now() >= before.expiresAt) {
        throw new Error('截图保护已过期，请重试')
      }
      if (image.isEmpty()) {
        throw new Error('应用尚未绘制画面，请稍后重试')
      }
      const after = (await this.request('snapshot')) as DesktopState
      if (before.desktop.token.split(':')[0] !== after.token.split(':')[0]) {
        throw new Error('截图期间界面已重新加载，请重试')
      }
      if (signal.aborted) {
        throw new Error('已取消')
      }
      if (
        this.window() !== window2 ||
        window2.isDestroyed() ||
        !window2.isVisible() ||
        window2.isMinimized()
      ) {
        throw new Error('截图期间窗口已关闭或隐藏，请重新读取状态')
      }
      const original = image.getSize()
      const scale = Math.min(1, maxEdge / Math.max(original.width, original.height))
      if (before.redactedFields) {
        if (!before.redactions?.length || before.desktop.token !== after.token) {
          throw new Error('截图期间敏感区域或界面发生变化，请重新截图')
        }
        // capturePage can return a compositor frame older than the CSS hide. Mask
        // the returned pixels too, before resizing, so credentials cannot leak.
        const png = PNG.sync.read(image.toPNG())
        const sx = png.width / before.viewport.width
        const sy = png.height / before.viewport.height
        for (const bounds of before.redactions) {
          const x0 = Math.max(0, Math.floor((bounds.x - 2) * sx))
          const y0 = Math.max(0, Math.floor((bounds.y - 2) * sy))
          const x1 = Math.min(png.width, Math.ceil((bounds.x + bounds.width + 2) * sx))
          const y1 = Math.min(png.height, Math.ceil((bounds.y + bounds.height + 2) * sy))
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              png.data.set([238, 238, 238, 255], (y * png.width + x) * 4)
            }
          }
        }
        image = nativeImage.createFromBuffer(PNG.sync.write(png))
      }
      if (scale < 1) {
        image = image.resize({ width: Math.max(1, Math.round(original.width * scale)) })
      }
      return {
        image,
        metadata: {
          capturedAt,
          scope: 'application-content',
          original,
          displayed: image.getSize(),
          viewport: before.viewport,
          redactedFields: before.redactedFields,
          desktop: after,
          beforeToken: before.desktop.token,
          stateChangedDuringCapture: before.desktop.token !== after.token,
        },
      }
    } finally {
      clearTimeout(timer)
      if (this.window() === window2 && !window2.isDestroyed()) {
        await this.request('capture-end', { lease }).catch(() => {})
      }
      this.capturing = false
    }
  }
  async withWorkspace<T>(id: string, work: () => Promise<T> | T): Promise<T> {
    let locked = false
    const lease = randomUUID()
    try {
      if (this.connected()) {
        locked = true
        await this.request('workspace-lock', { id, lease })
      }
      return await work()
    } finally {
      if (locked && this.connected()) {
        await this.request('workspace-release', { id, lease }).catch(() => {})
      }
      this.onChange()
    }
  }
}
