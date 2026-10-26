// Thin stdio client: all agents and the UI execute in one application host.
const { spawn } = require('node:child_process')
const { createConnection } = require('node:net')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { resolve, dirname, join } = require('node:path')
const { homedir, tmpdir } = require('node:os')
const { resolveRuntimeProfile } = require('./runtime-profile.cjs')

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
let connected, starting = false, stopped = false
process.stdin.pause()
function connect() {
  return new Promise((resolve, reject) => {
    let config
    try { config = JSON.parse(readFileSync(descriptor, 'utf8')) } catch(e) { reject(e); return }
    const socket = createConnection(config.address)
    let pending = Buffer.alloc(0), ready = false
    const timer = setTimeout(() => { socket.destroy(); reject(Error('Bridge handshake timeout')) }, 2000)
    socket.on('error', e => { if (!ready) { clearTimeout(timer); reject(e) } else process.stderr.write(`[novel-prompt] ${e.message}\n`) })
    socket.once('connect', () => socket.write(JSON.stringify({ token: config.token }) + '\n'))
    socket.on('data', bytes => {
      if (ready) { process.stdout.write(bytes); return }
      pending = Buffer.concat([pending, bytes])
      const end = pending.indexOf(10)
      if (end < 0) return
      if (!pending.subarray(0, end).toString().includes('"bridgeReady":true')) { socket.destroy(); return }
      ready = true; clearTimeout(timer)
      if (pending.length > end + 1) process.stdout.write(pending.subarray(end + 1))
      pending = Buffer.alloc(0); resolve(socket)
    })
    socket.on('close', () => {
      clearTimeout(timer)
      if (!ready) reject(Error('Application bridge disconnected'))
      else process.exit(stopped ? 0 : 1) // Never replay a request after disconnecting.
    })
  })
}
async function main() {
  const deadline = Date.now() + 30000
  while (!stopped && Date.now() < deadline) {
    try { connected = await connect(); break } catch {}
    if (!starting) {
      starting = true
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const host = spawn(process.execPath, [...args, '--mcp-host'], { env, detached: true, windowsHide: true, stdio: 'ignore' })
      host.on('error', e => process.stderr.write(`[novel-prompt] ${e.message}\n`)); host.unref()
    }
    await new Promise(r => setTimeout(r, 150))
  }
  if (!connected) throw Error('无法连接 NovelPrompt，请退出旧版本并重新打开应用后重试')
  process.stdin.pipe(connected)
}
process.stdin.on('end', () => { stopped = true; connected?.end() })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopped = true; connected?.end(); process.exit(0) })
main().catch(e => { process.stderr.write(`[novel-prompt] ${e.message}\n`); process.exit(1) })
