// Offline regressions against the built UI, with an isolated profile and no model traffic.
const { app, BrowserWindow, ipcMain, net } = require('electron')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { crc32 } = require('node:zlib')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { PNG } = require('pngjs')
const profile = mkdtempSync(join(tmpdir(), 'np-prompt-smoke-'))
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '..')
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText, f)
const { parsePromptText, readPngPrompt } = require('../src/shared/prompt-import.ts')
const { parsePrompt } = require('../src/main/prompt/parser.ts')
const pages = require('../src/main/page-workspaces.ts')
const { getSettings, saveSettings } = require('../src/main/settings.ts')
saveSettings({ apiKey: 'fixture', naiVersion: 'v5' })
net.fetch = async () => { throw new Error('Unexpected network request in offline regression') }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let copied = '', holdAnalysis = false, pending = [], calls = 0
function analysis(text) {
  const tokens = parsePrompt(text).map(t => {
    const tag = { name: t.core, display: t.core, category: 0, count: 100 }
    return { ...t, status: t.core === 'twin tails' ? 'alias' : t.core === 'bogus' ? 'unknown' : 'valid',
      tag, aliasOf: { ...tag, name: 'twintails', display: 'twintails' } }
  })
  return { tokens, stats: Object.fromEntries(['total', 'valid', 'alias', 'unknown', 'natural', 'text'].map(k =>
    [k, k === 'total' ? tokens.length : tokens.filter(t => t.status === k).length])) }
}
const handlers = {
  'agents:list': () => [],
  'tasks:list': () => ({ revision: 0, tasks: [] }),
  'settings:get': () => getSettings(), 'settings:save': (_, p) => saveSettings(p),
  'window:dark-titlebar': () => {}, 'skills:list': () => [], 'mcp:info': () => null, 'update:check': () => null, 'update:state': () => null,
  'db:status': () => ({ loaded: true, tagCount: 3, aliasCount: 1, zhCount: 0, implicationCount: 0 }),
  'nai:list': () => [], 'nai:freeCheck': () => ({ ok: false, reasons: [], notes: [] }),
  'clipboard:write': (_, text) => { copied = text },
  'pages:list': () => pages.listPages(), 'pages:read': (_, id) => pages.readPage(id),
  'pages:create': (_, ...args) => pages.createPage(...args), 'pages:edit': (_, ...args) => pages.editPage(...args),
  'prompt:analyze': (_, text) => {
    calls++
    return holdAnalysis ? new Promise(resolve => pending.push({ text, resolve: () => resolve(analysis(text)) })) : analysis(text)
  },
  'ai:optimize': () => ({ positive: 'outdoors', negative: '', characters: [], changes: [], invalid: [], notes: '',
    evidence: { related: [], wiki: [], failed: [], implications: true } })
}
for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(name, handler)

function pngWithComment(meta) {
  const png = PNG.sync.write(new PNG({ width: 64, height: 64 }))
  const text = Buffer.from('Comment\0' + JSON.stringify(meta)), chunk = Buffer.alloc(text.length + 12)
  chunk.writeUInt32BE(text.length); chunk.write('tEXt', 4); text.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
  return new Blob([Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)])])
}

app.whenReady().then(async () => {
  let win
  try {
    const metadata = { prompt: '', uc: '', width: 64, height: 64,
      v4_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: 'silver hair', centers: [{ x: .3, y: .5 }] }] }, use_coords: true },
      v4_negative_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: 'glasses' }] } } }
    const imported = await readPngPrompt(pngWithComment(metadata))
    assert.equal(imported.base, ''); assert.equal(imported.negative, '')
    assert.deepEqual(imported.characters, [{ prompt: 'silver hair', negative: 'glasses', position: 'B3' }])
    assert.equal(imported.width, 64); assert.equal(imported.fromMetadata, true)
    assert.deepEqual(parsePromptText(JSON.stringify({ input: '', parameters: metadata })), imported)
    await assert.rejects(readPngPrompt(pngWithComment({ prompt: '', uc: '' })), /没有找到提示词/)
    console.log('PASS character-only PNG and request JSON preserve prompts, negatives and coordinates; empty metadata is rejected')

    win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: {
      preload: join(__dirname, '../out/preload/index.js'), sandbox: false, backgroundThrottling: false, offscreen: true
    } })
    const js = code => win.webContents.executeJavaScript(code, true)
    const wait = async predicate => {
      for (let i = 0; i < 160; i++) { if (await predicate()) return; await pause(25) }
      throw new Error('Timed out: ' + predicate)
    }
    const waitUI = code => wait(() => js(code))
    const click = async (selector, text) => {
      await js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!b)throw new Error('Missing button: '+${JSON.stringify(text)});b.click()})()`)
      await pause(30)
    }
    const input = value => js(`(()=>{const e=document.querySelector('.compare textarea');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    const paste = value => js(`(()=>{const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(value)});document.querySelector('.compare textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`)
    const value = () => js(`document.querySelector('.compare textarea').value`)
    await win.loadFile(join(__dirname, '../out/renderer/index.html'))
    await waitUI(`document.querySelector('.side-bottom .seg')?.textContent.includes('V5')`)
    await paste('[Prompt]\ntwin tails\n[Undesired Content]\nlowres, blurry')
    await waitUI(`!!document.querySelector('.alias-item button')`)
    // Click the old DOM button in the same event turn as switching the target field.
    await js(`(()=>{const old=document.querySelector('.alias-item button');[...document.querySelectorAll('.section-tab')].find(b=>b.textContent.startsWith('负面')).click();old.click()})()`)
    assert.equal(await value(), 'lowres, blurry')
    assert.equal(await js(`document.querySelectorAll('.alias-item').length`), 0)
    console.log('PASS switching fields cannot apply stale alias offsets')

    await click('.section-tab', '主提示词1')
    await waitUI(`!!document.querySelector('.alias-item button')`)
    await js(`(()=>{const old=document.querySelector('.alias-item button');const t=document.querySelector('.compare textarea');t.value='outdoors';t.dispatchEvent(new Event('input',{bubbles:true}));old.click()})()`)
    assert.equal(await value(), 'outdoors')
    await input('bogus'); await waitUI(`!!document.querySelector('.unknown-head button')`)
    await js(`(()=>{const old=document.querySelector('.unknown-head button');const t=document.querySelector('.compare textarea');t.value='outdoors';t.dispatchEvent(new Event('input',{bubbles:true}));old.click()})()`)
    assert.equal(await value(), 'outdoors')
    console.log('PASS editing text invalidates both stale replacement and removal actions')

    await waitUI(`document.querySelector('.valid-wrap')?.textContent.includes('outdoors')`)
    holdAnalysis = true
    await input('twin tails'); await wait(() => pending.length === 1)
    await input('lowres'); await wait(() => pending.length === 2)
    pending[1].resolve(); await waitUI(`document.querySelector('.valid-wrap')?.textContent.includes('lowres')`)
    pending[0].resolve(); await pause(80)
    assert.equal(await js(`document.querySelectorAll('.alias-item').length`), 0)
    assert.ok(await js(`document.querySelector('.valid-wrap').textContent.includes('lowres')`))
    holdAnalysis = false; pending = []
    await paste('[Prompt]\ntwin tails\n[Undesired Content]\ntwin tails')
    await waitUI(`!!document.querySelector('.alias-item button')`)
    const beforeSwitch = calls
    await js(`(()=>{const old=document.querySelector('.alias-item button');[...document.querySelectorAll('.section-tab')].find(b=>b.textContent.startsWith('负面')).click();old.click()})()`)
    assert.equal(await value(), 'twin tails')
    await wait(() => calls > beforeSwitch)
    await waitUI(`!!document.querySelector('.alias-item button')`)
    await click('.alias-item button', '修正'); assert.equal(await value(), 'twintails')
    console.log('PASS late replies are ignored; equal-text fields reanalyze; current results remain actionable')

    await click('.nav-item', 'AI 优化'); await click('.ai .btn', '开始')
    await waitUI(`!!document.querySelector('.ai .cheer .primary')`)
    await click('.ai .cheer .primary', '采用')
    assert.equal(await js(`document.querySelector('.ai textarea[data-src="neg"]').value`), '')
    await click('.ai .cheer button', '撤销采用')
    assert.equal(await js(`document.querySelector('.ai textarea[data-src="neg"]').value`), 'twintails')
    console.log('PASS adopting an empty negative clears it; undo restores the original')

    await click('.nav-item', '提示词比对')
    await click('.section-tab', '主提示词1')
    await paste('[Prompt]\noutdoors\n[Character 1 @ B3]\nsilver hair\n[Character 1 Undesired Content]\nglasses\n[Undesired Content]\nblurry')
    await click('.nav-item', 'AI 工作台'); await click('.sessions-home header button', '新建会话')
    // Select the current shared prompt as the new session's starting point.
    await js(`document.querySelector('.session-create .theme-select').click()`)
    await click('.theme-select-option', '复制当前提示词')
    await click('.session-create button', '开始会话'); await waitUI(`!!document.querySelector('.pw-shell')`)
    await click('.pw-view-tabs button', '当前提示词')
    await js(`document.querySelector('[title="复制完整提示词"]').click()`)
    await wait(() => !!copied)
    assert.deepEqual(parsePromptText(copied), { base: 'outdoors', negative: 'blurry',
      characters: [{ prompt: 'silver hair', negative: 'glasses', position: 'B3' }], structured: true })
    await click('.nav-item', '提示词比对'); await paste(copied)
    assert.equal(await value(), 'outdoors')
    console.log('PASS workspace copy round-trips through the real paste flow with character negatives and positions')
    console.log('All prompt checks passed. Profile:', profile)
  } catch (e) {
    console.error(e); process.exitCode = 1
    if (win) writeFileSync(join(profile, 'failure.txt'), await win.webContents.executeJavaScript('document.body.innerText'))
  } finally { app.exit(process.exitCode || 0) }
})
