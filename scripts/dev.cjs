// Check before Vite rewrites out/: a retained MCP host may still own the old main process.
const { spawn } = require('node:child_process')
const { createConnection } = require('node:net')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { homedir, tmpdir } = require('node:os')
const { resolveRuntimeProfile } = require('./runtime-profile.cjs')

const root = resolve(__dirname, '..')
async function runningHost() {
  const profile = process.env.NOVELPROMPT_USER_DATA
  const key = createHash('sha256').update([root.toLowerCase(), homedir(), profile].join('|')).digest('hex').slice(0, 24)
  let config
  try { config = JSON.parse(readFileSync(join(tmpdir(), `novelprompt-${key}`, 'bridge.json'), 'utf8')) } catch { return null }
  return new Promise(resolve => {
    const socket = createConnection(config.address)
    let buffer = '', done = false
    const finish = value => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(value) }
    const timer = setTimeout(() => finish(null), 2000)
    socket.on('error', () => finish(null))
    socket.on('close', () => finish(null))
    socket.once('connect', () => socket.write(JSON.stringify({ token: config.token }) + '\n'))
    socket.on('data', bytes => {
      buffer += bytes
      if (!buffer.includes('\n')) return
      try { finish(JSON.parse(buffer.slice(0, buffer.indexOf('\n'))).bridgeReady === true ? config.pid : null) }
      catch { finish(null) }
    })
  })
}
async function main() {
  process.env.NOVELPROMPT_USER_DATA = resolveRuntimeProfile({ packaged: false })
  const pid = await runningHost()
  if (pid) {
    console.error(`开发版未启动：当前项目仍有应用 / MCP 宿主运行（PID ${pid}）。请先保存工作并完整退出该宿主，再运行 npm run dev。关闭窗口后，已连接的 MCP 可能仍让宿主驻留。为避免新界面连接旧后台，本次未覆盖构建文件。`)
    process.exitCode = 1
    return
  }
  console.log(`NovelPrompt 开发版 · 数据目录：${process.env.NOVELPROMPT_USER_DATA}`)
  const child = spawn(process.execPath, [join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'dev', '--watch', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', windowsHide: true })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
