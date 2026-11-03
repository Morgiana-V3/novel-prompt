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
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(text)} && !element.disabled && element.getClientRects().length);
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
    await click('.nav-item', '设置')
    assert.equal(
      await js(`Number(document.querySelector('#settings-tag-completion-limit').value)`),
      20,
    )
    await input('#settings-tag-completion-limit', '35')
    await click('.tags-save', '保存词库设置')
    assert.equal(getSettings().tagCompletionLimit, 35)
    assert.equal(JSON.parse(readFileSync(dataFile('settings.json'), 'utf8')).tagCompletionLimit, 35)
    await win.reload()
    await wait(`!!document.querySelector('.nav-item')`)
    await click('.nav-item', '设置')
    assert.equal(
      await js(`Number(document.querySelector('#settings-tag-completion-limit').value)`),
      35,
    )
    console.log('PASS tag completion default, settings save and reload persistence')
    await click('.settings-tabs button', '操作说明')
    await wait(
      `document.querySelector('#settings-panel-guide')?.textContent.includes('/ 快捷搜索')`,
    )
    writeFileSync(
      join(profile, 'operation-guide.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    assert.equal(
      await js(
        `document.querySelectorAll('textarea[title="输入 / 快捷搜索 Tag，支持中文和空格"]').length`,
      ),
      0,
    )

    await click('.settings-tabs button', 'AI 服务')
    await click('.settings-services-nav button', '模型接口')
    await input('.settings input[placeholder="sk-..."]', 'unsaved-ai-draft')
    assert(await js(`!!document.querySelector('#settings-tab-services .settings-dirty-dot')`))
    await click('.settings-tabs button', 'AI 服务')
    await click('.settings-services-nav button', 'NovelAI')
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

    await click('.settings-tabs button', 'Tag 词库')
    await input('#settings-panel-tags input', '27')
    await click('.settings-tabs button', 'AI 服务')
    await click('.settings-services-nav button', '模型接口')
    assert.equal(
      await js(`document.querySelector('.settings input[placeholder="sk-..."]').value`),
      'unsaved-ai-draft',
    )
    await click('.settings .card:not(#nai) .primary', '保存')
    assert.equal(getSettings().minPostCount, 10, 'saving AI leaves another category draft unsaved')
    await click('.settings-tabs button', 'Tag 词库')
    assert.equal(await js(`document.querySelector('#settings-panel-tags input').value`), '27')
    await click('.settings-tabs button', 'AI 服务')
    await click('.settings-services-nav button', '模型接口')
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
    await click('.settings-tabs button', 'AI 服务')
    await click('.settings-services-nav button', 'NovelAI')
    await click('#nai button', '清除 Token')
    await saved()
    assert.equal(getSettings().naiToken, '')
    await wait(
      `document.querySelector('.subscription-status')?.textContent.includes('连接 NovelAI')`,
    )
    assert.equal(await js(`document.querySelectorAll('.balance-notice').length`), 0)
    await click('.settings-tabs button', '存储与更新')
    await click('[aria-label="配置 NovelAI Token"]', '')
    await wait(
      `document.querySelector('#settings-tab-services').getAttribute('aria-selected')==='true' && document.querySelector('#settings-service-nai').getAttribute('aria-selected')==='true'`,
    )
    console.log('PASS category drafts survive switching; scoped save and NovelAI deep link')
    await win.reload()
    await wait(
      `document.querySelector('.subscription-status')?.textContent.includes('连接 NovelAI')`,
    )
    await click('.nav-item', '设置')
    assert.equal(await js(`document.querySelector(${JSON.stringify(tokenInput)}).value`), '')
    console.log(
      'PASS general save excludes hidden fields; balance notices show signed changes and expire; explicit Token removal survives reload',
    )
    await click('.settings-tabs button', 'AI 服务')
    await click('.settings-services-nav button', '模型接口')
    const pickOption = async (selector, label) => {
      await js(`document.querySelector(${JSON.stringify(selector)}).click()`)
      await delay(50)
      await js(
        `(()=>{const o=[...document.querySelectorAll('.theme-select-option')].find(o=>o.querySelector('span').textContent.trim()===${JSON.stringify(label)});if(!o)throw Error('Missing option '+${JSON.stringify(label)});o.click()})()`,
      )
      await delay(50)
    }
    const { AI_PRESETS } = require('../../src/shared/settings/ai-presets.ts')
    const choosePreset = (value) =>
      pickOption('#ai-preset', AI_PRESETS.find((preset) => preset.id === value).label)
    await choosePreset('openai')
    assert.equal(
      await js(`document.querySelector('[aria-label="AI 模型名称"]').value`),
      'gpt-6-sol',
    )
    await pickOption('[aria-label="常用模型"]', 'gpt-6-luna')
    assert.equal(
      await js(`document.querySelector('[aria-label="AI 模型名称"]').value`),
      'gpt-6-luna',
    )
    assert.equal(
      await js(`document.querySelector('[aria-label="AI Base URL"]').value`),
      'https://api.openai.com/v1',
    )
    assert.equal(
      await js(`document.querySelector('.settings input[placeholder="sk-..."]').value`),
      '',
      'provider switch does not reuse another provider key',
    )
    await input('[aria-label="AI 模型名称"]', 'my-gpt-model')
    for (const [preset, endpoint, model] of [
      ['qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus'],
      ['glm', 'https://open.bigmodel.cn/api/paas/v4', 'glm-5.3'],
      ['kimi', 'https://api.moonshot.cn/v1', 'kimi-k3.1-pro'],
    ]) {
      await choosePreset(preset)
      assert.equal(await js(`document.querySelector('[aria-label="AI Base URL"]').value`), endpoint)
      assert.equal(await js(`document.querySelector('[aria-label="AI 模型名称"]').value`), model)
      assert.equal(
        await js(`document.querySelector('.settings input[placeholder="sk-..."]').value`),
        '',
      )
    }
    await choosePreset('deepseek')
    assert.equal(
      await js(`document.querySelector('.settings input[placeholder="sk-..."]').value`),
      'unsaved-ai-draft',
      'return restores existing draft',
    )
    await choosePreset('openai')
    assert.equal(
      await js(`document.querySelector('[aria-label="AI 模型名称"]').value`),
      'my-gpt-model',
    )
    await input('[aria-label="AI Base URL"]', 'https://example.invalid/v1')
    assert.equal(await js(`document.querySelector('#ai-preset').textContent.trim()`), '自定义')
    await input('[aria-label="AI 模型名称"]', 'deepseek-chat')
    await click('#settings-panel-ai .primary', '保存')
    assert.equal(getSettings().aiPreset, 'custom')
    assert.equal(getSettings().model, 'deepseek-chat', 'custom model IDs are not rewritten')
    await win.reload()
    await wait(`!!document.querySelector('.nav-item')`)
    await click('.nav-item', '设置')
    await click('.settings-tabs button', 'AI 服务')
    await click('.settings-services-nav button', '模型接口')
    assert.equal(await js(`document.querySelector('#ai-preset').textContent.trim()`), '自定义')
    assert.equal(
      await js(`document.querySelector('[aria-label="AI Base URL"]').value`),
      'https://example.invalid/v1',
    )
    console.log(
      'PASS official presets, draft switching, credential isolation and custom endpoint persistence',
    )

    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
