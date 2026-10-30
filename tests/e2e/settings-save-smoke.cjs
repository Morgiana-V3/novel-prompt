// Real renderer/preload IPC, isolated settings, and no remote account traffic.
const { app, BrowserWindow, ipcMain, net } = require('electron')
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-settings-save-')
const buildDirectory = resolve(process.env.NP_TEST_BUILD_DIR || join(__dirname, '../../out'))
app.disableHardwareAcceleration()
app.setPath('userData', profile)
app.getAppPath = () => resolve(__dirname, '../..')
require('../support/register-typescript.cjs')
const { getSettings, saveSettings } = require('../../src/main/modules/settings/service.ts')
const { dataFile } = require('../../src/main/infrastructure/paths.ts')
const atomic = require('../../src/main/infrastructure/atomic-file.ts')
const originalWrite = atomic.writeFileAtomic
let failWrite = false
atomic.writeFileAtomic = (...args) => {
  if (failWrite) {
    throw new Error('Fixture disk write failed')
  }
  return originalWrite(...args)
}
const fixtureSkills = [{ id: 'fixture-skill', enabled: true }]
saveSettings({
  naiToken: 'fixture-original',
  apiKey: 'fixture-ai',
  naiVersion: 'v5',
  naiAutoSave: true,
  skills: fixtureSkills,
  initializedUserSkills: ['fixture-skill'],
})
const patches = []
let rejectAccount = false
let balance = 9000
net.fetch = async () => {
  throw new Error('Unexpected network request')
}
const handlers = {
  'settings:get': () => getSettings(),
  'settings:save': (_, patch) => {
    patches.push(patch)
    return saveSettings(patch)
  },
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'images:cleanup-status': () => ({ pending: 0, message: '' }),
  'skills:list': () => [],
  'mcp:info': () => null,
  'update:check': () => null,
  'update:state': () => null,
  'db:status': () => ({ loaded: true, tagCount: 3, aliasCount: 1, zhCount: 0 }),
  'nai:list': () => [],
  'nai:freeCheck': () => ({ ok: true, reasons: [], notes: [] }),
  'nai:subscription': () => {
    if (rejectAccount) {
      throw new Error('Fixture authentication failed')
    }
    return { active: true, tier: 3, anlasFixed: balance, anlasPurchased: 0, usagePercent: 100 }
  },
  'recipes:list': () => [],
  'pages:list': () => [],
  'prompt:analyze': () => ({
    tokens: [],
    stats: { total: 0, valid: 0, alias: 0, unknown: 0, natural: 0, text: 0 },
  }),
  'reverse:status': () => ({ phase: 'idle', ready: false, models: [] }),
}
for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, handler)
}
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    webPreferences: {
      preload: join(buildDirectory, 'preload/index.js'),
      sandbox: false,
      offscreen: true,
      backgroundThrottling: false,
    },
  })
  const js = (code) => win.webContents.executeJavaScript(code, true)
  const wait = async (code) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await js(code)) {
        return
      }
      await delay(30)
    }
    throw new Error(`Timed out: ${code}`)
  }
  const click = async (selector, text) => {
    await js(`(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(text)} && !element.disabled);
      if (!button) throw new Error('Missing test button');
      button.click();
    })()`)
    await delay(50)
  }
  const input = async (selector, value) => {
    await js(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
    await delay(30)
  }
  const tokenInput = '#nai input[type=password]'
  const saved = () => wait(`!document.querySelector('#nai .pill.alias')`)
  try {
    await win.loadFile(join(buildDirectory, 'renderer/index.html'))
    await wait(`document.querySelector('.subscription-status')?.textContent.includes('9,000')`)
    assert.equal(await js(`document.querySelectorAll('.balance-notice').length`), 0)
    await click('.nav-item', '设置 / 数据')
    await input('.settings input[placeholder="sk-..."]', 'unsaved-ai-draft')
    await input(tokenInput, '')
    await click('#nai .primary', '保存')
    await saved()
    assert.equal(getSettings().naiToken, '')
    assert.equal(getSettings().apiKey, 'fixture-ai')
    assert.deepEqual(patches.at(-1), { naiToken: '' })
    await wait(
      `document.querySelector('.subscription-status')?.textContent.includes('连接 NovelAI')`,
    )
    await input(tokenInput, '  arbitrary-fixture  ')
    await click('.side-bottom .seg button', 'V4.5')
    assert.equal(
      await js(`document.querySelector(${JSON.stringify(tokenInput)}).value`),
      '  arbitrary-fixture  ',
    )
    await click('#nai .primary', '保存')
    await saved()
    assert.equal(getSettings().naiToken, 'arbitrary-fixture')
    assert.equal(getSettings().naiVersion, 'v4.5')
    assert.equal(getSettings().naiAutoSave, true)
    assert.deepEqual(getSettings().skills, fixtureSkills)
    assert.deepEqual(getSettings().initializedUserSkills, ['fixture-skill'])
    assert.equal(
      await js(`document.querySelector('.settings input[placeholder="sk-..."]').value`),
      'unsaved-ai-draft',
    )
    console.log(
      'PASS nested Skill settings do not block IPC; clear, trim, arbitrary text and independent Token save preserve other settings/drafts',
    )

    failWrite = true
    await input(tokenInput, 'fixture-rejected')
    await click('#nai .primary', '保存')
    await wait(`document.querySelector('#nai [role=alert]')?.textContent.includes('保存失败')`)
    assert.equal(getSettings().naiToken, 'arbitrary-fixture')
    assert.equal(
      JSON.parse(readFileSync(dataFile('settings.json'), 'utf8')).naiToken,
      'arbitrary-fixture',
    )
    assert(await js(`!!document.querySelector('#nai .pill.alias')`))
    failWrite = false
    await click('#nai .primary', '保存')
    await saved()
    assert.equal(getSettings().naiToken, 'fixture-rejected')
    assert.equal(await js(`document.querySelectorAll('#nai [role=alert]').length`), 0)
    rejectAccount = true
    await click('#nai button', '保存并测试连接')
    await wait(
      `document.querySelector('#nai [role=alert]')?.textContent.includes('Token 已保存，连接测试失败')`,
    )
    assert.equal(await js(`document.querySelectorAll('#nai .pill.alias').length`), 0)
    rejectAccount = false
    await click('#nai button', '保存并测试连接')
    await wait(`document.querySelector('#nai').textContent.includes('连接成功')`)
    console.log(
      'PASS disk failure keeps persisted/cache state unchanged and offers retry; connection failure differs from save failure',
    )

    await click('.settings .card:not(#nai) .primary', '保存')
    assert.equal(getSettings().apiKey, 'unsaved-ai-draft')
    assert(!('skills' in patches.at(-1)))
    assert(!('naiVersion' in patches.at(-1)))
    assert(!('naiAutoSave' in patches.at(-1)))
    assert.deepEqual(getSettings().skills, fixtureSkills)
    await click('[aria-label="刷新会员与余额"]', '')
    assert.equal(await js(`document.querySelectorAll('.balance-notice').length`), 0)
    balance = 8993
    await click('[aria-label="刷新会员与余额"]', '')
    await wait(
      `document.querySelector('.balance-notice')?.textContent.includes('本次消耗 7 Anlas')`,
    )
    await delay(180)
    const screenshot = join(artifactDirectory(profile), 'balance-notice.png')
    writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG())
    console.log('SCREENSHOT ' + screenshot)
    balance = 9013
    await click('[aria-label="刷新会员与余额"]', '')
    await wait(
      `document.querySelector('.balance-notice')?.textContent.includes('余额增加 20 Anlas')`,
    )
    await wait(`!document.querySelector('.balance-notice')`)
    await click('#nai button', '清除 Token')
    await saved()
    assert.equal(getSettings().naiToken, '')
    await wait(
      `document.querySelector('.subscription-status')?.textContent.includes('连接 NovelAI')`,
    )
    assert.equal(await js(`document.querySelectorAll('.balance-notice').length`), 0)
    await win.reload()
    await wait(
      `document.querySelector('.subscription-status')?.textContent.includes('连接 NovelAI')`,
    )
    await click('.nav-item', '设置 / 数据')
    assert.equal(await js(`document.querySelector(${JSON.stringify(tokenInput)}).value`), '')
    console.log(
      'PASS general save excludes hidden fields; balance notices show signed changes and expire; explicit Token removal survives reload',
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
