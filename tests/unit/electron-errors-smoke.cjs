const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { openSync, closeSync, readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { temporaryProfile } = require('../support/fixtures.cjs')

const profile = temporaryProfile('np-electron-error-guard-')
const guard = resolve(__dirname, '../support/electron-errors.cjs')
for (const kind of ['exception', 'rejection']) {
  const fixture = join(profile, kind + '.cjs')
  const log = join(profile, kind + '.log')
  writeFileSync(
    fixture,
    `require(${JSON.stringify(guard)})
     const {app} = require('electron')
     app.setPath('userData', ${JSON.stringify(join(profile, kind))})
     app.whenReady().then(() => setImmediate(() => {
       ${kind === 'exception' ? "throw new Error('fixture exception')" : "Promise.reject(new Error('fixture rejection'))"}
     }))`,
  )
  const descriptor = openSync(log, 'w')
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawnSync(require('electron'), [fixture], {
    env: environment,
    stdio: ['ignore', descriptor, descriptor],
    windowsHide: true,
    timeout: 15000,
  })
  closeSync(descriptor)
  assert.equal(child.error, undefined)
  assert.equal(child.status, 1, readFileSync(log, 'utf8'))
  assert.ok(readFileSync(log, 'utf8').includes(`TEST_MAIN_PROCESS_ERROR: Error: fixture ${kind}`))
}
console.log('PASS uncaught exception and unhandled rejection fail without a modal dialog')
