// Run the built project and an existing packaged executable together in throwaway profiles.
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { mkdtempSync, existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url), { resolveRuntimeProfile } = require('./runtime-profile.cjs')
const root = fileURLToPath(new URL('..', import.meta.url)), electron = require('electron')
const packaged = resolve(process.env.NP_PACKAGED_EXECUTABLE || join(root, 'release/win-unpacked/NovelPrompt.exe'))
if (!existsSync(packaged)) throw Error('Set NP_PACKAGED_EXECUTABLE to an existing packaged app; tests use isolated data only')
const testRoot = mkdtempSync(join(tmpdir(), 'np-environment-isolation-'))
const appData = join(testRoot, 'profiles'); mkdirSync(appData)
const stableProfile = join(appData, 'novel-prompt'), devProfile = join(appData, 'novel-prompt-dev')
assert.equal(resolveRuntimeProfile({ packaged: false, appData, override: '' }), devProfile)
assert.equal(resolveRuntimeProfile({ packaged: true, appData, defaultUserData: stableProfile, override: '' }), stableProfile)
for (const override of [stableProfile, join(stableProfile, '..nested'), appData, join(appData, 'NovelPrompt')]) {
  assert.throws(() => resolveRuntimeProfile({ packaged: false, appData, override }), /开发版不能/)
}
mkdirSync(stableProfile)
const alias = join(testRoot, 'production-alias')
symlinkSync(stableProfile, alias, process.platform === 'win32' ? 'junction' : 'dir')
assert.throws(() => resolveRuntimeProfile({ packaged: false, appData, override: alias }), /开发版不能/)
const rejected = spawnSync(process.execPath, [join(root, 'scripts/dev.cjs')], { env: { ...process.env, NOVELPROMPT_USER_DATA: resolveRuntimeProfile({ packaged: true, override: '' }) }, encoding: 'utf8', windowsHide: true, timeout: 10000 })
assert.equal(rejected.status, 1); assert.ok(rejected.stderr.includes('开发版不能'))
console.log('PASS default paths, production-directory refusal, ancestor/child paths and junction protection')

const apps = [], clients = []
async function wait(test) {
  for (let i = 0; i < 250; i++) { const value = await test(); if (value) return value; await new Promise(r => setTimeout(r, 100)) }
  throw Error('Timed out waiting for application')
}
async function launch(exe, args, profile) {
  const env = { ...process.env, NOVELPROMPT_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(exe, [...args, '--remote-debugging-port=0'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const app = { child, profile, ws: null }; apps.push(app)
  let output = ''
  child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  const port = await wait(() => { if (child.exitCode !== null) throw Error(output); return /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1] })
  const target = await wait(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'))
  const ws = app.ws = new WebSocket(target.webSocketDebuggerUrl); await once(ws, 'open')
  const pending = new Map(); let next = 0
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data), p = pending.get(m.id)
    if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result) }
  })
  app.js = async expression => {
    const r = await new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('Renderer timed out')) }, 10000)
      pending.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || 'Renderer error')
    return r.result.value
  }
  await wait(() => app.js('!!window.api && !!document.querySelector(".nav-item")'))
  return app
}
async function connect(exe, args, profile) {
  const child = spawn(exe, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NOVELPROMPT_USER_DATA: profile }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  clients.push(child); let next = 0, errors = ''; const pending = new Map()
  child.stderr.on('data', b => { errors += b })
  createInterface({ input: child.stdout }).on('line', line => {
    const m = JSON.parse(line), p = pending.get(m.id)
    if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result) }
  })
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ': ' + errors)) }, 15000)
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'isolation-smoke', version: '1' } })
  return async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args })
    if (r.isError) throw Error(r.content[0].text)
    return r.structuredContent ?? JSON.parse(r.content[0].text)
  }
}
try {
  const stable = await launch(packaged, [], stableProfile)
  const dev = await launch(electron, [root], devProfile)
  assert.notEqual(stable.child.pid, dev.child.pid)
  const info = await dev.js('window.api.mcpInfo()')
  assert.equal(info.runtime.mode, 'development'); assert.equal(info.runtime.dataPath, devProfile)
  assert.equal(info.env.NOVELPROMPT_USER_DATA, devProfile); assert.equal(info.serverName, 'novel-prompt-dev')
  await wait(() => dev.js(`document.querySelector('.brand-sub').textContent.includes('开发版')`))
  await dev.js(`localStorage.setItem('isolation-fixture','development'); window.api.saveSettings({naiAutoSave:false})`)
  await stable.js(`localStorage.setItem('isolation-fixture','installed'); window.api.saveSettings({naiAutoSave:true})`)
  assert.equal(await dev.js(`localStorage.getItem('isolation-fixture')`), 'development')
  assert.equal(await stable.js(`localStorage.getItem('isolation-fixture')`), 'installed')
  assert.equal((await dev.js('window.api.getSettings()')).naiAutoSave, false)
  assert.equal((await stable.js('window.api.getSettings()')).naiAutoSave, true)
  const params = { width: 832, height: 1216, count: 1, seed: null, steps: 23, scale: 5, cfgRescale: 0, sampler: 'k_euler_ancestral', noiseSchedule: 'native', qualityTags: false, ucPreset: 'none' }
  const make = label => `window.api.pagesCreate(null,${JSON.stringify(params)},'v5',{base:${JSON.stringify(label)},negative:'',characters:[]})`
  const devPage = await dev.js(make('dev-only')), stablePage = await stable.js(make('installed-only'))
  assert.deepEqual((await dev.js('window.api.pagesList()')).map(p => p.id), [devPage.id])
  assert.deepEqual((await stable.js('window.api.pagesList()')).map(p => p.id), [stablePage.id])
  console.log('PASS packaged and development processes coexist; settings, browser storage and workspace writes are independent')
  const devMcp = await connect(electron, [join(root, 'scripts/mcp-proxy.cjs'), root], devProfile)
  const stableMcp = await connect(packaged, [join(dirname(packaged), 'resources/mcp-proxy.cjs')], stableProfile)
  assert.equal((await devMcp('get_app_state')).hostPid, dev.child.pid)
  assert.equal((await stableMcp('get_app_state')).hostPid, stable.child.pid)
  assert.deepEqual((await devMcp('list_workspaces')).items.map(p => p.id), [devPage.id])
  assert.deepEqual((await stableMcp('list_workspaces')).items.map(p => p.id), [stablePage.id])
  await dev.js(`window.api.pagesDelete(${JSON.stringify(devPage.id)},${devPage.revision})`)
  assert.equal((await dev.js('window.api.pagesRemoved()')).length, 1)
  assert.deepEqual((await stable.js('window.api.pagesList()')).map(p => p.id), [stablePage.id])
  console.log('PASS each MCP resolves its own host and data; development deletion does not alter installed sessions')
  console.log('Artifacts:', testRoot)
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  for (const c of clients) c.stdin.end()
  for (const app of apps) {
    try { await app.js('setTimeout(()=>window.close(),50); true') } catch {}
    app.ws?.close()
  }
  await new Promise(r => setTimeout(r, 300))
  for (const c of clients) c.kill()
  for (const app of apps) if (app.child.exitCode === null) app.child.kill()
}
