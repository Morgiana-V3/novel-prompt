import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createMcpSession } from './server'
import { initialToolGroups } from './tool-groups'
import { type McpSessionOptions, type McpTool, type ServerInfo } from './types'

/** Kept in sync with mcp-proxy.cjs; descriptor holds only this local session's authentication secret. */
export function bridgePaths(root: string, profile = '') {
  const key = createHash('sha256')
    .update([resolve(root).toLowerCase(), homedir(), profile].join('|'))
    .digest('hex')
    .slice(0, 24)
  const dir = join(tmpdir(), `novelprompt-${key}`)
  return {
    dir,
    descriptor: join(dir, 'bridge.json'),
    address:
      process.platform === 'win32'
        ? String.raw`\\.\pipe\novelprompt-${key}`
        : join(dir, 'bridge.sock'),
  }
}
export async function startMcpBridge(
  root: string,
  profile: string,
  tools: McpTool[],
  info: ServerInfo,
  options: McpSessionOptions,
) {
  const paths = bridgePaths(root, profile)
  const secret = randomBytes(32).toString('hex')
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 })
  const sessions = new Set<ReturnType<typeof createMcpSession>>()
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    let authenticated = false
    const authTimer = setTimeout(() => socket.destroy(), 5000)
    let session: ReturnType<typeof createMcpSession> | undefined
    const lines = createInterface({ input: socket, crlfDelay: Infinity })
    lines.on('line', (line) => {
      if (Buffer.byteLength(line) > 16 * 1024 * 1024) {
        return socket.destroy()
      }
      if (!authenticated) {
        let handshake: { token?: unknown; toolGroups?: unknown }
        try {
          handshake = JSON.parse(line)
        } catch {
          socket.destroy()
          return
        }
        if (!handshake || typeof handshake !== 'object') {
          socket.destroy()
          return
        }
        const token = handshake.token ?? ''
        const provided = Buffer.from(String(token))
        const expected = Buffer.from(secret)
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
          return socket.destroy()
        }
        try {
          session = createMcpSession(tools, info, (line) => socket.write(line), {
            ...options,
            initialGroups: initialToolGroups(handshake.toolGroups),
          })
        } catch (error) {
          clearTimeout(authTimer)
          socket.end(JSON.stringify({ bridgeError: String((error as Error).message) }) + '\n')
          return
        }
        authenticated = true
        clearTimeout(authTimer)
        sessions.add(session)
        socket.write('{"bridgeReady":true}\n')
        return
      }
      session!.receive(line)
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      clearTimeout(authTimer)
      sockets.delete(socket)
      if (session) {
        sessions.delete(session)
        session.close()
      }
      lines.close()
    })
  })
  if (process.platform !== 'win32') {
    try {
      unlinkSync(paths.address)
    } catch {}
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(paths.address, resolve)
  })
  if (process.platform !== 'win32') {
    chmodSync(paths.address, 0o600)
  }
  const temp = `${paths.descriptor}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify({ address: paths.address, token: secret, pid: process.pid }), {
    mode: 0o600,
  })
  renameSync(temp, paths.descriptor)
  return {
    changed: () => {
      for (const session of sessions) {
        session.changed()
      }
    },
    close: () => {
      for (const session of sessions) {
        session.close()
      }
      for (const socket of sockets) {
        socket.destroy()
      }
      server.close()
      try {
        unlinkSync(paths.descriptor)
      } catch {}
    },
    clients: () => sessions.size,
  }
}
