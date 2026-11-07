import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createConnection } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { outsideRepository } from '../support/fixtures.cjs'

const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '')
const { resolveRuntimeProfile } = createRequire(import.meta.url)(
  '../../src/runtime/runtime-profile.cjs',
)
export const redact = (value) => String(value).replace(/\b(?:pst|sk)-[\w-]+/g, '[redacted]')

/** Explicit caller assertion only: receiving a response or caching a file is not retention. */
export function retainedSkillDigests(sections, confirmation) {
  assert.equal(
    confirmation?.bodiesPresentInCurrentContext,
    true,
    '调用方必须逐篇确认正文仍在当前模型上下文；磁盘缓存或目录不等于保留正文',
  )
  assert.ok(Array.isArray(sections), '必须传实际保留的 sections 正文')
  const retained = new Map()
  for (const section of sections) {
    assert.ok(typeof section.id === 'string' && section.id, '正文必须有篇目标识')
    assert.equal(typeof section.text, 'string', '不能从 manifest 或仅含指纹的记录声明已读')
    assert.equal(createHash('sha256').update(section.text).digest('hex'), section.digest)
    assert.ok(!retained.has(section.id), '同一篇目不能声明多个正文版本')
    retained.set(section.id, section.digest)
  }
  return Object.fromEntries(retained)
}

const normalizePath = (path) => {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/** Refuse an old bundle, another repository/profile or an installed app before any writes. */
export function assertCurrentDevState(client, state) {
  assert.equal(state.hostPid, client.hostPid, '必须连接当前桥接描述对应的开发宿主')
  const runtime = state.runtime
  assert.equal(runtime?.mode, 'development', '必须连接开发模式实例')
  assert.equal(normalizePath(runtime.appPath), normalizePath(root), '宿主必须属于当前项目')
  assert.equal(
    normalizePath(runtime.dataPath),
    normalizePath(client.dataRoot),
    '实际数据目录必须一致',
  )
  const buildPath = join(root, 'out/main/index.js')
  const buildHash = createHash('sha256').update(readFileSync(buildPath)).digest('hex')
  assert.equal(
    runtime.buildHash,
    buildHash,
    '开发宿主未加载当前主进程构建，请等待 dev watch 完成重载',
  )
  assert.ok(Number.isFinite(runtime.startedAt), '宿主必须提供加载时间')
  client.buildModifiedAt = statSync(buildPath).mtime.toISOString()
  client.loadedRuntime = { ...runtime }
}

export function auditDirectory() {
  const directory = outsideRepository(
    join(tmpdir(), 'novelprompt-current-dev-audit', `${Date.now()}-${randomUUID()}`),
  )
  mkdirSync(directory, { recursive: true })
  return directory
}

/** Connect directly to the existing development host. Never spawn or stop an application. */
export async function connectCurrentDev() {
  const profile = resolveRuntimeProfile({ packaged: false, override: '' })
  const key = createHash('sha256')
    .update([root.toLowerCase(), homedir(), profile].join('|'))
    .digest('hex')
    .slice(0, 24)
  const descriptorPath = join(tmpdir(), `novelprompt-${key}`, 'bridge.json')
  if (!existsSync(descriptorPath)) {
    throw new Error('当前开发实例未运行；请先启动 npm run dev。测试不会冷启动宿主或创建隔离配置。')
  }
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
  if (!Number.isSafeInteger(descriptor.pid) || descriptor.pid <= 0) {
    throw new Error('当前开发实例桥接描述无效')
  }
  process.kill(descriptor.pid, 0)
  const location = join(profile, 'storage-location.json')
  const dataRoot = existsSync(location)
    ? JSON.parse(readFileSync(location, 'utf8')).path || profile
    : profile
  const socket = createConnection(descriptor.address)
  const waiting = new Map()
  let sequence = 0
  let closed = false
  let ready = false
  let settleHandshake
  let rejectHandshake
  const handshake = new Promise((resolve, reject) => {
    settleHandshake = resolve
    rejectHandshake = reject
  })
  const fail = (error) => {
    closed = true
    rejectHandshake(error)
    for (const pending of waiting.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    waiting.clear()
  }
  const handshakeTimer = setTimeout(() => socket.destroy(new Error('开发实例桥接握手超时')), 5000)
  socket.on('error', fail)
  socket.on('close', () => fail(new Error('开发实例连接已断开；不重连、不重放任何操作')))
  const lines = createInterface({ input: socket, crlfDelay: Infinity })
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      socket.destroy(new Error('开发实例返回非 JSON 协议数据'))
      return
    }
    if (!ready) {
      if (message.bridgeReady !== true) {
        socket.destroy(new Error(redact(message.bridgeError || '开发实例拒绝桥接')))
        return
      }
      ready = true
      settleHandshake()
      return
    }
    const pending = waiting.get(message.id)
    if (pending) {
      clearTimeout(pending.timer)
      waiting.delete(message.id)
      pending.resolve(message)
    }
  })
  socket.once('connect', () =>
    socket.write(JSON.stringify({ token: descriptor.token, toolGroups: 'all' }) + '\n'),
  )
  try {
    await handshake
  } finally {
    clearTimeout(handshakeTimer)
  }
  const notify = (method, params = {}) =>
    socket.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  const request = (method, params = {}, timeoutMs = 600_000) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('开发实例连接已关闭'))
        return
      }
      const id = ++sequence
      const timer = setTimeout(() => {
        waiting.delete(id)
        notify('notifications/cancelled', { requestId: id })
        reject(new Error(`Timeout ${method}; 操作结果可能未知，禁止自动重放`))
      }, timeoutMs)
      waiting.set(id, { timer, resolve, reject })
      socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  return {
    profile,
    dataRoot,
    hostPid: descriptor.pid,
    buildModifiedAt: statSync(join(root, 'out/main/index.js')).mtime.toISOString(),
    request,
    notify,
    close: () => {
      lines.close()
      socket.end()
    },
  }
}
