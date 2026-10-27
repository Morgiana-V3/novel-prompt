// Exercise proxy cold-start races without launching an incomplete Electron app.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { EventEmitter } = require('node:events')
const { runInNewContext } = require('node:vm')
const source = readFileSync(join(__dirname, 'mcp-proxy.cjs'), 'utf8')

async function scenario({ readyAt = Infinity, existing = false, packaged = false, partial = false } = {}) {
  let now = 0, spawned = 0, piped = false, stderr = '', exitCode = null, done = false
  const timers = new Set(), root = resolve(__dirname, '..'), stdin = new EventEmitter()
  stdin.pause = () => {}; stdin.resume = () => { piped = true }
  const proc = Object.assign(new EventEmitter(), {
    argv: ['electron', 'proxy', ...packaged ? [] : [root]], env: {}, execPath: 'electron', stdin,
    stdout: { write() {} }, stderr: { write(s) { stderr += s } }, exit(code) { exitCode = code }
  })
  const mocks = {
    'node:fs': {
      readFileSync(path) {
        if (path.endsWith('package.json')) return JSON.stringify({ main: './out/main/index.js' })
        if (existing || spawned) return JSON.stringify({ token: 'fixture', address: 'fixture' })
        throw Error('not built')
      },
      statSync(path) {
        if (now < readyAt && !(partial && path.endsWith(join('main', 'index.js')))) throw Error('missing build file')
        return { isFile: () => true, size: 100 }
      }
    },
    'node:net': { createConnection() {
      const socket = new EventEmitter(); socket.destroy = () => {}; socket.end = () => {}
      socket.write = () => queueMicrotask(() => socket.emit('data', Buffer.from('{"bridgeReady":true}\n')))
      queueMicrotask(() => socket.emit('connect'))
      return socket
    } },
    'node:child_process': { spawn() {
      assert.ok(packaged || now >= readyAt, 'never spawn Electron until all build outputs exist')
      spawned++; return Object.assign(new EventEmitter(), { unref() {} })
    } },
    './runtime-profile.cjs': { resolveRuntimeProfile: () => 'isolated-profile' }
  }
  const context = { require: name => mocks[name] ?? require(name), process: proc, Buffer,
    Date: { now: () => now },
    setTimeout(fn, delay) { const timer = { fn, at: now + delay }; timers.add(timer); return timer },
    clearTimeout(timer) { timers.delete(timer) }
  }
  runInNewContext(source.replace('main().catch(', 'globalThis.result = main().catch('), context)
  context.result.finally(() => { done = true })
  for (let i = 0; !done && i < 500; i++) {
    await new Promise(setImmediate)
    if (done) break
    const timer = [...timers].sort((a, b) => a.at - b.at)[0]
    assert.ok(timer, 'proxy should be connected or waiting')
    timers.delete(timer); now = timer.at; timer.fn()
  }
  assert.ok(done)
  return { spawned, piped, stderr, exitCode }
}

;(async () => {
  const missing = await scenario()
  assert.equal(missing.spawned, 0); assert.equal(missing.exitCode, 1)
  assert.match(missing.stderr, /npm run build/)
  for (const partial of [false, true]) {
    const rebuilding = await scenario({ readyAt: 600, partial })
    assert.equal(rebuilding.spawned, 1); assert.equal(rebuilding.piped, true)
  }
  const running = await scenario({ existing: true })
  assert.equal(running.spawned, 0); assert.equal(running.piped, true)
  const installed = await scenario({ packaged: true })
  assert.equal(installed.spawned, 1); assert.equal(installed.piped, true)
  console.log('PASS missing/incomplete builds never launch Electron; build completion reconnects; live hosts and packaged apps remain available')
})().catch(error => { console.error(error); process.exitCode = 1 })
