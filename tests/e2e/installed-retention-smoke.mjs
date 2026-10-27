import { temporaryProfile } from '../support/fixtures.cjs'
// Windows-only. Both installers MUST use the isolated acceptance appId/productName,
// with shortcuts and runAfterFinish disabled. Never pass a production installer.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import assert from 'node:assert/strict'

const [oldArg, newArg] = process.argv.slice(2)
if (process.platform !== 'win32' || !oldArg || !newArg) {
  throw Error(
    'Usage: node tests/e2e/installed-retention-smoke.mjs <acceptance-baseline.exe> <acceptance-current.exe>',
  )
}
const oldInstaller = resolve(oldArg)
const newInstaller = resolve(newArg)
assert.equal(basename(oldInstaller), 'NovelPrompt-Acceptance-baseline.exe')
assert.equal(basename(newInstaller), 'NovelPrompt-Acceptance-current.exe')
// Require build evidence of an isolated app identity before launching either installer.
for (const path of [oldInstaller, newInstaller]) {
  const config = JSON.parse(
    readFileSync(join(resolve(path, '..'), 'acceptance-build.json'), 'utf8'),
  )
  assert.equal(config.appId, 'com.holyxie.novelprompt.acceptance')
  assert.equal(config.productName, 'NovelPrompt Acceptance')
  for (const field of ['createDesktopShortcut', 'createStartMenuShortcut', 'runAfterFinish']) {
    assert.equal(config[field], false)
  }
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), config.sha256)
}
const root = temporaryProfile('np-installed-retention-')
const install = join(root, 'app')
const profile = join(root, 'profile')
mkdirSync(profile)
mkdirSync(join(profile, 'images'))
mkdirSync(join(profile, 'data'))
const exe = join(install, 'NovelPrompt Acceptance.exe')
const processes = new Set()
const results = []
const log = (s) => {
  results.push(s)
  console.log('PASS', s)
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function wait(test, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = await test()
    if (value) {
      return value
    }
    await pause(100)
  }
  throw Error('Timed out waiting for installed app')
}
async function run(path, args) {
  const child = spawn(path, args, { windowsHide: true, stdio: 'ignore' })
  processes.add(child)
  await Promise.race([
    once(child, 'exit').then(([code]) => assert.equal(code, 0)),
    new Promise((_, reject) => {
      const t = setTimeout(() => reject(Error('Process timeout: ' + basename(path))), 120000)
      t.unref()
    }),
  ])
  processes.delete(child)
}
const server = createServer((_req, res) => {
  res.writeHead(404)
  res.end('Isolated test: updates disabled')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const updateUrl = `http://127.0.0.1:${server.address().port}`
function isolateUpdater() {
  writeFileSync(
    join(install, 'resources', 'app-update.yml'),
    `provider: generic\nurl: ${updateUrl}\nupdaterCacheDirName: novelprompt-acceptance-only\n`,
  )
}
async function launch() {
  isolateUpdater()
  const env = { ...process.env, NOVELPROMPT_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(exe, ['--remote-debugging-port=0'], {
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  processes.add(child)
  let output = ''
  child.stderr.on('data', (b) => (output += b))
  child.stdout.on('data', (b) => (output += b))
  const port = await wait(() => {
    if (child.exitCode !== null) {
      throw Error('App exited: ' + output)
    }
    return /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1]
  })
  const target = await wait(async () => {
    try {
      return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
        (t) => t.type === 'page',
      )
    } catch {
      return null
    }
  })
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await once(ws, 'open')
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    const p = pending.get(m.id)
    if (p) {
      pending.delete(m.id)
      if (m.error) {
        p.reject(Error(m.error.message))
      } else {
        p.resolve(m.result)
      }
    }
  })
  const command = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id
      pending.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  const js = async (expression) => {
    const r = await command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      throw Error(r.exceptionDetails.exception?.description ?? 'Renderer exception')
    }
    return r.result.value
  }
  await wait(() => js('!!window.api && !!document.querySelector(".nav-item")'))
  return {
    child,
    js,
    command,
    async close() {
      await js('setTimeout(()=>window.close(),100); true')
      ws.close()
      await wait(() => child.exitCode !== null, 15000)
      assert.equal(child.exitCode, 0)
      processes.delete(child)
    },
    async crash() {
      ws.close()
      child.kill()
      await once(child, 'exit')
      processes.delete(child)
    },
  }
}
const png = new PNG({ width: 64, height: 64 })
png.data.fill(255)
const bytes = PNG.sync.write(png)
const params = {
  width: 64,
  height: 64,
  steps: 1,
  scale: 5,
  cfgRescale: 0,
  sampler: 'k_euler',
  noiseSchedule: 'native',
  seed: 42,
  count: 1,
  qualityTags: false,
  ucPreset: 'none',
}
const request = { base: 'fixture cat', negative: 'blurry', characters: [], params, version: 'v5' }
const recipe = { schema: 1, createdAt: Date.now(), sourceKind: 'generate', request }
const tempDir = join(profile, 'image-library', 'temporary')
function temp() {
  mkdirSync(tempDir, { recursive: true })
  const name = randomUUID() + '.png'
  writeFileSync(join(tempDir, name), bytes)
  writeFileSync(join(tempDir, name + '.json'), JSON.stringify(recipe))
  return name
}
let lock
try {
  await run(oldInstaller, ['/S', `/D=${install}`])
  assert.ok(existsSync(exe))
  writeFileSync(join(profile, 'images', 'legacy.png'), bytes)
  writeFileSync(join(profile, 'images', 'ordinary-old.png'), bytes)
  let app = await launch()
  assert.equal((await app.js('window.api.updateState()')).current, '0.6.0')
  const oldPage = await app.js(
    `window.api.pagesCreate('legacy.png',${JSON.stringify(params)},'v5',${JSON.stringify(request)})`,
  )
  const ownedImage = oldPage.versions.find(
    (version) => version.id === oldPage.currentVersionId,
  ).image
  assert.ok(ownedImage?.name.startsWith(`ws-${oldPage.id}-`))
  await app.js(`window.api.saveSettings({naiAutoSave:true,naiVersion:'v5'})`)
  await app.close()
  mkdirSync(join(profile, 'skills', 'user'), { recursive: true })
  writeFileSync(join(profile, 'skills', 'user', 'acceptance.md'), 'Acceptance fixture skill\n')
  const oldDoc = readFileSync(
    join(profile, 'data', 'page-workspaces', oldPage.id + '.json'),
    'utf8',
  )
  const settingsBefore = readFileSync(join(profile, 'data', 'settings.json'), 'utf8')
  const oldHash = createHash('sha256').update(readFileSync(exe)).digest('hex')
  log('baseline 0.6.0 installed, real window created a legacy workspace and exited normally')
  const stale = temp()
  await run(newInstaller, ['/S', `/D=${install}`])
  assert.notEqual(createHash('sha256').update(readFileSync(exe)).digest('hex'), oldHash)
  assert.equal(
    readFileSync(join(profile, 'data', 'page-workspaces', oldPage.id + '.json'), 'utf8'),
    oldDoc,
  )
  assert.equal(readFileSync(join(profile, 'data', 'settings.json'), 'utf8'), settingsBefore)
  // Hold a real Windows handle that denies deletion during startup.
  const quoted = join(tempDir, stale).replace(/'/g, "''")
  const script = `$f=[System.IO.File]::Open('${quoted}',[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read);[Console]::WriteLine('LOCKED');[Console]::ReadLine()|Out-Null;$f.Dispose()`
  lock = spawn(
    'powershell.exe',
    ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  processes.add(lock)
  let lockOutput = ''
  lock.stdout.on('data', (b) => (lockOutput += b))
  await wait(() => lockOutput.includes('LOCKED'))
  app = await launch()
  assert.equal((await app.js('window.api.updateState()')).current, '0.6.1-acceptance.1')
  assert.ok((await app.js('window.api.imagesCleanupStatus()')).message)
  assert.ok(await app.js('document.body.textContent.includes("重试清理")'))
  assert.equal(
    (await app.js(`window.api.pagesRead('${oldPage.id}')`)).currentVersionId,
    oldPage.currentVersionId,
  )
  const images = await app.js('window.api.naiList()')
  // The baseline already copies imported originals into workspace-owned images.
  // Verify both retained originals and the actual owned copy after upgrade.
  assert.equal(images.find((i) => i.name === 'legacy.png').storage, 'saved')
  assert.equal(images.find((i) => i.name === ownedImage.name).storage, 'workspace')
  assert.equal(
    createHash('sha256')
      .update(
        readFileSync(join(profile, 'image-library', 'workspaces', oldPage.id, ownedImage.name)),
      )
      .digest('hex'),
    ownedImage.contentHash,
  )
  assert.equal(images.find((i) => i.name === 'ordinary-old.png').storage, 'saved')
  await assert.rejects(
    app.js(`window.api.naiDelete(${JSON.stringify(ownedImage.name)})`),
    /工作台|会话/,
  )
  lock.stdin.end('\n')
  await once(lock, 'exit')
  processes.delete(lock)
  lock = null
  assert.equal((await app.js('window.api.imagesCleanupRetry()')).message, '')
  assert.ok(!existsSync(join(tempDir, stale)))
  assert.equal(
    readFileSync(join(profile, 'skills', 'user', 'acceptance.md'), 'utf8'),
    'Acceptance fixture skill\n',
  )
  log(
    'actual NSIS overwrite upgrade preserved settings, legacy images, Skill and workspace; locked cache did not block startup and retry succeeded',
  )
  const ephemeral = temp()
  const retained = temp()
  await app.js(`window.api.naiRetain('${retained}')`)
  const owned = await app.js(
    `window.api.pagesCreate('${ephemeral}',${JSON.stringify(params)},'v5',${JSON.stringify(request)})`,
  )
  const savedRecipe = await app.js(
    `window.api.recipesCreateWorkspace('${owned.id}','${owned.currentVersionId}')`,
  )
  await app.js('window.api.saveSettings({naiAutoSave:false})')
  await app.close()
  assert.ok(!existsSync(join(tempDir, ephemeral)))
  assert.ok(existsSync(join(profile, 'image-library', 'saved', retained)))
  app = await launch()
  assert.equal((await app.js('window.api.getSettings()')).naiAutoSave, false)
  assert.ok((await app.js('window.api.recipesList()')).some((r) => r.id === savedRecipe.id))
  const restored = await app.js(`window.api.pagesRead('${owned.id}')`)
  assert.equal(restored.versions[0].image.missing, false)
  assert.equal(
    (await app.js(`window.api.pagesRead('${oldPage.id}')`)).currentVersionId,
    oldPage.currentVersionId,
  )
  log(
    'normal exit removed temporary images; restart retained saved images, workspace copies, recipes and toggle',
  )
  const crashed = temp()
  await app.crash()
  assert.ok(existsSync(join(tempDir, crashed)))
  app = await launch()
  assert.ok(!existsSync(join(tempDir, crashed)))
  await app.close()
  log('forced termination left cache; next startup recovered and cleaned only temporary data')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  for (const p of processes) {
    try {
      p.kill()
    } catch {}
  }
  await pause(500)
  const uninstaller = existsSync(install)
    ? readdirSync(install).find((n) => /^Uninstall .*Acceptance.*\.exe$/i.test(n))
    : null
  if (uninstaller) {
    try {
      await run(join(install, uninstaller), ['/S'])
      await wait(() => !existsSync(exe), 20000)
      log('isolated acceptance installation uninstalled')
    } catch (e) {
      console.error('Test uninstall failed:', e)
      process.exitCode = 1
    }
  }
  server.close()
  writeFileSync(
    join(root, 'results.json'),
    JSON.stringify({ passed: !process.exitCode, results, profile, install }, null, 2),
  )
  console.log('Acceptance evidence:', root)
}
