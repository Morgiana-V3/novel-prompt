import { StringDecoder } from 'node:string_decoder'
import { Worker } from 'node:worker_threads'

/**
 * 读取 stdin：Electron 主进程在 Windows 上的 process.stdin 不会触发读事件，
 * 所以放到 worker 线程里对 fd 0 做阻塞读，按块发回主线程。
 */
export const STDIN_WORKER = `
const { parentPort } = require('node:worker_threads')
const fs = require('node:fs')
const buf = Buffer.alloc(65536)
const sleep = new Int32Array(new SharedArrayBuffer(4))
for (;;) {
  let n = 0
  try {
    n = fs.readSync(0, buf, 0, buf.length, null)
  } catch (e) {
    if (e.code === 'EAGAIN') { Atomics.wait(sleep, 0, 0, 20); continue }
    if (e.code !== 'EOF') parentPort.postMessage({ error: String(e && e.message || e) })
    n = 0
  }
  if (!n) { parentPort.postMessage({ end: true }); break }
  parentPort.postMessage({ data: Uint8Array.prototype.slice.call(buf, 0, n) })
}
`

export function readStdinLines(onLine: (line: string) => void, onEnd: () => void): void {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  const worker = new Worker(STDIN_WORKER, { eval: true })
  worker.on('message', (message: { data?: Uint8Array; end?: boolean; error?: string }) => {
    if (message.error) {
      process.stderr.write(`[novel-prompt] 读取 stdin 出错：${message.error}\n`)
    }
    if (message.data) {
      pending += decoder.write(Buffer.from(message.data))
      let i: number
      while ((i = pending.indexOf('\n')) >= 0) {
        onLine(pending.slice(0, i).replace(/\r$/, ''))
        pending = pending.slice(i + 1)
      }
    }
    if (message.end) {
      if (pending.trim()) {
        onLine(pending)
      }
      onEnd()
    }
  })
  worker.on('error', (error: Error) => {
    process.stderr.write(`[novel-prompt] stdin 线程出错：${error.message}\n`)
    onEnd()
  })
}
