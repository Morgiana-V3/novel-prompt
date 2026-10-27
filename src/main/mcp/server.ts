import { Worker } from 'node:worker_threads'
import { StringDecoder } from 'node:string_decoder'
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs'
import type { McpLogEntry } from '../../shared/types'
import { dataFile } from '../paths'
import { randomUUID } from 'node:crypto'
import { connectAgent, disconnectAgent, runAsAgent } from '../agent-sessions'
import { AGENT_GUIDE_URI, agentGuide } from './agent-guide'
import { validateArguments, RESULT_SCHEMA, errorDetails } from './contract'
import { toolOutputSchema } from './output-schemas'
import { operationStore, tracksOperation, OPERATION_ID_SCHEMA } from './operations'
import { TOOL_GROUPS, toolGroup, groupCatalog, type ToolGroup } from './tool-groups'

/**
 * 最小 MCP（Model Context Protocol）服务端：stdio 上的换行分隔 JSON-RPC 2.0。
 * 支持工具、进度、取消，以及当前应用状态资源和变化订阅。
 * stdout 只能写协议消息，日志一律写 stderr。
 */

export interface McpTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  /** 返回不可用的原因（例如设置里没有开启），可用时返回 null */
  gate?: () => string | null
  run: (args: Record<string, unknown>, signal: AbortSignal, progress?: McpProgress) => Promise<string | McpResult>
}
export type McpProgress = (message: string, current?: number, total?: number) => void
export interface McpResult { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; structuredContent?: Record<string, unknown>; isError?: boolean }
export interface McpSessionOptions {
  execute?: (tool: McpTool, args: Record<string, unknown>, signal: AbortSignal, progress: McpProgress) => Promise<string | McpResult>
  state?: () => unknown
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

export function readStdinLines(onLine: (line: string) => void, onEnd: () => void): void {
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

export function createMcpSession(tools: McpTool[], info: ServerInfo, write: (line: string) => void, options: McpSessionOptions = {}) {
  const agent = { sessionId: randomUUID(), name: '外部 Agent' }
  // Start with the task-independent entry points; discover other groups on demand.
  // Discovery filters are per connection, never a permission boundary.
  let selectedGroups = new Set<ToolGroup>(['core'])
  const controlTools: McpTool[] = [
    { name: 'configure_tools', title: '选择任务工具组',
      description: '新连接默认只展示核心工具。省略 groups 查看分组；按任务传 groups 加载需要的工具组，替换本连接的可见列表（core 始终保留）。groups:[] 回到核心；查看全部传所有组名。只改变 tools/list，不改变权限或其他连接。切换后发送刷新通知，客户端须重新读取 tools/list 获取参数定义。',
      inputSchema: { type: 'object', properties: { groups: { type: 'array', items: { type: 'string', enum: Object.keys(TOOL_GROUPS) }, maxItems: 7 } }, additionalProperties: false },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false }, run: async args => {
        if (Array.isArray(args.groups)) {
          const next = new Set<ToolGroup>(['core', ...args.groups as ToolGroup[]])
          const changed = next.size !== selectedGroups.size || [...next].some(g => !selectedGroups.has(g))
          selectedGroups = next
          if (changed) send({ method: 'notifications/tools/list_changed' })
        }
        return JSON.stringify({ activeGroups: [...selectedGroups], exposedToolCount: availableTools.filter(t => selectedGroups.has(toolGroup(t.name))).length, groups: groupCatalog(availableTools) })
      } },
    { name: 'get_operation', title: '查询操作结果', description: '按 operation_id 查询执行中、成功、失败或中断的操作及原始结果；省略编号列出最近 20 次。记录在本地保留 7 天，跨连接/宿主重启有效。失败或中断可能已有部分成果，不能据此自动重试。过大结果只留摘要，需再读取对应工作台/图库。',
      inputSchema: { type: 'object', properties: { operation_id: OPERATION_ID_SCHEMA }, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false }, run: async args => JSON.stringify(operationStore().query(args.operation_id as string | undefined)) }
  ]
  const availableTools = [...tools, ...controlTools]
  const byName = new Map(availableTools.map((t) => [t.name, t]))
  const outputSchemaFor = (tool: McpTool) => tool.outputSchema ?? toolOutputSchema(tool.name) ?? RESULT_SCHEMA
  const schemaFor = (tool: McpTool) => tracksOperation(tool) ? { ...tool.inputSchema,
    properties: { ...tool.inputSchema.properties as object, operation_id: OPERATION_ID_SCHEMA } } : tool.inputSchema
  const running = new Map<Id, AbortController>()

  let closed = false, subscribed = false
  const send = (msg: Record<string, unknown>) => { if (!closed) write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n') }
  const reply = (id: Id, result: unknown) => send({ id, result })
  const fail = (id: Id | null, code: number, message: string) => send({ id, error: { code, message } })

  async function callTool(id: Id, params: Record<string, unknown>) {
    const name = String(params.name ?? '')
    const tool = byName.get(name)
    if (!tool) return fail(id, -32602, `未知工具：${name}`)
    const input = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
    const tracked = tracksOperation(tool)
    const args = { ...input }
    if (tracked) delete args.operation_id
    const start = Date.now()
    try { validateArguments(input, schemaFor(tool)) } catch (e) {
      const error = errorDetails(String((e as Error).message), 'INVALID_ARGUMENTS')
      appendLog({ at: start, tool: name, ok: false, ms: 0, summary: error.message })
      return reply(id, { content: [{ type: 'text', text: error.message }], structuredContent: { error }, isError: true })
    }
    // Resolve duplicate intent before checking current gates/tokens/revisions: this
    // returns historical evidence and never executes the mutation again.
    let store: ReturnType<typeof operationStore> | undefined
    try { if (tracked) store = operationStore() } catch {
      const error = errorDetails('无法打开操作记录，未执行本次写入；请检查当前数据目录是否可用。', 'OPERATION_JOURNAL_UNAVAILABLE')
      return reply(id, { content: [{ type: 'text', text: error.message }], structuredContent: { error }, isError: true })
    }
    const operationId = tracked ? input.operation_id as string | undefined : undefined
    const previous = operationId ? store?.find(operationId) : undefined
    if (previous && store) {
      if (!store.matches(previous, name, args)) return reply(id, { content: [{ type: 'text', text: '操作编号已用于不同工具或参数；未执行本次操作。' }], structuredContent: { error: errorDetails('操作编号已用于不同工具或参数；核对原操作，新的意图请使用新编号。', 'OPERATION_ID_CONFLICT') }, isError: true })
      const operation = { ...store.summary(previous), replayed: true }
      return reply(id, previous.result ? { ...previous.result, structuredContent: { ...previous.result.structuredContent, operation } }
        : { content: [{ type: 'text', text: JSON.stringify({ operation }) }], structuredContent: { operation }, ...(previous.status === 'interrupted' || previous.status === 'failed' ? { isError: true } : {}) })
    }
    const blocked = tool.gate?.()
    if (blocked) {
      appendLog({ at: start, tool: name, ok: false, ms: 0, summary: `未启用：${blocked}` })
      return reply(id, { content: [{ type: 'text', text: blocked }], structuredContent: { error: errorDetails(blocked, 'PERMISSION_DENIED') }, isError: true })
    }
    const ctrl = new AbortController()
    running.set(id, ctrl)
    let operation: ReturnType<NonNullable<typeof store>['begin']> | undefined
    try {
      if (store) operation = store.begin(name, args, operationId)
      let sequence = 0
      const token = (params._meta as Record<string, unknown> | undefined)?.progressToken
      const progress: McpProgress = (message) => {
        if ((typeof token === 'string' || typeof token === 'number') && !ctrl.signal.aborted)
          send({ method: 'notifications/progress', params: { progressToken: token, progress: ++sequence, message } })
      }
      const output = await runAsAgent(agent, () => options.execute && !controlTools.includes(tool) ? options.execute(tool, args, ctrl.signal, progress) : tool.run(args, ctrl.signal, progress))
      const result: McpResult = typeof output === 'string' ? { content: [{ type: 'text', text: output }] } : output
      if (typeof output === 'string') {
        try { const value = JSON.parse(output); if (value && typeof value === 'object') result.structuredContent = Array.isArray(value) ? { items: value } : value } catch { /* Narrative output remains text. */ }
      }
      const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      if (!result.structuredContent) {
        try { const parsed = JSON.parse(text); result.structuredContent = parsed && typeof parsed === 'object' ? Array.isArray(parsed) ? { items: parsed } : parsed : { text } }
        catch { result.structuredContent = { text } }
      }
      try { validateArguments(result.structuredContent, outputSchemaFor(tool), 'result') } catch (e) {
        const observedResult = result.structuredContent
        const message = `返回数据不符合 ${name} 的字段约定：${(e as Error).message}`
        result.isError = true
        result.content = [{ type: 'text', text: message + '。操作可能已经执行，请先查询实际状态，勿直接重试。' }]
        result.structuredContent = { error: { code: 'OUTPUT_CONTRACT_VIOLATION', message, retryable: false, nextAction: '操作可能已经执行；读取项目、图库或 get_operation 核对结果，不要自动重放。' }, observedResult }
      }
      appendLog({ at: start, tool: name, ok: !result.isError, ms: Date.now() - start, summary: result.content.filter(c => c.type === 'text').map(c => c.text).join(' ').replace(/\s+/g, ' ').slice(0, 120) })
      if (operation && store) store.finish(operation, result)
      reply(id, operation && store ? { ...result, structuredContent: { ...result.structuredContent, operation: store.summary(operation) } } : result)
    } catch (e) {
      const message = String((e as Error)?.message ?? e).replace(/pst-[\w-]+/g, 'pst-***')
      appendLog({ at: start, tool: name, ok: false, ms: Date.now() - start, summary: message.slice(0, 120) })
      const result: McpResult = { content: [{ type: 'text', text: `调用失败：${message}` }], structuredContent: { error: errorDetails(message) }, isError: true }
      if (operation && store) store.finish(operation, result, ctrl.signal.aborted)
      if (!ctrl.signal.aborted) reply(id, operation && store ? { ...result, structuredContent: { ...result.structuredContent, operation: store.summary(operation) } } : result)
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
        const client = params.clientInfo as { name?: unknown } | undefined
        agent.name = typeof client?.name === 'string' && client.name.trim() ? client.name.trim().slice(0, 100) : '外部 Agent'
        connectAgent(agent)
        const asked = String(params.protocolVersion ?? '')
        return reply(id, {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: { listChanged: true }, resources: { subscribe: !!options.state, listChanged: false } },
          serverInfo: { name: info.name, version: info.version },
          instructions: info.instructions
        })
      }
      case 'ping':
        return reply(id, {})
      case 'resources/list':
        return reply(id, { resources: [
          { uri: AGENT_GUIDE_URI, name: '外部 Agent 操作指南', mimeType: 'text/markdown', description: '能力地图、前后台选择、工作流、恢复和边界；与 agent_guide(topic=all) 内容一致' },
          ...(options.state ? [{ uri: 'novelprompt://app/state', name: '当前应用状态', mimeType: 'application/json', description: '当前页面、提示词、工作台和任务；不含账户密钥' }] : [])
        ] })
      case 'resources/read':
        if (params.uri === AGENT_GUIDE_URI) return reply(id, { contents: [{ uri: AGENT_GUIDE_URI, mimeType: 'text/markdown', text: agentGuide('all').content }] })
        if (!options.state || params.uri !== 'novelprompt://app/state') return fail(id, -32602, '未知资源')
        return reply(id, { contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(options.state()) }] })
      case 'resources/subscribe':
      case 'resources/unsubscribe':
        if (!options.state || params.uri !== 'novelprompt://app/state') return fail(id, -32602, '未知资源')
        subscribed = method === 'resources/subscribe'; return reply(id, {})
      case 'tools/list':
        return reply(id, {
          tools: availableTools.filter(t => selectedGroups.has(toolGroup(t.name))).map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description + (t.gate?.() ? `\n（当前未启用：${t.gate()}）` : ''),
            inputSchema: schemaFor(t),
            outputSchema: outputSchemaFor(t),
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

  return {
    toolCount: availableTools.length,
    receive: (line: string) => {
      if (closed || !line.trim()) return
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return fail(null, -32700, '无法解析的 JSON')
      }
      for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!m || typeof m !== 'object' || Array.isArray(m) || m.jsonrpc !== '2.0'
          || m.params !== undefined && (!m.params || typeof m.params !== 'object' || Array.isArray(m.params))
          || m.id !== undefined && typeof m.id !== 'string' && typeof m.id !== 'number') {
          fail(m && (typeof m.id === 'string' || typeof m.id === 'number') ? m.id : null, -32600, '无效的 JSON-RPC 请求'); continue
        }
        if (m.id !== undefined && running.has(m.id)) { fail(m.id, -32600, '请求 id 正在使用'); continue }
        handle(m as Message)
      }
    },
    changed: () => { if (subscribed) send({ method: 'notifications/resources/updated', params: { uri: 'novelprompt://app/state' } }) },
    close: () => {
      closed = true
      disconnectAgent(agent.sessionId)
      for (const c of running.values()) c.abort()
      running.clear()
    }
  }
}

export function startMcpServer(tools: McpTool[], info: ServerInfo, onClose: () => void): void {
  const session = createMcpSession(tools, info, writeStdout)
  readStdinLines(session.receive, () => { session.close(); onClose() })
  process.stderr.write(`[novel-prompt] MCP 服务已启动，提供 ${session.toolCount} 个工具\n`)
}
