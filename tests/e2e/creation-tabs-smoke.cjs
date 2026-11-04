const { temporaryProfile } = require('../support/fixtures.cjs')
// 生图创作多标签页：每个标签的提示词、参数、各分页结果互不影响，重启后标签仍在。
const { app, BrowserWindow, ipcMain, net } = require('electron')
const { join, resolve } = require('node:path')
const assert = require('node:assert/strict')
const buildDirectory = resolve(process.env.NP_TEST_BUILD_DIR || join(__dirname, '../../out'))
const profile = temporaryProfile('np-creation-tabs-smoke-')
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '../..')
require('../support/register-typescript.cjs')
const { getSettings, saveSettings } = require('../../src/main/modules/settings/service.ts')
saveSettings({ apiKey: 'fixture', naiToken: 'fixture', naiVersion: 'v5' })
net.fetch = async () => {
  throw new Error('Unexpected network request in offline regression')
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
let optimizeCalls = 0
const handlers = {
  'storage:info': () => ({ path: profile, bytes: 0, pending: null, previous: null, error: null }),
  'collections:list': () => [{ id: 'default', name: '默认图集', createdAt: 0 }],
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'images:cleanup-status': () => ({ pending: 0, message: '' }),
  'settings:get': () => getSettings(),
  'settings:save': (_, patch) => saveSettings(patch),
  'skills:list': () => [],
  'mcp:info': () => null,
  'update:check': () => null,
  'update:state': () => null,
  'reverse:status': () => ({ phase: 'idle', ready: false, models: [] }),
  'recipes:list': () => [],
  'pages:list': () => [],
  'db:status': () => ({
    loaded: true,
    tagCount: 3,
    aliasCount: 1,
    zhCount: 0,
    implicationCount: 0,
  }),
  'nai:list': () => [],
  'nai:subscription': () => ({
    active: true,
    tier: 3,
    anlasFixed: 10000,
    anlasPurchased: 0,
    usagePercent: 100,
    usageNegative: false,
  }),
  'nai:freeCheck': () => ({ ok: false, reasons: [], notes: [] }),
  'tag:complete': () => [],
  'prompt:analyze': () => ({
    tokens: [],
    stats: { total: 0, valid: 0, alias: 0, unknown: 0, natural: 0, text: 0 },
  }),
  'ai:optimize': () => {
    optimizeCalls++
    return {
      positive: 'tab two optimized',
      negative: '',
      characters: [],
      changes: [{ id: 'c1', scope: 'base', text: '改写主提示词', basis: [] }],
      invalid: [],
      notes: '',
      evidence: { related: [], wiki: [], failed: [], implications: true },
    }
  },
}
for (const [name, handler] of Object.entries(handlers)) {
  ipcMain.handle(name, handler)
}

app.whenReady().then(async () => {
  let win
  try {
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 960,
      webPreferences: {
        preload: join(buildDirectory, 'preload/index.js'),
        sandbox: false,
        backgroundThrottling: false,
        offscreen: true,
      },
    })
    const js = (code) => win.webContents.executeJavaScript(code, true)
    const waitUI = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(code)) {
          return
        }
        await pause(25)
      }
      throw new Error(`Timed out: ${code}`)
    }
    const click = async (selector, text) => {
      await js(
        `(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!b)throw new Error('Missing: '+${JSON.stringify(text)});b.click()})()`,
      )
      await pause(60)
    }
    const main = `document.querySelector('#creation-editor textarea[aria-label="主提示词"]')`
    const setMain = async (text) => {
      await js(
        `(()=>{const e=${main};e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      )
      await pause(60)
    }
    const tabTitles = () =>
      js(`[...document.querySelectorAll('.session-tab-title')].map(e=>e.textContent.trim())`)
    const clickTab = async (index) => {
      await js(`document.querySelectorAll('.session-tab')[${index}].click()`)
      await pause(80)
    }
    const aiText = () => js(`document.querySelector('#creation-panel-ai').innerText`)

    await win.loadFile(join(buildDirectory, 'renderer/index.html'))
    await waitUI(`!!document.querySelector('.session-tab')`)
    assert.deepEqual(await tabTitles(), ['新标签'])

    // 第一个标签：写提示词
    await setMain('tab one prompt, solo')
    assert.deepEqual(await tabTitles(), ['tab one prompt'])

    // 新标签是全新开始
    await js(`document.querySelector('.session-tab-add').click()`)
    await pause(80)
    assert.equal((await tabTitles()).length, 2)
    assert.equal(await js(`${main}.value`), '')
    assert.equal(
      await js(`document.querySelectorAll('.session-tab')[1].classList.contains('active')`),
      true,
    )
    console.log('PASS new tab starts from an empty prompt')

    // 第二个标签：跑一次智能优化，结果只属于这个标签
    await setMain('tab two prompt')
    await click('.creation-tab', '智能优化')
    await click('#creation-panel-actions button', '优化提示词')
    await waitUI(`document.querySelector('#creation-panel-ai').innerText.includes('改写主提示词')`)
    assert.equal(optimizeCalls, 1)

    await clickTab(0)
    assert.equal(await js(`${main}.value`), 'tab one prompt, solo')
    assert.equal((await aiText()).includes('改写主提示词'), false)
    console.log('PASS switching back restores the first prompt and hides the other tab’s AI result')

    await clickTab(1)
    assert.equal(await js(`${main}.value`), 'tab two prompt')
    assert.equal((await aiText()).includes('改写主提示词'), true)
    console.log('PASS each tab keeps its own AI optimization result')

    // 重启后标签与内容都在
    await pause(400)
    await win.webContents.reload()
    await waitUI(`document.querySelectorAll('.session-tab').length === 2`)
    assert.equal(await js(`${main}.value`), 'tab two prompt')
    await clickTab(0)
    assert.equal(await js(`${main}.value`), 'tab one prompt, solo')
    console.log('PASS tabs and their prompts survive a reload')

    // 关闭标签可撤销
    await js(`document.querySelectorAll('.session-tab-close')[0].click()`)
    await pause(80)
    assert.deepEqual(await tabTitles(), ['tab two prompt'])
    assert.equal(await js(`${main}.value`), 'tab two prompt')
    await click('button', '撤销')
    assert.equal((await tabTitles()).length, 2)
    assert.equal(await js(`${main}.value`), 'tab one prompt, solo')
    console.log('PASS closing a tab can be undone from the toast')

    // 标签多到放不下时换行，而不是横向滚动
    for (let i = 0; i < 8; i++) {
      await js(`document.querySelector('.session-tab-add').click()`)
      await pause(40)
      await setMain(`wrap check prompt number ${i}`)
    }
    assert.equal(await js(`document.querySelector('.session-tab-add').disabled`), true)
    assert.ok(
      await js(
        `(()=>{const t=[...document.querySelectorAll('.session-tab')];return t.at(-1).offsetTop>t[0].offsetTop})()`,
      ),
      'tabs wrap onto another row when the editor is narrow',
    )
    console.log('PASS tabs wrap when squeezed and stop at the limit')
    const shot = join(profile, 'creation-tabs.png')
    require('node:fs').writeFileSync(shot, (await win.webContents.capturePage()).toPNG())
    console.log('All creation tab checks passed. Screenshot: ' + shot)
    app.exit(0)
  } catch (error) {
    console.error(error)
    if (win) {
      console.error(
        await win.webContents.executeJavaScript('document.body.innerText').catch(() => ''),
      )
    }
    app.exit(1)
  }
})
