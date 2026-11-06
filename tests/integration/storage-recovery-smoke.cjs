const assert = require('node:assert/strict')
const fs = require('node:fs')
const { join } = require('node:path')
const { app } = require('electron')
const { temporaryProfile } = require('../support/fixtures.cjs')

const profile = temporaryProfile('np-storage-recovery-')
app.setPath('userData', profile)
require('../support/register-typescript.cjs')
const atomic = require('../../src/main/infrastructure/atomic-file.ts')
const { dataFile } = require('../../src/main/infrastructure/paths.ts')
const settingsModule = require.resolve('../../src/main/modules/settings/service.ts')
function restartSettings() {
  delete require.cache[settingsModule]
  return require(settingsModule)
}

async function main() {
  const target = join(profile, 'concurrent.json')
  const originalNow = Date.now
  const payloads = Array.from({ length: 8 }, (_, index) =>
    JSON.stringify({ index, text: String(index).repeat(32768) }),
  )
  let writes
  try {
    Date.now = () => 123456789
    writes = await Promise.allSettled(
      payloads.map((payload) => atomic.writeFileAtomicAsync(target, payload)),
    )
  } finally {
    Date.now = originalNow
  }
  assert.equal(writes.filter((write) => write.status === 'rejected').length, 0)
  assert(payloads.includes(fs.readFileSync(target, 'utf8')), 'one complete write survives')
  assert.equal(fs.readdirSync(profile).filter((name) => name.endsWith('.tmp')).length, 0)

  const file = dataFile('settings.json')
  const backup = { apiKey: 'fixture-key', naiToken: 'fixture-token', model: 'fixture-model' }
  fs.writeFileSync(`${file}.bak`, JSON.stringify(backup))
  assert.equal(restartSettings().getSettings().apiKey, backup.apiKey)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).naiToken, backup.naiToken)

  fs.writeFileSync(file, '{broken')
  const originalWrite = atomic.writeFileAtomic
  try {
    atomic.writeFileAtomic = () => {
      throw new Error('Simulated locked destination')
    }
    assert.equal(restartSettings().getSettings().apiKey, backup.apiKey)
    assert.equal(fs.existsSync(file), false, 'corrupt file was quarantined')
  } finally {
    atomic.writeFileAtomic = originalWrite
  }
  assert.equal(restartSettings().getSettings().naiToken, backup.naiToken)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).apiKey, backup.apiKey)
  assert(fs.readdirSync(join(profile, 'data')).some((name) => name.includes('.corrupt-')))
  console.log('PASS concurrent atomic writes and settings backup recovery after interrupted repair')
}

main()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
