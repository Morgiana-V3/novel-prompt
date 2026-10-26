// Exercise the actual main entry and preload; no mocked IPC handlers or provider calls.
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url))
const profile = mkdtempSync(join(tmpdir(), 'np-workspace-startup-'))
const env = { ...process.env, NOVELPROMPT_USER_DATA: profile }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(createRequire(import.meta.url)('electron'), [root, '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', ws
child.stdout.on('data', bytes => { output += bytes })
child.stderr.on('data', bytes => { output += bytes })
async function wait(test) {
  for (let i = 0; i < 200; i++) {
    const value = await test()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('Timed out: ' + output)
}
try {
  const port = await wait(() => /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1])
  const target = await wait(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'))
  ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open')
  let sequence = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const response = JSON.parse(event.data), item = pending.get(response.id)
    if (item) { pending.delete(response.id); clearTimeout(item.timer); response.error ? item.reject(Error(response.error.message)) : item.resolve(response.result) }
  })
  const js = async expression => {
    const response = await new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Renderer timed out')) }, 10000)
      pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description ?? 'Renderer error')
    return response.result.value
  }
  await wait(() => js('!!window.api && !!document.querySelector(".nav-item")'))
  assert.deepEqual(await js('window.api.pagesRemoved()'), [])
  const params = { width: 832, height: 1216, count: 1, seed: null, steps: 23, scale: 5, cfgRescale: 0, sampler: 'k_euler_ancestral', noiseSchedule: 'native', qualityTags: false, ucPreset: 'none' }
  const page = await js(`window.api.pagesCreate(null,${JSON.stringify(params)},'v5',{base:'startup fixture',negative:'',characters:[]})`)
  await js(`window.api.pagesDelete(${JSON.stringify(page.id)},${page.revision})`)
  const removed = await js('window.api.pagesRemoved()'); assert.equal(removed.length, 1)
  const restored = await js(`window.api.pagesRestore(${JSON.stringify(removed[0].token)})`)
  assert.equal(restored.id, page.id); assert.deepEqual(await js('window.api.pagesRemoved()'), [])
  await js(`document.querySelectorAll('.nav-item')[4].click(); true`)
  await wait(() => js(`document.querySelector('.sessions-home > button')?.textContent.includes('（0）')`))
  assert.equal(await js(`!!document.querySelector('.sessions-home .error-box')`), false)
  console.log('PASS actual main/preload IPC: recycle list, delete, restore and workspace UI; no missing handlers')
  const fingerprint = () => createHash('sha256').update(readFileSync(join(root, 'out/main/index.js'))).digest('hex')
  const before = fingerprint()
  const blocked = spawnSync(process.execPath, [join(root, 'scripts/dev.cjs')], { env, encoding: 'utf8', windowsHide: true, timeout: 10000 })
  assert.equal(blocked.status, 1); assert.ok(blocked.stderr.includes(`PID ${child.pid}`)); assert.ok(blocked.stderr.includes('本次未覆盖构建文件'))
  assert.equal(fingerprint(), before)
  assert.deepEqual(await js('window.api.pagesRemoved()'), [])
  console.log('PASS dev startup detects live host before building; existing host and output stay intact')
  await js('setTimeout(()=>window.close(),100); true')
  ws.close(); await wait(() => child.exitCode !== null); assert.equal(child.exitCode, 0)
  console.log('Artifacts:', profile)
} catch (error) { console.error(error); process.exitCode = 1 }
finally { ws?.close(); if (child.exitCode === null) child.kill() }
