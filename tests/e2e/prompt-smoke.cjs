const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Offline regressions against the built UI, with an isolated profile and no model traffic.
const { app, BrowserWindow, ipcMain, net } = require('electron')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const buildDirectory = resolve(process.env.NP_TEST_BUILD_DIR || join(__dirname, '../../out'))
const { crc32, deflateSync } = require('node:zlib')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { PNG } = require('pngjs')
const profile = temporaryProfile('np-prompt-smoke-')
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '../..')
require('../support/register-typescript.cjs')
const { parsePromptText } = require('../../src/shared/prompts/import.ts')
const { readPngPrompt: readPngBytes } = require('../../src/main/modules/prompts/png-import.ts')
const readPngPrompt = async (blob) => readPngBytes(new Uint8Array(await blob.arrayBuffer()))
const { parsePrompt } = require('../../src/main/modules/prompts/parser.ts')
const pages = require('../../src/main/modules/workspace/index.ts')
const { getSettings, saveSettings } = require('../../src/main/modules/settings/service.ts')
saveSettings({ apiKey: 'fixture', naiVersion: 'v5' })
net.fetch = async () => {
  throw new Error('Unexpected network request in offline regression')
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let copied = ''
let holdAnalysis = false
let pending = []
let calls = 0
let reviewResult = null
function analysis(text) {
  const tokens = parsePrompt(text).map((t) => {
    const tag = { name: t.core, display: t.core, category: 0, count: 100 }
    const resolveStatus = () => {
      if (t.core === 'twin tails') {
        return 'alias'
      }
      if (t.core === 'bogus') {
        return 'unknown'
      }
      return 'valid'
    }
    return {
      ...t,
      status: resolveStatus(),
      tag,
      aliasOf: { ...tag, name: 'twintails', display: 'twintails' },
    }
  })
  return {
    tokens,
    stats: Object.fromEntries(
      ['total', 'valid', 'alias', 'unknown', 'natural', 'text'].map((k) => [
        k,
        k === 'total' ? tokens.length : tokens.filter((t) => t.status === k).length,
      ]),
    ),
  }
}
const handlers = {
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'images:cleanup-status': () => ({ pending: 0, message: '' }),
  'settings:get': () => getSettings(),
  'settings:save': (_, p) => saveSettings(p),
  'window:dark-titlebar': () => {},
  'skills:templates': () => [],
  'skills:list': () => [],
  'mcp:info': () => null,
  'update:check': () => null,
  'update:state': () => null,
  'db:status': () => ({
    loaded: true,
    tagCount: 3,
    aliasCount: 1,
    zhCount: 0,
    implicationCount: 0,
  }),
  'nai:list': () => [],
  'nai:freeCheck': () => ({ ok: false, reasons: [], notes: [] }),
  'clipboard:write': (_, text) => {
    copied = text
  },
  'pages:list': () => pages.listPages(),
  'pages:read': (_, id) => pages.readPage(id),
  'pages:create': (_, ...args) => pages.createPage(...args),
  'pages:edit': (_, ...args) => pages.editPage(...args),
  'prompt:analyze': (_, text) => {
    calls++
    return holdAnalysis
      ? new Promise((resolve) => pending.push({ text, resolve: () => resolve(analysis(text)) }))
      : analysis(text)
  },
  'ai:optimize': (_, req) => {
    optimizeCalls++
    lastOptimize = req
    if (reviewResult) {
      return reviewResult
    }
    return {
      positive: 'outdoors',
      negative: '',
      characters: [],
      changes: [],
      invalid: [],
      notes: '',
      evidence: { related: [], wiki: [], failed: [], implications: true },
    }
  },
  'ai:preview': () => previewResult,
}
let optimizeCalls = 0
let previewResult = null
let danbooruHits = 0
let lastOptimize = null
const pt = { text: 't', tags: [], confidence: 'medium' }
for (const [name, handler] of Object.entries(handlers)) {
  ipcMain.handle(name, handler)
}

function pngWithComment(meta, type = 'tEXt') {
  const png = PNG.sync.write(new PNG({ width: 64, height: 64 }))
  const body = Buffer.from(JSON.stringify(meta))
  const text =
    type === 'tEXt'
      ? Buffer.concat([Buffer.from('Comment\0'), body])
      : Buffer.concat([
          Buffer.from(type === 'zTXt' ? 'Comment\0\0' : 'Comment\0\x01\0\0\0'),
          deflateSync(body),
        ])
  const chunk = Buffer.alloc(text.length + 12)
  chunk.writeUInt32BE(text.length)
  chunk.write(type, 4)
  text.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
  return new Blob([Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)])])
}

app.whenReady().then(async () => {
  let win
  try {
    const metadata = {
      prompt: '',
      uc: '',
      width: 64,
      height: 64,
      v4_prompt: {
        caption: {
          base_caption: '',
          char_captions: [{ char_caption: 'silver hair', centers: [{ x: 0.3, y: 0.5 }] }],
        },
        use_coords: true,
      },
      v4_negative_prompt: {
        caption: { base_caption: '', char_captions: [{ char_caption: 'glasses' }] },
      },
    }
    const imported = await readPngPrompt(pngWithComment(metadata))
    assert.equal(imported.base, '')
    assert.equal(imported.negative, '')
    assert.deepEqual(imported.characters, [
      { prompt: 'silver hair', negative: 'glasses', position: 'B3' },
    ])
    assert.equal(imported.width, 64)
    assert.equal(imported.fromMetadata, true)
    for (const type of ['zTXt', 'iTXt']) {
      assert.deepEqual(await readPngPrompt(pngWithComment(metadata, type)), imported)
    }
    assert.deepEqual(parsePromptText(JSON.stringify({ input: '', parameters: metadata })), imported)
    await assert.rejects(readPngPrompt(pngWithComment({ prompt: '', uc: '' })), /没有找到提示词/)
    console.log(
      'PASS character-only PNG and request JSON preserve prompts, negatives and coordinates; empty metadata is rejected',
    )

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
    const js = async (code) => {
      try {
        return await win.webContents.executeJavaScript(code, true)
      } catch (error) {
        console.error('Failed renderer assertion:', code)
        throw error
      }
    }
    const wait = async (predicate) => {
      for (let i = 0; i < 160; i++) {
        if (await predicate()) {
          return
        }
        await pause(25)
      }
      throw new Error('Timed out: ' + predicate)
    }
    const waitUI = (code) => wait(() => js(code))
    const click = async (selector, text) => {
      await js(
        `(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!b)throw new Error('Missing button: '+${JSON.stringify(text)});b.click()})()`,
      )
      await pause(30)
    }
    const input = (value) =>
      js(
        `(()=>{const e=document.querySelector('.compare textarea');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      )
    const paste = (value) =>
      js(
        `(()=>{const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(value)});document.querySelector('.compare textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
      )
    const value = () => js(`document.querySelector('.compare textarea').value`)
    await win.loadFile(join(buildDirectory, 'renderer/index.html'))
    await waitUI(`document.querySelector('.side-bottom .seg')?.textContent.includes('V5')`)
    await paste('[Prompt]\ntwin tails\n[Undesired Content]\nlowres, blurry')
    await waitUI(`!!document.querySelector('.alias-item button')`)
    // Click the old DOM button in the same event turn as switching the target field.
    await js(
      `(()=>{const old=document.querySelector('.alias-item button');[...document.querySelectorAll('.section-tab')].find(b=>b.textContent.startsWith('负面')).click();old.click()})()`,
    )
    assert.equal(await value(), 'lowres, blurry')
    assert.equal(await js(`document.querySelectorAll('.alias-item').length`), 0)
    console.log('PASS switching fields cannot apply stale alias offsets')

    await click('.section-tab', '主提示词1')
    await waitUI(`!!document.querySelector('.alias-item button')`)
    await js(
      `(()=>{const old=document.querySelector('.alias-item button');const t=document.querySelector('.compare textarea');t.value='outdoors';t.dispatchEvent(new Event('input',{bubbles:true}));old.click()})()`,
    )
    assert.equal(await value(), 'outdoors')
    await input('bogus')
    await waitUI(`!!document.querySelector('.unknown-head button')`)
    await js(
      `(()=>{const old=document.querySelector('.unknown-head button');const t=document.querySelector('.compare textarea');t.value='outdoors';t.dispatchEvent(new Event('input',{bubbles:true}));old.click()})()`,
    )
    assert.equal(await value(), 'outdoors')
    console.log('PASS editing text invalidates both stale replacement and removal actions')

    await waitUI(`document.querySelector('.valid-wrap')?.textContent.includes('outdoors')`)
    holdAnalysis = true
    await input('twin tails')
    await wait(() => pending.length === 1)
    await input('lowres')
    await wait(() => pending.length === 2)
    pending[1].resolve()
    await waitUI(`document.querySelector('.valid-wrap')?.textContent.includes('lowres')`)
    pending[0].resolve()
    await pause(80)
    assert.equal(await js(`document.querySelectorAll('.alias-item').length`), 0)
    assert.ok(await js(`document.querySelector('.valid-wrap').textContent.includes('lowres')`))
    holdAnalysis = false
    pending = []
    await paste('[Prompt]\ntwin tails\n[Undesired Content]\ntwin tails')
    await waitUI(`!!document.querySelector('.alias-item button')`)
    const beforeSwitch = calls
    await js(
      `(()=>{const old=document.querySelector('.alias-item button');[...document.querySelectorAll('.section-tab')].find(b=>b.textContent.startsWith('负面')).click();old.click()})()`,
    )
    assert.equal(await value(), 'twin tails')
    await wait(() => calls > beforeSwitch)
    await waitUI(`!!document.querySelector('.alias-item button')`)
    await click('.alias-item button', '修正')
    assert.equal(await value(), 'twintails')
    console.log(
      'PASS late replies are ignored; equal-text fields reanalyze; current results remain actionable',
    )

    await click('.nav-item', 'AI 优化')
    await js(`document.querySelector('.ai .run-bar .btn.accent').click()`)
    await waitUI(`!!document.querySelector('.ai .cheer .primary')`)
    await click('.ai .cheer .primary', '采用')
    assert.equal(await js(`document.querySelector('.ai textarea[data-src="neg"]').value`), '')
    await click('.ai .cheer button', '撤销采用')
    assert.equal(
      await js(`document.querySelector('.ai textarea[data-src="neg"]').value`),
      'twintails',
    )
    console.log('PASS adopting an empty negative clears it; undo restores the original')

    await click('.nav-item', '提示词比对')
    await click('.section-tab', '主提示词1')
    await paste(
      '[Prompt]\noutdoors\n[Character 1 @ B3]\nsilver hair\n[Character 1 Undesired Content]\nglasses\n[Undesired Content]\nblurry',
    )
    await click('.nav-item', 'AI 工作台')
    await click('.sessions-home header button', '新建项目')
    // Select the current shared prompt as the new session's starting point.
    await js(`document.querySelector('.session-create .theme-select').click()`)
    await click('.theme-select-option', '复制当前提示词')
    await click('.session-create button', '开始项目')
    await waitUI(`!!document.querySelector('.pw-shell')`)
    await click('.pw-view-tabs button', '生图配置')
    await js(`document.querySelector('[title="复制完整提示词"]').click()`)
    await wait(() => !!copied)
    assert.deepEqual(parsePromptText(copied), {
      base: 'outdoors',
      negative: 'blurry',
      characters: [{ prompt: 'silver hair', negative: 'glasses', position: 'B3' }],
      structured: true,
    })
    await click('.nav-item', '提示词比对')
    await paste(copied)
    assert.equal(await value(), 'outdoors')
    console.log(
      'PASS workspace copy round-trips through the real paste flow with character negatives and positions',
    )

    // 新建项目沿用生图页参数，而不是写死的默认值
    const created = pages.listPages().map((s) => pages.readPage(s.id))
    assert.ok(created.length >= 1)
    await click('.nav-item', '生图预览')
    await js(
      `localStorage.setItem('np-gen-params', JSON.stringify({steps:28,scale:6.5,cfgRescale:0.2,sampler:'k_dpmpp_2m',noiseSchedule:'karras',count:4}))`,
    )
    await click('.nav-item', 'AI 工作台')
    await js(`document.querySelector('.pw-back[aria-label="返回项目"]').click()`)
    await waitUI(`!!document.querySelector('.sessions-home header button')`)
    await click('.sessions-home header button', '新建项目')
    await click('.session-create button', '开始项目')
    await waitUI(`!!document.querySelector('.pw-shell')`)
    const newest = pages.listPages().sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const p = pages.readPage(newest.id).versions[0].editor.params
    assert.deepEqual(
      [p.steps, p.scale, p.cfgRescale, p.sampler, p.noiseSchedule, p.count, p.seed],
      [28, 6.5, 0.2, 'k_dpmpp_2m', 'karras', 1, null],
    )
    console.log('PASS new sessions inherit generation settings (single image, random seed)')

    // 推测建议带到 AI 优化，且不覆盖用户已写的修改要求
    const request = `document.querySelector('.ai .pane-body .field textarea')`
    const runText = () => js(`document.querySelector('.ai .run-bar .btn.accent').textContent`)
    await click('.nav-item', 'AI 优化')
    await js(
      `(()=>{const t=${request};t.value='保持水彩';t.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    await click('.nav-item', '画面推测')
    await js(
      `(()=>{const t=[...document.querySelectorAll('.preview textarea')].find(e=>e.placeholder.includes('樱花树下并肩'));t.value='想要更明亮';t.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    previewResult = {
      summary: 's',
      style: pt,
      composition: pt,
      scene: pt,
      lighting: pt,
      characters: [],
      emphasis: [],
      suppressed: [],
      risks: [{ level: 'high', text: '光线太暗', tags: [], basis: 'rule' }],
      gap: '整体偏暗',
      suggestions: [{ text: '加入 bright lighting', basis: 'rule' }],
      issues: [],
      confidence: 'medium',
      tagCount: 1,
      evidence: { related: [], wiki: [], failed: [], implications: true },
    }
    await js(
      `[...document.querySelectorAll('.preview .run-bar button')].find(b=>b.textContent.includes('开始推测')).click()`,
    )
    await waitUI(
      `[...document.querySelectorAll('.preview button')].some(b=>b.textContent.includes('带着建议去 AI 优化'))`,
    )
    await js(
      `[...document.querySelectorAll('.preview button')].find(b=>b.textContent.includes('带着建议去 AI 优化')).click()`,
    )
    await waitUI(`${request}?.value.includes('整体偏暗')`)
    const extra = await js(`${request}.value`)
    assert.ok(extra.startsWith('保持水彩'), extra)
    for (const s of ['想要更明亮', '整体偏暗', 'bright lighting', '光线太暗']) {
      assert.ok(extra.includes(s), s)
    }
    console.log(
      'PASS preview suggestions carry into AI optimize without overwriting the user request',
    )

    // 一个输入框：有提示词时优化（带上当前提示词），勾选重新生成时不带当前提示词
    assert.ok((await runText()).includes('优化提示词'))
    await js(`document.querySelector('.ai .run-bar .btn.accent').click()`)
    await wait(() => lastOptimize?.mode === 'optimize')
    assert.ok(lastOptimize.prompt.trim())
    assert.ok(lastOptimize.instruction.includes('保持水彩'))
    await js(`(()=>{const c=document.querySelector('.ai .fresh-toggle input');c.click()})()`)
    await waitUI(
      `document.querySelector('.ai .run-bar .btn.accent').textContent.includes('生成提示词') && !!document.querySelector('.ai .prompt-group.is-ignored')`,
    )
    lastOptimize = null
    await js(`document.querySelector('.ai .run-bar .btn.accent').click()`)
    await wait(() => lastOptimize?.mode === 'semantic')
    assert.deepEqual(
      [lastOptimize.prompt, lastOptimize.negative, lastOptimize.characters],
      ['', '', []],
    )
    await js(`document.querySelector('.ai .fresh-toggle input').click()`)
    await waitUI(
      `document.querySelector('.ai .run-bar .btn.accent').textContent.includes('优化提示词')`,
    )
    console.log(
      'PASS one request box: optimizes the current prompt, or regenerates from scratch without sending it',
    )

    // Ctrl+Enter 执行当前页主操作；有弹窗时不触发
    const beforeKey = optimizeCalls
    await js(
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))`,
    )
    await wait(() => optimizeCalls === beforeKey + 1)
    await js(
      `(()=>{const d=document.createElement('div');d.setAttribute('aria-modal','true');d.id='fake-modal';document.body.append(d)})()`,
    )
    await js(
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))`,
    )
    await pause(150)
    assert.equal(optimizeCalls, beforeKey + 1)
    await js(`document.getElementById('fake-modal').remove()`)
    // 底栏在滚动区之外：不覆盖内容，内容也不会从它下面滚过
    for (const view of ['ai', 'preview', 'generate']) {
      await click('.nav-item', { ai: 'AI 优化', preview: '画面推测', generate: '生图预览' }[view])
      assert.ok(
        await js(`(()=>{const f=document.querySelector('.${view} .pane-foot'),b=document.querySelector('.${view} .pane-body');
        return f.parentElement.classList.contains('left') && !b.contains(f) && getComputedStyle(f).position==='static'
          && f.getBoundingClientRect().top >= b.getBoundingClientRect().bottom - 1 && !!f.querySelector('.run-bar .btn.accent')})()`),
        view,
      )
    }
    await click('.nav-item', '提示词比对')
    await js(
      `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))`,
    )
    await pause(150)
    assert.equal(optimizeCalls, beforeKey + 1)
    console.log(
      'PASS Ctrl+Enter runs only the visible page action; action bars sit below the scroll area without overlapping content',
    )

    // 删除有内容的角色可撤销
    await click('.nav-item', 'AI 优化')
    const charsBefore = await js(`document.querySelectorAll('.ai .char-block').length`)
    if (charsBefore) {
      await js(`document.querySelector('.ai .char-block button[title="删除角色"]').click()`)
      await waitUI(`document.querySelector('.toast-action')?.textContent==='撤销'`)
      await js(`document.querySelector('.toast-action').click()`)
      await waitUI(`document.querySelectorAll('.ai .char-block').length===${charsBefore}`)
      console.log('PASS deleting a character can be undone from the toast')
    }

    // Real review UI: one continuous comparison per field, no unchanged groups,
    // exact full-text copy, and character positions/negative prompts grouped together.
    const unchangedContext = 'Her black hair and grey dress stay unchanged. '.repeat(12)
    const previousProse =
      unchangedContext + 'She stands in the doorway, smiling quietly, with her hands empty.'
    const nextProse =
      unchangedContext +
      'She stands beside the doorway, with both arms still, looking directly at the viewer, and the background stays empty.'
    await click('.nav-item', '提示词比对')
    await click('.section-tab', '主提示词1')
    await paste(
      `[Prompt]\nmanga, monochrome\n[Character 1 @ B3]\nsilver hair\n[Character 1 Undesired Content]\nglasses\n[Character 2 @ C3]\n${previousProse}\n[Character 2 Undesired Content]\nblurry\n[Undesired Content]\nlowres`,
    )
    reviewResult = {
      positive: 'manga, monochrome, detailed lineart',
      negative: 'lowres',
      characters: [
        { prompt: 'silver hair', negative: 'glasses', position: 'B3' },
        { prompt: nextProse, negative: 'blurry', position: 'D3' },
        {
          prompt:
            'girl, heart-shaped pupils, A close-up shows her eyes, with the nose outside the crop.',
          negative: 'ringed eyes',
          position: 'A1',
        },
      ],
      changes: [],
      invalid: [],
      notes: '',
      evidence: { related: [], wiki: [], failed: [], implications: true },
    }
    await click('.nav-item', 'AI 优化')
    await js(`document.querySelector('.ai .run-bar .btn.accent').click()`)
    await waitUI(`document.querySelectorAll('.ai .review-group').length === 3`)
    await js(`document.querySelector('.ai [data-group="global"] .diff-context').click()`)
    assert.equal(
      await js(`document.querySelector('.ai [data-group="global"] .before p').textContent`),
      'manga, monochrome',
    )
    assert.equal(
      await js(`document.querySelector('.ai [data-group="global"] .after p').textContent`),
      reviewResult.positive,
    )
    await js(`document.querySelector('.ai [data-group="global"] .diff-context').click()`)
    assert.equal(await js(`!!document.querySelector('.ai [data-group="character-0"]')`), false)
    assert.equal(
      await js(
        `[...document.querySelectorAll('.ai .review-field-head')].some(node => node.textContent.includes('负面词') && !node.closest('[data-group="character-2"]'))`,
      ),
      false,
    )
    assert.equal(
      await js(`document.querySelectorAll('.ai [data-group="character-1"] .diff-prose').length`),
      1,
    )
    assert.equal(
      await js(
        `document.querySelectorAll('.ai [data-group="character-1"] .review-position').length`,
      ),
      1,
    )
    assert.equal(
      await js(
        `document.querySelectorAll('.ai [data-group="character-2"] .review-status.added').length`,
      ),
      1,
    )
    assert.ok(
      await js(
        `document.querySelector('.ai [data-group="character-1"] .diff-context').getAttribute('aria-expanded') === 'false'`,
      ),
    )
    await js(`document.querySelector('.ai [data-group="character-1"] .diff-context').click()`)
    assert.equal(
      await js(`document.querySelector('.ai [data-group="character-1"] .before p').textContent`),
      previousProse,
    )
    assert.equal(
      await js(`document.querySelector('.ai [data-group="character-1"] .after p').textContent`),
      nextProse,
    )
    await js(
      `document.querySelector('.ai [data-group="character-1"] button[title="复制完整提示词"]').click()`,
    )
    await wait(() => copied === nextProse)
    await js(`document.querySelector('.ai [data-group="character-1"] .diff-context').click()`)
    for (const width of [2000, 1100]) {
      win.setSize(width, 960)
      await pause(180)
      assert.ok(
        await js(`(() => {
        const field = document.querySelector('.ai [data-group="character-1"] .prompt-diff')
        const panes = [...field.querySelectorAll('.diff-sentence')].map(node => node.getBoundingClientRect())
        return panes.every(rect => rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth + 1)
          && (field.clientWidth < 600 ? panes[1].top >= panes[0].bottom - 1 : Math.abs(panes[0].top - panes[1].top) < 1)
      })()`),
        'comparison follows its container width without clipping',
      )
      writeFileSync(
        join(profile, `prompt-review-${width}.png`),
        (await win.webContents.capturePage()).toPNG(),
      )
    }
    const revisionBeforeReview = pages.listPages().map((page) => pages.readPage(page.id).revision)
    await js(`document.querySelector('.ai [data-group="character-1"] summary').click()`)
    assert.deepEqual(
      pages.listPages().map((page) => pages.readPage(page.id).revision),
      revisionBeforeReview,
      'review controls never write workspace data',
    )
    console.log(
      'PASS grouped review hides unchanged fields, preserves prose/commas/copy, folds context and adapts to narrow containers',
    )

    // 主进程：AI 请求错误中文化、5xx 自动重试、Key 脱敏；Danbooru 熔断
    const { chat } = require('../../src/main/modules/prompts/chat.ts')
    saveSettings({
      apiKey: 'sk-secret-123',
      baseUrl: 'https://ai.fixture',
      model: 'm',
      reasoningEffort: 'off',
    })
    let aiHits = 0
    let aiStatus = [503, 200]
    net.fetch = async (url) => {
      if (String(url).startsWith('https://ai.fixture')) {
        const s = aiStatus[Math.min(aiHits++, aiStatus.length - 1)]
        return s === 200
          ? Response.json({ choices: [{ message: { content: 'ok' } }] })
          : new Response('{"error":{"message":"busy sk-secret-123"}}', { status: s })
      }
      if (String(url).includes('danbooru')) {
        danbooruHits++
        throw new Error('net::ERR_CONNECTION_RESET')
      }
      throw new Error('Unexpected network request')
    }
    assert.equal((await chat([{ role: 'user', content: 'hi' }])).content, 'ok')
    assert.equal(aiHits, 2)
    aiHits = 0
    aiStatus = [401]
    await assert.rejects(
      chat([{ role: 'user', content: 'hi' }]),
      (e) => /拒绝了 API Key/.test(e.message) && !e.message.includes('sk-secret-123'),
    )
    assert.equal(aiHits, 1, '401 must not retry')
    aiHits = 0
    aiStatus = [402]
    await assert.rejects(chat([{ role: 'user', content: 'hi' }]), /余额不足/)
    console.log(
      'PASS AI errors are readable, transient failures retry, keys are redacted, auth errors do not retry',
    )
    const { relatedTags, danbooruOffline } = require('../../src/main/modules/tags/knowledge.ts')
    const first = await relatedTags(['tag_a'])
    assert.deepEqual(first.failed, ['tag_a'])
    assert.ok(danbooruOffline())
    const hitsAfterFirst = danbooruHits
    const t0 = Date.now()
    const second = await relatedTags(['tag_b', 'tag_c'])
    assert.equal(danbooruHits, hitsAfterFirst, 'offline breaker skips network')
    assert.equal(second.failed.length, 2)
    assert.ok(Date.now() - t0 < 200)
    console.log(
      'PASS Danbooru failures trip a short offline breaker instead of waiting for every timeout',
    )
    console.log('All prompt checks passed. Profile:', profile)
  } catch (e) {
    console.error(e)
    process.exitCode = 1
    if (win) {
      writeFileSync(
        join(profile, 'failure.txt'),
        await win.webContents.executeJavaScript('document.body.innerText'),
      )
    }
  } finally {
    app.exit(process.exitCode || 0)
  }
})
