import { Worker } from 'node:worker_threads'
import { StringDecoder } from 'node:string_decoder'
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs'
import type { McpLogEntry } from '../../shared/types'
import { dataFile } from '../paths'

/**
 * 最小 MCP（Model Context Protocol）服务端：stdio 上的换行分隔 JSON-RPC 2.0。
 * 只实现 tools 能力：initialize / ping / tools/list / tools/call / notifications/cancelled。
 * stdout 只能写协议消息，日志一律写 stderr。
 */

export interface McpTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  /** 返回不可用的原因（例如设置里没有开启），可用时返回 null */
  gate?: () => string | null
  run: (args: Record<string, unknown>, signal: AbortSignal) => Promise<string>
}

export interface ServerInfo {
  name: string
  version: string
  instructions: string
}

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

type Id = string | number
interface Message {
  jsonrpc: '2.0'
  id?: Id
  method?: string
  params?: Record<string, unknown>
}

/* ---------- 调用日志（设置页展示） ---------- */

const LOG_FILE = 'mcp-log.jsonl'
const LOG_KEEP = 300

export function appendLog(e: McpLogEntry): void {
  try {
    const file = dataFile(LOG_FILE)
    appendFileSync(file, JSON.stringify(e) + '\n', 'utf8')
    if (statSync(file).size > 200_000) {
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      writeFileSync(file, lines.slice(-LOG_KEEP).join('\n') + '\n', 'utf8')
    }
  } catch {
    /* 日志失败不影响调用 */
  }
}

export function readLog(limit = 30): McpLogEntry[] {
  const file = dataFile(LOG_FILE)
  if (!existsSync(file)) return []
  try {
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .slice(-limit)
      .reverse()
      .map((l) => JSON.parse(l) as McpLogEntry)
  } catch {
    return []
  }
}

/**
 * 读取 stdin：Electron 主进程在 Windows 上的 process.stdin 不会触发读事件，
 * 所以放到 worker 线程里对 fd 0 做阻塞读，按块发回主线程。
 */
const STDIN_WORKER = `
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

function readStdinLines(onLine: (line: string) => void, onEnd: () => void): void {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  const worker = new Worker(STDIN_WORKER, { eval: true })
  worker.on('message', (m: { data?: Uint8Array; end?: boolean; error?: string }) => {
    if (m.error) process.stderr.write(`[novel-prompt] 读取 stdin 出错：${m.error}\n`)
    if (m.data) {
      pending += decoder.write(Buffer.from(m.data))
      let i: number
      while ((i = pending.indexOf('\n')) >= 0) {
        onLine(pending.slice(0, i).replace(/\r$/, ''))
        pending = pending.slice(i + 1)
      }
    }
    if (m.end) {
      if (pending.trim()) onLine(pending)
      onEnd()
    }
  })
  worker.on('error', (e: Error) => {
    process.stderr.write(`[novel-prompt] stdin 线程出错：${e.message}\n`)
    onEnd()
  })
}

/** 同步写 fd 1：保证每条消息完整、按顺序写出 */
function writeStdout(text: string): void {
  const buf = Buffer.from(text, 'utf8')
  let off = 0
  while (off < buf.length) {
    try {
      off += writeSync(1, buf, off)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EAGAIN') continue
      throw e
    }
  }
}

/* ---------- 服务端 ---------- */

export function startMcpServer(tools: McpTool[], info: ServerInfo, onClose: () => void): void {
  const byName = new Map(tools.map((t) => [t.name, t]))
  const running = new Map<Id, AbortController>()

  const send = (msg: Record<string, unknown>) => writeStdout(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
  const reply = (id: Id, result: unknown) => send({ id, result })
  const fail = (id: Id | null, code: number, message: string) => send({ id, error: { code, message } })

  async function callTool(id: Id, params: Record<string, unknown>) {
    const name = String(params.name ?? '')
    const tool = byName.get(name)
    if (!tool) return fail(id, -32602, `未知工具：${name}`)
    const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
    const start = Date.now()
    const blocked = tool.gate?.()
    if (blocked) {
      appendLog({ at: start, tool: name, ok: false, ms: 0, summary: `未启用：${blocked}` })
      return reply(id, { content: [{ type: 'text', text: blocked }], isError: true })
    }
    const ctrl = new AbortController()
    running.set(id, ctrl)
    try {
      const text = await tool.run(args, ctrl.signal)
      appendLog({ at: start, tool: name, ok: true, ms: Date.now() - start, summary: text.replace(/\s+/g, ' ').slice(0, 120) })
      reply(id, { content: [{ type: 'text', text }] })
    } catch (e) {
      const message = String((e as Error)?.message ?? e).replace(/pst-[\w-]+/g, 'pst-***')
      appendLog({ at: start, tool: name, ok: false, ms: Date.now() - start, summary: message.slice(0, 120) })
      if (!ctrl.signal.aborted) reply(id, { content: [{ type: 'text', text: `调用失败：${message}` }], isError: true })
    } finally {
      running.delete(id)
    }
  }

  function handle(msg: Message) {
    const { id, method, params = {} } = msg
    // 没有 method 的是客户端对我们请求的响应，这里不会发请求，忽略
    if (!method) return
    if (id === undefined) {
      if (method === 'notifications/cancelled') running.get(params.requestId as Id)?.abort()
      return
    }
    switch (method) {
      case 'initialize': {
        const asked = String(params.protocolVersion ?? '')
        return reply(id, {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: info.name, version: info.version },
          instructions: info.instructions
        })
      }
      case 'ping':
        return reply(id, {})
      case 'tools/list':
        return reply(id, {
          tools: tools.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description + (t.gate?.() ? `\n（当前未启用：${t.gate()}）` : ''),
            inputSchema: t.inputSchema,
            annotations: t.annotations
          }))
        })
      case 'tools/call':
        void callTool(id, params)
        return
      default:
        return fail(id, -32601, `不支持的方法：${method}`)
    }
  }

  readStdinLines(
    (line) => {
      if (!line.trim()) return
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return fail(null, -32700, '无法解析的 JSON')
      }
      for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
        if (m && typeof m === 'object') handle(m as Message)
      }
    },
    () => {
      for (const c of running.values()) c.abort()
      onClose()
    }
  )
  process.stderr.write(`[novel-prompt] MCP 服务已启动，提供 ${tools.length} 个工具\n`)
}
