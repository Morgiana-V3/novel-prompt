const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-data-tools-')
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.getAppPath = () => resolve(__dirname, '../..')
require('../support/register-typescript.cjs')
const settings = require('../../src/main/modules/settings/service.ts')
const snippets = require('../../src/main/modules/prompts/snippets.ts')
const storage = require('../../src/main/modules/settings/storage.ts')
const pages = require('../../src/main/modules/workspace/index.ts')
settings.saveSettings({ naiVersion: 'v5', naiToken: '', apiKey: '' })
snippets.saveSnippet({
  name: '暖色电影光影',
  text: 'warm lighting, golden hour, cinematic lighting',
  category: '光影',
})
snippets.saveSnippet({
  name: '林间薄雾',
  text: 'forest, morning mist, soft light',
  category: '环境',
})
const handlers = {
  'settings:get': () => settings.getSettings(),
  'settings:save': (_, patch) => settings.saveSettings(patch),
  'storage:info': () => storage.storageInfo(),
  'snippets:list': () => snippets.listSnippets(),
  'snippets:save': (_, input) => snippets.saveSnippet(input),
  'snippets:delete': (_, id) => snippets.deleteSnippet(id),
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'images:cleanup-status': () => ({ pending: 0, message: '' }),
  'skills:list': () => require('../../src/main/modules/skills/service.ts').getConfig(),
  'mcp:info': () => null,
  'update:state': () => null,
  'update:check': () => null,
  'db:status': () => ({
    loaded: true,
    tagCount: 328617,
    aliasCount: 33364,
    implicationCount: 33767,
    zhCount: 56700,
    minCount: 10,
    fetchedAt: '2026-10-21T00:00:00Z',
    source: 'builtin',
  }),
  'nai:list': () => [],
  'nai:freeCheck': () => ({ ok: true, reasons: [], notes: [] }),
  'recipes:list': () => [],
  'pages:list': () => pages.listPages(),
  'pages:read': (_, id) => pages.readPage(id),
  'pages:edit': (_, ...args) => pages.editPage(...args),
  'prompt:analyze': () => ({
    tokens: [],
    stats: { total: 0, valid: 0, alias: 0, unknown: 0, natural: 0, text: 0 },
  }),
  'reverse:status': () => ({ phase: 'idle', ready: false, models: [] }),
}
for (const [channel, handler] of Object.entries(handlers)) {
  ipcMain.handle(channel, handler)
}
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
app
  .whenReady()
  .then(async () => {
    await pages.createPage(
      null,
      {
        width: 832,
        height: 1216,
        steps: 23,
        scale: 5,
        cfgRescale: 0,
        sampler: 'k_euler',
        noiseSchedule: 'native',
        seed: null,
        count: 1,
        qualityTags: false,
        ucPreset: 'none',
      },
      'v5',
      { base: 'forest, morning mist', negative: '', characters: [] },
    )
    const win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1000,
      webPreferences: {
        preload: resolve('out/preload/index.js'),
        sandbox: false,
        offscreen: true,
        backgroundThrottling: false,
      },
    })
    const js = (code) => win.webContents.executeJavaScript(code, true)
    const wait = async (code) => {
      for (let i = 0; i < 100; i++) {
        if (await js(code)) {
          return
        }
        await delay(40)
      }
      throw new Error('Timed out: ' + code)
    }
    const click = async (selector, text) => {
      await js(
        `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getClientRects().length&&!e.disabled);if(!e)throw Error('Missing '+${JSON.stringify(text)});e.click()})()`,
      )
      await delay(100)
    }
    const input = async (selector, text) => {
      await js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      )
      await delay(50)
    }
    const output = artifactDirectory(profile)
    const shot = async (name) => {
      await delay(200)
      writeFileSync(join(output, name), (await win.webContents.capturePage()).toPNG())
    }
    try {
      await win.loadFile(resolve('out/renderer/index.html'))
      await wait(`!!document.querySelector('.nav-item')`)
      await click('.nav-item', '设置 / 数据')
      await shot('00-settings-tabs.png')
      for (const width of [1440, 1100]) {
        win.setSize(width, 1000)
        await delay(100)
        assert(
          await js(
            `(()=>{const e=document.querySelector('.settings-tabs');return e.scrollWidth<=e.clientWidth+1})()`,
          ),
          'categories fit supported window sizes',
        )
      }
      win.setSize(1440, 1000)
      await click('.settings-tabs button', 'Tag 词库')
      await shot('00-settings-tags.png')
      await click('.settings-tabs button', 'AI 服务')
      await shot('00-settings-novelai.png')
      await click('.settings-services-nav button', '模型接口')
      await shot('00-settings-ai.png')
      await js(`document.querySelector('#ai-preset').click()`)
      await delay(50)
      await js(
        `[...document.querySelectorAll('.theme-select-option')].find(o=>o.textContent.includes('GPT（OpenAI）')).click()`,
      )
      await delay(50)
      await shot('00-settings-gpt.png')
      await click('.settings-services-nav button', 'Skill')
      await wait(`document.querySelectorAll('#skill-manager .sm-item').length > 0`)
      assert.equal(
        await js(`getComputedStyle(document.querySelector('#skill-manager')).borderTopWidth`),
        '0px',
      )
      await shot('00-settings-skills.png')
      await click('.settings-services-nav button', 'Agent')
      assert.equal(await js(`document.querySelector('.mcp-log').open`), false)
      await shot('00-settings-agent.png')
      await js(`document.querySelector('.mcp-log summary').click()`)
      assert.equal(await js(`document.querySelector('.mcp-log').open`), true)
      await js(`document.querySelector('.mcp-log summary').click()`)

      await click('.settings-tabs button', 'Tag 词库')
      await js(
        `document.querySelector('#settings-tab-tags').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`,
      )
      await wait(
        `document.querySelector('#settings-tab-other').getAttribute('aria-selected')==='true'`,
      )
      await click('.settings-tabs button', '存储与更新')
      await wait(
        `document.querySelector('.storage-location')?.textContent.includes('np-data-tools')`,
      )
      await shot('01-storage.png')
      await click('.nav-item', '收藏')
      await click('.favorites-view .seg button', '提示词片段')
      await wait(`document.querySelectorAll('.snippet-list .snippet-card').length===2`)
      await shot('02-snippets.png')
      await click('.snippet-toolbar button', '新建片段')
      await input('.snippet-form input', '测试片段')
      await input('.snippet-form textarea', 'soft light')
      await click('.snippet-form button', '保存片段')
      assert.equal(snippets.listSnippets()[0].name, '测试片段')
      await click('.nav-item', '生图预览')
      const base = '.generate textarea[aria-label="主提示词"]'
      await input(base, 'forest, night')
      await js(
        `(()=>{const e=document.querySelector('${base}');e.focus();e.setSelectionRange(8,13)})()`,
      )
      await shot('03-snippet-entry.png')
      const hoverAt = await js(
        `(()=>{const r=document.querySelector('.generate .snippet-trigger').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      )
      await js(`document.querySelector('${base}').focus()`)
      win.webContents.sendInputEvent({ type: 'mouseMove', ...hoverAt })
      await wait(
        `!!document.querySelector('.snippet-popover:popover-open .snippet-quick-list button')`,
      )
      await shot('03-insert.png')
      assert(
        await js(`document.activeElement === document.querySelector('${base}')`),
        'hover preserves input focus',
      )
      const listAt = await js(
        `(()=>{const r=document.querySelector('.snippet-popover:popover-open .snippet-quick-list').getBoundingClientRect();return {x:Math.round(r.x+20),y:Math.round(r.y+20)}})()`,
      )
      win.webContents.sendInputEvent({ type: 'mouseMove', ...listAt })
      await delay(240)
      assert(
        await js(`!!document.querySelector('.snippet-popover:popover-open')`),
        'moving from icon into list keeps it open',
      )
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 1300, y: 700 })
      await wait(`!document.querySelector('.snippet-popover:popover-open')`)
      await js(
        `document.querySelector('.generate .snippet-trigger').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))`,
      )
      await wait(`document.activeElement?.getAttribute('aria-label') === '搜索收藏片段'`)
      await js(
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
      )
      await wait(`!document.querySelector('.snippet-popover:popover-open')`)
      assert(
        await js(`document.activeElement === document.querySelector('.generate .snippet-trigger')`),
        'Escape returns keyboard focus',
      )
      // The toolbar lives in space reserved below the text, so it never covers what is being edited.
      assert(
        await js(
          `(()=>{const t=document.querySelector('${base}'),r=t.previousElementSibling.querySelector('.snippet-rail').getBoundingClientRect(),b=t.getBoundingClientRect(),pad=parseFloat(getComputedStyle(t).paddingBottom);return pad>=26&&pad<=30&&r.bottom<=b.bottom&&r.top>=b.bottom-pad-2})()`,
        ),
        'snippet toolbar sits inside the reserved bottom space',
      )
      await js(
        `document.querySelector('${base}').dispatchEvent(new KeyboardEvent('keydown',{key:'s',code:'KeyS',altKey:true,bubbles:true,cancelable:true}))`,
      )
      await wait(`document.activeElement?.getAttribute('aria-label') === '搜索收藏片段'`)
      await js(
        `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
      )
      await wait(`!document.querySelector('.snippet-popover:popover-open')`)
      await js(`document.querySelector('.generate .snippet-trigger').click()`)
      await wait(
        `!!document.querySelector('.snippet-popover:popover-open .snippet-quick-list button')`,
      )
      await js(
        `document.querySelector('.snippet-popover:popover-open .snippet-quick-list button').click()`,
      )
      assert.equal(await js(`document.querySelector('${base}').value`), 'forest, soft light')
      await js(`document.querySelector('${base}').focus();document.execCommand('undo')`)
      assert.equal(
        await js(`document.querySelector('${base}').value`),
        'forest, night',
        'insertion is one undo step',
      )
      const useSnippet = async (selector, mode) => {
        await js(
          `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.setSelectionRange(0,0);e.previousElementSibling.querySelector('.snippet-trigger').click()})()`,
        )
        await wait(
          `!!document.querySelector('.snippet-popover:popover-open .snippet-quick-list button')`,
        )
        await js(
          `document.querySelector('.snippet-popover:popover-open .snippet-modes [data-mode=${JSON.stringify(mode)}]').click()`,
        )
        assert.equal(
          await js(
            `document.querySelector('.snippet-popover:popover-open .snippet-modes [aria-checked="true"]').dataset.mode`,
          ),
          mode,
        )
        await js(
          `document.querySelector('.snippet-popover:popover-open .snippet-quick-list button').click()`,
        )
      }
      const negative = '.generate textarea[aria-label="负面提示词"]'
      await input(negative, 'bad quality')
      await useSnippet(negative, 'append')
      assert.equal(
        await js(`document.querySelector('${negative}').value`),
        'bad quality, soft light',
      )
      assert.equal(
        await js(`document.querySelector('${base}').value`),
        'forest, night',
        'negative insertion does not touch the main prompt',
      )
      await click('.generate button', '添加角色')
      await useSnippet('.generate .char-block textarea', 'replace')
      assert.equal(
        await js(`document.querySelector('.generate .char-block textarea').value`),
        'soft light',
      )
      await click('.nav-item', '提示词比对')
      await input('.compare .composer textarea', 'forest')
      await useSnippet('.compare .composer textarea', 'cursor')
      assert.equal(
        await js(`document.querySelector('.compare .composer textarea').value`),
        'soft light, forest',
      )
      await shot('03-compare-entry.png')
      await click('.nav-item', '工作台')
      await wait(`!!document.querySelector('.session-card')`)
      await js(`document.querySelector('.session-open').click()`)
      await wait(`!!document.querySelector('.pw-shell')`)
      const width = await js(
        `document.querySelector('.pw-canvas-column').getBoundingClientRect().width`,
      )
      await js(`document.querySelector('.pw-header [aria-label="收起 AI 对话"]').click()`)
      await wait(`document.querySelector('.pw-shell').classList.contains('pw-ai-collapsed')`)
      // The panel slides closed; wait for the transition instead of measuring mid-animation.
      await wait(
        `document.querySelector('.pw-canvas-column').getBoundingClientRect().width > ${width + 200}`,
      )
      assert(
        await js(`document.querySelector('#workspace-ai-panel').inert`),
        'collapsed AI panel leaves the tab order',
      )
      assert(
        await js(
          `document.querySelector('.pw-execution')?.getClientRects().length > 0 || !!document.querySelector('.pw-canvas-column button')`,
        ),
      )
      await shot('04-workspace.png')
      assert.equal(settings.getSettings().workspaceAiCollapsed, true)
      await js(`document.querySelector('.pw-header [aria-label="展开 AI 对话"]').click()`)
      await wait(
        `Math.abs(document.querySelector('.pw-canvas-column').getBoundingClientRect().width - ${width}) < 2`,
      )
      await shot('05-workspace-ai.png')
      await win.reload()
      await wait(`!!document.querySelector('.nav-item')`)
      await click('.nav-item', '收藏')
      await click('.favorites-view .seg button', '提示词片段')
      await wait(`document.querySelector('.snippet-list')?.textContent.includes('测试片段')`)
      console.log(
        'PASS settings, persistent snippets, cursor selection, native undo and workspace collapse. Screenshots: ' +
          output,
      )
      app.exit(0)
    } catch (error) {
      console.error(error)
      await shot('failure.png')
      console.error(output)
      app.exit(1)
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
