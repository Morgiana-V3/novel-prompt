import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReverseModel, ReverseStatus } from '../../../shared/reverse/types'
import { MODEL_FILES } from './catalog'

export interface ModelFile {
  model?: ReverseModel
  file: string
  bytes: number
  sha256: string
  url: string
  name: string
  source: string
  license: string
}

export async function verifyFile(path: string, spec: ModelFile): Promise<boolean> {
  try {
    if ((await stat(path)).size !== spec.bytes) {
      return false
    }
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk)
    }
    return hash.digest('hex') === spec.sha256
  } catch {
    return false
  }
}

export class ReverseModels {
  phase: ReverseStatus['phase'] = 'idle'
  message = ''
  completedBytes = 0
  private controller?: AbortController
  private verified = new Set<string>()
  private removing = false
  private operationBytes = 0

  selectedFiles(selection?: ReverseModel[]): ModelFile[] {
    return this.files.filter((file) => !selection || selection.includes(file.model ?? 'k2'))
  }

  constructor(
    readonly directory: string,
    readonly files: ModelFile[] = MODEL_FILES,
    private readonly fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  ) {}

  get busy(): boolean {
    return !!this.controller || this.removing || this.phase === 'running'
  }

  async status(selection?: ReverseModel[]): Promise<ReverseStatus> {
    const models = await Promise.all(
      this.files.map(async (file) => {
        let ready = false
        try {
          ready = (await stat(join(this.directory, file.file))).size === file.bytes
        } catch {
          /* Not installed yet. */
        }
        return {
          model: file.model ?? 'k2',
          name: file.name,
          ready,
          bytes: file.bytes,
          source: file.source,
          license: file.license,
        }
      }),
    )
    return {
      phase: this.phase,
      ready: models.filter((m) => !selection || selection.includes(m.model)).every((m) => m.ready),
      completedBytes: this.completedBytes,
      totalBytes: this.operationBytes,
      message: this.message,
      directory: this.directory,
      models,
    }
  }

  cancel(): void {
    this.controller?.abort()
  }

  async ensureVerified(selection?: ReverseModel[]): Promise<void> {
    for (const spec of this.selectedFiles(selection)) {
      if (!this.verified.has(spec.file)) {
        this.message = `正在检查 ${spec.name}`
        if (!(await verifyFile(join(this.directory, spec.file), spec))) {
          throw new Error(`${spec.name} 尚未下载或文件损坏，请下载修复模型`)
        }
        this.verified.add(spec.file)
      }
    }
  }

  async install(localPaths?: string[], selection?: ReverseModel[]): Promise<void> {
    if (this.busy) {
      throw new Error('请等待当前操作完成')
    }
    const controller = new AbortController()
    this.controller = controller
    this.operationBytes = 0
    this.phase = 'verifying'
    this.message = '正在检查已有模型'
    this.completedBytes = 0
    this.verified.clear()
    try {
      await mkdir(this.directory, { recursive: true })
      const pending: ModelFile[] = []
      for (const spec of this.selectedFiles(selection)) {
        controller.signal.throwIfAborted()
        this.message = `正在检查 ${spec.name}`
        const target = join(this.directory, spec.file)
        const valid = await verifyFile(target, spec)
        controller.signal.throwIfAborted()
        if (valid) {
          this.verified.add(spec.file)
        } else {
          pending.push(spec)
        }
      }
      // Existing files are checked first and never counted as transferred bytes.
      this.operationBytes = pending.reduce((sum, spec) => sum + spec.bytes, 0)
      for (const spec of pending) {
        controller.signal.throwIfAborted()
        const target = join(this.directory, spec.file)
        const partial = target + '.partial'
        const hash = createHash('sha256')
        const startBytes = this.completedBytes
        let received = 0
        this.message = `正在准备 ${spec.name}`
        const handle = await open(partial, 'w')
        try {
          let chunks: AsyncIterable<Uint8Array>
          if (localPaths) {
            let source: string | undefined
            for (const path of localPaths) {
              controller.signal.throwIfAborted()
              if (await verifyFile(path, spec)) {
                source = path
                break
              }
            }
            if (!source) {
              throw new Error(`选中的文件中缺少匹配版本的 ${spec.name}`)
            }
            chunks = createReadStream(source)
            this.phase = 'verifying'
          } else {
            this.phase = 'downloading'
            const response = await this.fetcher(spec.url, {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)]),
            })
            if (!response.ok || !response.body) {
              throw new Error(
                `下载失败（${response.status}），请检查网络后重试，或导入已下载的模型`,
              )
            }
            const length = response.headers.get('content-length')
            if (length && Number(length) !== spec.bytes) {
              throw new Error('下载文件大小与固定版本不符')
            }
            chunks = response.body as unknown as AsyncIterable<Uint8Array>
          }
          this.message = `${localPaths ? '正在导入' : '正在下载'} ${spec.name}`
          for await (const chunk of chunks) {
            controller.signal.throwIfAborted()
            received += chunk.byteLength
            if (received > spec.bytes) {
              throw new Error('下载内容超出模型文件大小')
            }
            hash.update(chunk)
            await handle.writeFile(chunk)
            this.completedBytes = startBytes + received
          }
          this.phase = 'verifying'
          if (received !== spec.bytes || hash.digest('hex') !== spec.sha256) {
            throw new Error(`${spec.name} 校验失败，请重试下载`)
          }
          controller.signal.throwIfAborted()
          await handle.close()
          await rename(partial, target)
          this.verified.add(spec.file)
        } finally {
          await handle.close()
          await rm(partial, { force: true })
        }
      }
      this.phase = 'idle'
      this.message = '模型已就绪，可以离线识别'
    } catch (error) {
      this.phase = controller.signal.aborted ? 'idle' : 'error'
      this.message = controller.signal.aborted
        ? '已取消；完整下载的文件会保留，下次继续下载缺少的文件'
        : String(error instanceof Error ? error.message : error)
    } finally {
      this.controller = undefined
    }
  }

  async remove(selection?: ReverseModel[]): Promise<void> {
    if (this.busy) {
      throw new Error('请先停止识别或下载')
    }
    this.removing = true
    try {
      for (const file of this.selectedFiles(selection)) {
        await rm(join(this.directory, file.file), { force: true })
        await rm(join(this.directory, file.file + '.partial'), { force: true })
      }
      this.verified.clear()
      this.phase = 'idle'
      this.message = '已删除本地模型，需要时可重新下载'
      this.completedBytes = 0
      this.operationBytes = 0
    } finally {
      this.removing = false
    }
  }
}
