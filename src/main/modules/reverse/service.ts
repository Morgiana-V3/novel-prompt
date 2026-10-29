import { utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { join } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import type { ReverseModel, ReverseResult } from '../../../shared/reverse/types'
import { ReverseModels } from './models'

export class ReverseService extends ReverseModels {
  private child?: UtilityProcess
  private cancelRun?: () => void

  override cancel(): void {
    super.cancel()
    this.cancelRun?.()
  }

  async analyze(
    bytes: Uint8Array,
    workerPath: string,
    selection?: ReverseModel[],
  ): Promise<ReverseResult> {
    if (this.busy) {
      throw new Error('请等待当前操作完成')
    }
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 25 * 1024 * 1024) {
      throw new Error('请选择不超过 25 MB 的图片')
    }
    this.phase = 'running'
    this.message = '正在检查本地模型'
    let cancelled = false
    this.cancelRun = () => {
      cancelled = true
    }
    const input = join(this.directory, 'input.tmp')
    try {
      await this.ensureVerified(selection)
      if (cancelled) {
        throw new Error('已取消识别')
      }
      await mkdir(this.directory, { recursive: true })
      await writeFile(input, bytes)
      if (cancelled) {
        throw new Error('已取消识别')
      }
      return await new Promise<ReverseResult>((resolve, reject) => {
        const child = utilityProcess.fork(
          workerPath,
          [this.directory, input, JSON.stringify(selection ?? ['k2', 'k3', 'wd'])],
          {
            stdio: 'ignore',
            serviceName: 'NovelPrompt 本地识图',
          },
        )
        this.child = child
        const timer = setTimeout(() => reject(new Error('识别超时，可缩小图片后重试')), 180_000)
        this.cancelRun = () => reject(new Error('已取消识别'))
        child.on(
          'message',
          (message: { stage?: string; result?: ReverseResult; error?: string }) => {
            if (message.stage) {
              this.message = message.stage
            }
            if (message.result) {
              clearTimeout(timer)
              resolve(message.result)
            }
            if (message.error) {
              clearTimeout(timer)
              reject(new Error(message.error))
            }
          },
        )
        child.on('exit', () => {
          clearTimeout(timer)
          reject(new Error('本地识别进程已退出；请检查可用内存或重新下载模型'))
        })
      })
    } finally {
      this.child?.kill()
      this.child = undefined
      this.cancelRun = undefined
      try {
        await rm(input, { force: true })
      } finally {
        this.phase = 'idle'
        this.message = ''
      }
    }
  }
}
