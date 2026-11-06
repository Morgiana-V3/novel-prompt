const assert = require('node:assert/strict')
const { readFileSync, mkdirSync, existsSync, statSync } = require('node:fs')
const { join, resolve, dirname } = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { app, shell } = require('electron')
const { temporaryProfile } = require('../support/fixtures.cjs')

const root = resolve(__dirname, '../..')
const profile = temporaryProfile('np-app-identity-')
app.setPath('appData', profile)
app.setPath('userData', profile)
app.setAppPath(root)
const filename = join(root, 'src/main/app/identity.ts')
const identityModule = new Module(filename, module)
identityModule.paths = module.paths
identityModule._compile(
  ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
)
const { repairDevelopmentShortcut, appUserModelId, appWindowIcon } = identityModule.exports

app
  .whenReady()
  .then(() => {
    if (process.platform !== 'win32') {
      console.log('SKIP Windows shortcut checks')
      app.quit()
      return
    }
    assert.ok(!appWindowIcon().isEmpty())
    const shortcut = join(profile, 'Microsoft/Windows/Start Menu/Programs/Electron.lnk')
    mkdirSync(dirname(shortcut), { recursive: true })
    repairDevelopmentShortcut()
    assert.equal(existsSync(shortcut), false, 'Do not create unsolicited shortcuts')
    const create = (target, appId) => {
      assert.ok(
        shell.writeShortcutLink(shortcut, 'create', {
          target,
          appUserModelId: appId,
          description: 'Electron',
          icon: '',
          args: '',
        }),
      )
    }
    for (const [target, appId] of [
      [process.execPath, 'another.application'],
      [join(profile, 'other-electron.exe'), appUserModelId()],
    ]) {
      create(target, appId)
      const before = readFileSync(shortcut)
      repairDevelopmentShortcut()
      assert.deepEqual(readFileSync(shortcut), before, 'Leave other applications untouched')
    }
    create(process.execPath, appUserModelId())
    repairDevelopmentShortcut()
    const repaired = shell.readShortcutLink(shortcut)
    assert.equal(repaired.icon, join(root, 'build/icon.ico'))
    assert.equal(repaired.iconIndex, 0)
    assert.equal(repaired.args, `"${root}"`)
    assert.equal(repaired.cwd, root)
    assert.equal(repaired.appUserModelId, appUserModelId())
    assert.equal(repaired.target, process.execPath)
    assert.equal(repaired.description, 'NovelPrompt · 开发版')
    const modified = statSync(shortcut).mtimeMs
    repairDevelopmentShortcut()
    assert.equal(statSync(shortcut).mtimeMs, modified, 'Already repaired shortcut is not rewritten')
    console.log('PASS icon loading, legacy shortcut repair, application isolation and idempotence')
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
