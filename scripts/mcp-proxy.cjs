// Thin stdio client: all agents and the UI execute in one application host.
const { spawn } = require('node:child_process')
const { createConnection } = require('node:net')
const { createHash } = require('node:crypto')
const { readFileSync, statSync } = require('node:fs')
const { resolve, dirname, join } = require('node:path')
const { homedir, tmpdir } = require('node:os')
const { resolveRuntimeProfile } = require('./runtime-profile.cjs')
const { StringDecoder } = require('node:string_decoder')

const args = process.argv.slice(2)
const root = args[0] ? resolve(args[0]) : dirname(process.execPath)
// Repository proxies use the development profile, including headless cold starts.
let profile = ''
try {
  if (args[0] || process.env.NOVELPROMPT_USER_DATA) {
    profile = resolveRuntimeProfile({ packaged: !args[0] })
    process.env.NOVELPROMPT_USER_DATA = profile
  }
} catch (error) { process.stderr.write(`[novel-prompt] ${error.message}\n`); process.exit(1) }
const key = createHash('sha256').update([root.toLowerCase(), homedir(), profile].join('|')).digest('hex').slice(0, 24)
const descriptor = join(tmpdir(), `novelprompt-${key}`, 'bridge.json')
let connected, stopped = false, reconnecting = false, usable = false, initialized
let activeGroups, sequence = 0, hostText = '', hostDecoder = new StringDecoder('utf8')
const calls = new Map(), internal = new Map(), subscriptions = new Set()
const sendClient = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const failure = (id, code, kind, nextAction, operationId) => sendClient({ id, error: { code, message: nextAction, data: { kind, operationId, retryable: false } } })
function hostMessage(message) {
  const own = internal.get(message.id)
  if (own) { clearTimeout(own.timer); internal.delete(message.id); own.resolve(message); return }
  const pending = calls.get(message.id)
  if (pending) {
    calls.delete(message.id)
    if (message.result && !message.result.isError) {
      if (pending.method === 'initialize') initialized = pending.params
      if (pending.method === 'tools/call' && pending.params?.name === 'configure_tools') activeGroups = message.result.structuredContent?.activeGroups
      if (pending.method === 'resources/subscribe') subscriptions.add(pending.params.uri)
      if (pending.method === 'resources/unsubscribe') subscriptions.delete(pending.params.uri)
    }
    sendClient({ ...message, id: pending.id })
  } else if (message.id === undefined) sendClient(message)
}
function hostBytes(bytes) {
  hostText += hostDecoder.write(bytes)
  let end
  while ((end = hostText.indexOf('\n')) >= 0) {
    const line = hostText.slice(0, end); hostText = hostText.slice(end + 1)
    if (line.trim()) { try { hostMessage(JSON.parse(line)) } catch { connected?.destroy() } }
  }
}
function lost(socket) {
  if (connected !== socket) return
  connected = undefined; usable = false
  for (const request of calls.values()) failure(request.id, -32001, 'OUTCOME_UNKNOWN',
    '应用连接中断，操作结果尚未确认；连接会自动恢复。先读取 get_app_state，并用 get_operation 查询已有操作编号，勿直接重试写入或生图。', request.params?.arguments?.operation_id)
  calls.clear()
  for (const wait of internal.values()) { clearTimeout(wait.timer); wait.reject(Error('Application bridge disconnected')) }
  internal.clear()
  if (!stopped) void recover()
}
function control(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = `relay:${++sequence}`
    const timer = setTimeout(() => { internal.delete(id); reject(Error('Session restore timed out')) }, 10000)
    internal.set(id, { resolve, reject, timer })
    connected.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  }).then(message => { if (message.error || message.result?.isError) throw Error('Session restore rejected'); return message.result })
}
// A development build can be absent on a clean checkout or briefly incomplete.
// Never ask Electron to load a missing package entry (it opens a native error box).
function developmentBuildReady() {
  if (!args[0]) return true
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    if (typeof manifest.main !== 'string' || !manifest.main) return false
    return [manifest.main, 'out/preload/index.js', 'out/renderer/index.html'].every(file => {
      const stat = statSync(resolve(root, file))
      return stat.isFile() && stat.size > 0
    })
  } catch { return false }
}
process.stdin.pause()
function connect() {
  return new Promise((resolve, reject) => {
    let config
    try { config = JSON.parse(readFileSync(descriptor, 'utf8')) } catch(e) { reject(e); return }
    const socket = createConnection(config.address)
    let pending = Buffer.alloc(0), ready = false
    const timer = setTimeout(() => { socket.destroy(); reject(Error('Bridge handshake timeout')) }, 2000)
    socket.on('error', e => { if (!ready) { clearTimeout(timer); reject(e) } else process.stderr.write(`[novel-prompt] ${e.message}\n`) })
    socket.once('connect', () => socket.write(JSON.stringify({ token: config.token, toolGroups: activeGroups ?? process.env.NOVELPROMPT_MCP_GROUPS }) + '\n'))
    socket.on('data', bytes => {
      if (ready) { if (connected === socket) hostBytes(bytes); return }
      pending = Buffer.concat([pending, bytes])
      const end = pending.indexOf(10)
      if (end < 0) return
      let handshake
      try { handshake = JSON.parse(pending.subarray(0, end).toString()) } catch { socket.destroy(); return }
      if (!handshake || typeof handshake !== 'object') { socket.destroy(); return }
      if (handshake.bridgeError) { clearTimeout(timer); reject(Object.assign(Error(handshake.bridgeError), { fatal: true })); socket.destroy(); return }
      if (handshake.bridgeReady !== true) { socket.destroy(); return }
      ready = true; clearTimeout(timer)
      if (pending.length > end + 1) hostBytes(pending.subarray(end + 1))
      pending = Buffer.alloc(0); resolve(socket)
    })
    socket.on('close', () => {
      clearTimeout(timer)
      if (!ready) reject(Error('Application bridge disconnected'))
      else if (stopped) process.exit(0)
      else lost(socket)
    })
  })
}
async function openHost() {
  let starting = false
  const deadline = Date.now() + 30000
  while (!stopped && Date.now() < deadline) {
    try { return await connect() } catch (error) { if (error.fatal) throw error }
    if (!starting && developmentBuildReady()) {
      starting = true
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const host = spawn(process.execPath, [...args, '--mcp-host'], { env, detached: true, windowsHide: true, stdio: 'ignore' })
      host.on('error', e => process.stderr.write(`[novel-prompt] ${e.message}\n`)); host.unref()
    }
    await new Promise(r => setTimeout(r, 150))
  }
  throw Error(!starting && args[0] && !developmentBuildReady()
    ? '开发版构建文件尚未就绪。请在项目目录运行 npm run build，完成后重新连接；本次未启动不完整的应用。'
    : '无法连接 NovelPrompt，请检查应用是否正常启动后重试')
}
async function recover() {
  if (reconnecting || stopped) return
  reconnecting = true
  try {
    hostText = ''; hostDecoder = new StringDecoder('utf8')
    connected = await openHost()
    if (initialized) {
      await control('initialize', initialized)
      connected.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      for (const uri of subscriptions) await control('resources/subscribe', { uri })
    }
    usable = true
    sendClient({ method: 'notifications/tools/list_changed' })
    for (const uri of subscriptions) sendClient({ method: 'notifications/resources/updated', params: { uri } })
    process.stderr.write('[novel-prompt] 连接已恢复。请读取 get_app_state 核对新会话、编辑归属和待处理操作；没有重放任何应用操作。\n')
  } catch (error) {
    connected?.destroy(); connected = undefined; usable = false
    process.stderr.write(`[novel-prompt] 连接恢复失败：${error.message}。下次请求将再次尝试连接；该请求不会自动执行。\n`)
  } finally { reconnecting = false }
}
let clientText = '', clientDecoder = new StringDecoder('utf8')
function clientMessage(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string'
    || message.id !== undefined && typeof message.id !== 'string' && typeof message.id !== 'number') {
    failure(null, -32600, 'INVALID_REQUEST', '无效的 JSON-RPC 请求'); return
  }
  if (!usable) {
    if (message.id !== undefined) failure(message.id, -32002, 'NOT_SENT', '正在恢复应用连接，本请求尚未发送。稍后先读取 get_app_state，再核对原有操作结果。')
    void recover(); return
  }
  if (message.id === undefined) {
    if (message.method === 'notifications/cancelled') {
      const found = [...calls].find(([, call]) => call.id === message.params?.requestId)
      if (!found) return
      message = { ...message, params: { ...message.params, requestId: found[0] } }
    }
    connected.write(JSON.stringify(message) + '\n'); return
  }
  if ([...calls.values()].some(call => call.id === message.id)) { failure(message.id, -32600, 'DUPLICATE_ID', '请求 id 正在使用'); return }
  const id = `relay:${++sequence}`
  calls.set(id, message)
  connected.write(JSON.stringify({ ...message, id }) + '\n')
}
process.stdin.on('data', bytes => {
  clientText += clientDecoder.write(bytes)
  let end
  while ((end = clientText.indexOf('\n')) >= 0) {
    const line = clientText.slice(0, end); clientText = clientText.slice(end + 1)
    if (!line.trim()) continue
    if (Buffer.byteLength(line) > 16 * 1024 * 1024) { failure(null, -32600, 'INVALID_REQUEST', '请求过大'); continue }
    let parsed
    try { parsed = JSON.parse(line) } catch { failure(null, -32700, 'PARSE_ERROR', '无法解析的 JSON'); continue }
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) clientMessage(message)
  }
  if (Buffer.byteLength(clientText) > 16 * 1024 * 1024) { process.stderr.write('[novel-prompt] 未结束的请求过大\n'); process.exit(1) }
})
async function main() { connected = await openHost(); usable = true; process.stdin.resume() }
process.stdin.on('end', () => { stopped = true; connected?.end() })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopped = true; connected?.end(); process.exit(0) })
main().catch(e => { process.stderr.write(`[novel-prompt] ${e.message}\n`); process.exit(1) })
