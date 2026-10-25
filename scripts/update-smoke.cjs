// Real electron-updater downloads only a harmless fixture from loopback. Never launches an installer.
const { app } = require('electron')
const { EventEmitter } = require('node:events')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { createHash } = require('node:crypto')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const ts = require('typescript')
const profile = mkdtempSync(join(tmpdir(), 'np-update-smoke-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText, f)
const { AppUpdateService } = require('../src/main/app-updater.ts')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function wait(predicate) {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await pause(25) }
  throw new Error('Timed out waiting for update state')
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const initial = { current: '0.5.0', url: 'https://github.com/Morgiana-V3/novel-prompt/releases/latest' }

async function stateTests() {
  const driver = new EventEmitter(), checked = deferred(), downloaded = deferred(), states = []
  let checks = 0, downloads = 0, installs = 0, busy = false, failDownload = true
  driver.checkForUpdates = async () => {
    checks++; await checked.promise
    driver.emit('update-available', { version: '0.5.1', releaseNotes: 'fixture' })
    return { isUpdateAvailable: true }
  }
  driver.downloadUpdate = async () => {
    downloads++
    if (failDownload) throw new Error('fixture offline')
    await downloaded.promise
    driver.emit('update-downloaded', {})
    return []
  }
  driver.quitAndInstall = (silent, restart) => { assert.equal(silent, true); assert.equal(restart, true); installs++ }
  const service = new AppUpdateService(driver, initial, s => states.push(s), () => assert.fail('fallback used'), () => busy)
  assert.equal(driver.autoInstallOnAppQuit, false)
  assert.equal(driver.allowDowngrade, false)
  assert.equal(driver.allowPrerelease, false)
  assert.throws(() => service.install(), /尚未/)
  const a = service.check(), b = service.check(true)
  assert.equal(a, b); checked.resolve(); await a
  await wait(() => service.snapshot().stage === 'error')
  assert.equal(checks, 1); assert.equal(downloads, 1)
  failDownload = false
  const retry = service.download()
  await wait(() => downloads === 2)
  driver.emit('download-progress', { percent: 42.5 })
  assert.equal(service.snapshot().percent, 42.5)
  await service.check(true)
  assert.equal(checks, 1, 'checking must not discard a download')
  downloaded.resolve(); await retry
  assert.equal(service.snapshot().stage, 'ready')
  await service.check(true); assert.equal(checks, 1, 'checking must not discard a ready installer')
  busy = true; assert.throws(() => service.install(), /任务/); assert.equal(installs, 0)
  busy = false; service.install(); assert.equal(installs, 1)
  assert.throws(() => service.install(), /尚未/)
  assert.ok(states.every((s, i) => i === 0 || s.revision > states[i - 1].revision))
  const fallback = new AppUpdateService(null, { ...initial, manualReason: 'portable' }, () => {}, async () => ({ ...initial, latest:'0.5.1', newer:true, checkedAt: Date.now() }), () => false)
  await fallback.check(); assert.equal(fallback.snapshot().autoSupported, false)
  await assert.rejects(fallback.download(), /检查/); assert.throws(() => fallback.install(), /尚未/)
  console.log('PASS single-flight checks, failed download/retry, progress, busy/install guards, portable fallback, monotonic snapshots')
}

async function downloadTests() {
  const { NsisUpdater } = require('electron-updater')
  const body = Buffer.from('NovelPrompt updater test fixture; this is NOT an executable.')
  const hash = createHash('sha512').update(body).digest('base64')
  let corrupt = true, requested = 0
  const server = createServer((req, res) => {
    if (req.url.split('?')[0] === '/latest.yml') {
      res.end(`version: 99.0.0\nfiles:\n  - url: fixture.exe\n    sha512: ${hash}\n    size: ${body.length}\npath: fixture.exe\nsha512: ${hash}\nreleaseDate: '2026-10-25T00:00:00.000Z'\n`)
    } else if (req.url.split('?')[0] === '/fixture.exe') {
      requested++; const bytes = corrupt ? Buffer.from('corrupted fixture') : body
      res.writeHead(200, { 'Content-Length': bytes.length }); res.end(bytes)
    } else { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const config = join(profile, 'app-update.yml')
  writeFileSync(config, `provider: generic\nurl: ${url}\nupdaterCacheDirName: fixture-cache\n`)
  const make = () => {
    const driver = new NsisUpdater({ provider: 'generic', url })
    driver.forceDevUpdateConfig = true
    driver.updateConfigPath = config
    Object.defineProperty(driver.app, 'baseCachePath', { value: profile })
    driver.logger = null
    driver.quitAndInstall = () => assert.fail('Real installer must never be launched in tests')
    return { driver, service: new AppUpdateService(driver, initial, () => {}, () => assert.fail('fallback'), () => false) }
  }
  try {
    const { driver, service } = make()
    await service.check(true)
    await wait(() => service.snapshot().stage === 'error')
    assert.match(service.snapshot().error, /sha512|checksum/i)
    assert.throws(() => service.install(), /尚未/)
    corrupt = false; await service.download()
    assert.equal(service.snapshot().stage, 'ready')
    assert.equal(readFileSync(driver.installerPath).equals(body), true)
    assert.ok(driver.installerPath.startsWith(profile))
    const requestsBeforeRestart = requested
    const restarted = make()
    await restarted.service.check(true)
    await wait(() => restarted.service.snapshot().stage === 'ready')
    assert.equal(requested, requestsBeforeRestart, 'restart should reuse verified cached download')
    console.log('PASS real NSIS updater: manifest, corrupt-file rejection, differential fallback, retry, checksum verification, cached download after restart')
  } finally { await new Promise(resolve => server.close(resolve)) }
}

app.whenReady().then(async () => {
  try { await stateTests(); await downloadTests(); console.log('Update smoke passed:', profile); app.exit(0) }
  catch (e) { console.error(e); app.exit(1) }
})
