import type { AppUpdater } from 'electron-updater'
import type { UpdateInfo } from '../shared/types'

type Driver = Pick<AppUpdater, 'on' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' |
  'autoDownload' | 'autoInstallOnAppQuit' | 'allowPrerelease' | 'allowDowngrade' | 'disableWebInstaller'>
const CHECK_INTERVAL = 6 * 60 * 60 * 1000

/** Own the update lifecycle in main, including when the renderer is reloaded. */
export class AppUpdateService {
  private state: UpdateInfo
  private checking?: Promise<UpdateInfo>
  private downloading?: Promise<void>
  constructor(
    private driver: Driver | null,
    initial: Pick<UpdateInfo, 'current' | 'url' | 'manualReason'>,
    private publish: (state: UpdateInfo) => void,
    private fallback: (force: boolean) => Promise<UpdateInfo>,
    private isBusy: () => boolean
  ) {
    this.state = { ...initial, latest: '', newer: false, checkedAt: 0, revision: 0, stage: 'idle', autoSupported: !!driver }
    if (!driver) return
    // Download in our own promise so failures are observed and retries are explicit.
    driver.autoDownload = false
    driver.autoInstallOnAppQuit = false
    driver.allowPrerelease = false
    driver.allowDowngrade = false
    driver.disableWebInstaller = true
    driver.on('update-available', info => {
      const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : info.releaseNotes?.map(n => n.note).join('\n')
      this.patch({ stage: 'available', latest: info.version, newer: true, notes: notes?.slice(0, 3000), checkedAt: Date.now(), error: undefined, percent: 0 })
    })
    driver.on('update-not-available', info => this.patch({ stage: 'idle', latest: info.version, newer: false, checkedAt: Date.now(), error: undefined, percent: undefined, notes: undefined }))
    driver.on('download-progress', p => {
      if (this.state.stage === 'downloading') this.patch({ percent: Math.max(0, Math.min(100, p.percent)) })
    })
    driver.on('update-downloaded', () => this.patch({ stage: 'ready', percent: 100, error: undefined }))
    driver.on('error', e => this.fail(e))
  }
  snapshot(): UpdateInfo { return { ...this.state } }
  private patch(patch: Partial<UpdateInfo>) {
    this.state = { ...this.state, ...patch, revision: (this.state.revision ?? 0) + 1 }
    this.publish(this.snapshot())
  }
  private fail(error: unknown) {
    this.patch({ stage: 'error', error: String(error instanceof Error ? error.message : error).slice(0, 1000) })
  }
  check(force = false): Promise<UpdateInfo> {
    if (this.checking) return this.checking
    if (['downloading', 'ready', 'installing'].includes(this.state.stage ?? '')) return Promise.resolve(this.snapshot())
    if (!force && this.state.stage !== 'error' && Date.now() - this.state.checkedAt < CHECK_INTERVAL) return Promise.resolve(this.snapshot())
    this.patch({ stage: 'checking', error: undefined })
    this.checking = this.doCheck(force).finally(() => { this.checking = undefined })
    return this.checking
  }
  private async doCheck(force: boolean): Promise<UpdateInfo> {
    try {
      if (!this.driver) {
        const info = await this.fallback(force)
        this.patch({ ...info, stage: info.error ? 'error' : info.newer ? 'available' : 'idle' })
      } else {
        const result = await this.driver.checkForUpdates()
        if (!result) throw new Error('自动更新暂不可用，请稍后重试')
        if (result.isUpdateAvailable) void this.download()
      }
    } catch (e) { this.fail(e) }
    return this.snapshot()
  }
  async download(): Promise<void> {
    if (!this.driver || !this.state.newer) throw new Error('请先检查更新')
    if (this.downloading) return this.downloading
    if (['ready', 'installing'].includes(this.state.stage ?? '')) return
    this.patch({ stage: 'downloading', percent: 0, error: undefined })
    this.downloading = Promise.resolve().then(() => this.driver!.downloadUpdate())
      .then(() => {}).catch(e => this.fail(e)).finally(() => { this.downloading = undefined })
    return this.downloading
  }
  install(): void {
    if (!this.driver || this.state.stage !== 'ready') throw new Error('更新尚未下载完成')
    if (this.isBusy()) throw new Error('还有任务正在运行，请等任务结束后再更新')
    this.patch({ stage: 'installing', error: undefined })
    try { this.driver.quitAndInstall(true, true) } catch (e) { this.fail(e); throw e }
  }
}
