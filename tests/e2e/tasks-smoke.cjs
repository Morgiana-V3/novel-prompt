const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Exercises the real task IPC and built UI. Providers are fixtures; no accounts or credits are used.
const { app, BrowserWindow, ipcMain, net } = require('electron')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const preview = process.argv.includes('--preview')
app.disableHardwareAcceleration()
const profile = temporaryProfile('np-tasks-smoke-')
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '../..')
require('../support/register-typescript.cjs')
net.fetch = async () => {
  throw new Error('Unexpected network request')
}
const { TaskManager } = require('../../src/main/modules/tasks/task-manager.ts')
const { taskIsActive } = require('../../src/shared/tasks/model.ts')
const { getSettings, saveSettings } = require('../../src/main/modules/settings/service.ts')
saveSettings({ apiKey: 'offline-fixture', naiVersion: 'v5' })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const wait = async (predicate) => {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) {
      return
    }
    await pause(25)
  }
  throw new Error('Timed out: ' + predicate)
}
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const pending = { optimize: [], preview: [], database: [], generation: [], chat: [] }
let interactive = false
const optimized = {
  positive: '1girl, outdoors, soft light',
  negative: '',
  characters: [],
  changes: [],
  invalid: [],
  notes: '',
  evidence: { related: [], wiki: [], failed: [], implications: true },
}
for (const [module, method, kind] of [
  ['optimizer', 'optimizePrompt', 'optimize'],
  ['previewer', 'previewPrompt', 'preview'],
]) {
  require(`../../src/main/modules/prompts/${module}.ts`)[method] = (_, progress, signal) => {
    const d = { ...deferred(), progress, signal }
    pending[kind].push(d)
    progress(kind === 'optimize' ? '优化专属进度：正在核对提示词' : '推测专属进度：正在分析构图')
    // Deliberately ignore abort here: the manager must reject a late successful result too.
    if (interactive) {
      signal.addEventListener('abort', () => d.reject(new Error('已取消演示任务')), { once: true })
    }
    return d.promise
  }
}
require('../../src/main/modules/tags/fetcher.ts').updateTagDatabase = (_, progress, signal) => {
  const d = { ...deferred(), progress, signal }
  pending.database.push(d)
  progress({ stage: 'tags', message: '正在更新标签库', current: 55, total: 100 })
  signal.addEventListener('abort', () => d.reject(new Error('fixture aborted')), { once: true })
  return d.promise
}
const { tagStore } = require('../../src/main/modules/tags/store.ts')
tagStore.load = () => {}
tagStore.status = () => ({
  loaded: true,
  tagCount: 330000,
  aliasCount: 1000,
  zhCount: 10000,
  implicationCount: 1000,
})
require('../../src/main/modules/generation/service.ts').generateImages = (
  _,
  progress,
  isCancelled,
) => {
  const d = { ...deferred(), progress, isCancelled }
  pending.generation.push(d)
  progress('生成第 1/2 张…')
  return d.promise
}
const { pageLocks, createPage } = require('../../src/main/modules/workspace/index.ts')
require('../../src/main/modules/workspace/discussion.ts').discussPage = (id) => {
  const ctrl = new AbortController()
  const d = { ...deferred(), signal: ctrl.signal }
  pageLocks.set(id, ctrl)
  pending.chat.push(d)
  ctrl.signal.addEventListener('abort', () => d.reject(new Error('fixture cancelled')), {
    once: true,
  })
  return d.promise.finally(() => pageLocks.delete(id))
}
let win
let updateInfo = null
let installRequests = 0
let downloadRequests = 0
const pushUpdate = (patch) => {
  updateInfo = {
    current: '0.5.0',
    latest: '0.5.1',
    newer: true,
    checkedAt: Date.now(),
    url: '',
    autoSupported: true,
    ...updateInfo,
    ...patch,
    revision: (updateInfo?.revision ?? 0) + 1,
  }
  win.webContents.send('update:state', updateInfo)
}
const { registerTaskIpc } = require('../../src/main/adapters/ipc/tasks.ts')
const manager = registerTaskIpc((channel, payload) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
})
for (const [name, handler] of Object.entries({
  'images:cleanup-status': () => ({ pending: 0, message: '' }),
  'settings:get': () => getSettings(),
  'settings:save': (_, p) => saveSettings(p),
  'db:status': () => tagStore.status(),
  'window:image-preview': () => {},
  'skills:list': () => [],
  'mcp:info': () => null,
  'update:check': () => updateInfo,
  'reverse:status': () => ({ phase: 'idle', ready: false, models: [] }),
  'recipes:list': () => [],
  'update:state': () => updateInfo,
  'update:download': () => {
    downloadRequests++
  },
  'update:install': () => {
    installRequests++
  },
  'nai:list': () => [],
  'nai:freeCheck': () => ({ ok: false, reasons: [], notes: [] }),
  'pages:removed': () => [],
  'pages:list': () => [],
  'prompt:analyze': () => ({
    tokens: [],
    stats: { total: 0, valid: 0, alias: 0, unknown: 0, natural: 0, text: 0 },
  }),
})) {
  ipcMain.handle(name, handler)
}

async function checkManager() {
  const snapshots = []
  const m = new TaskManager((s) => snapshots.push(s))
  const d = deferred()
  let signal
  let progress
  const a = m.run('optimize', (ctx) => {
    signal = ctx.signal
    progress = ctx.progress
    return d.promise
  })
  const id = m.snapshot().tasks[0].id
  const rejected = assert.rejects(a, /已取消/)
  await assert.rejects(
    m.run('optimize', async () => {}),
    /仍在运行/,
  )
  const b = deferred()
  const other = m.run('preview', () => b.promise)
  m.cancel(id)
  assert.equal(signal.aborted, true)
  assert.equal(progress('too late'), false)
  assert.equal(m.snapshot().tasks.find((t) => t.id === id).message, '正在取消…')
  m.clearFinished()
  assert.equal(m.snapshot().tasks.length, 2)
  d.resolve('late result')
  await rejected
  b.resolve('preview ok')
  assert.equal(await other, 'preview ok')
  assert.equal(m.snapshot().tasks.find((t) => t.id === id).status, 'cancelled')
  const next = deferred()
  const retry = m.run('optimize', () => next.promise)
  m.cancel(id)
  assert.equal(m.snapshot().tasks[0].status, 'running')
  next.resolve('retry ok')
  await retry
  const saving = deferred()
  const gen = m.run('generate', () => saving.promise, {
    resource: 'generation',
    cancelMode: 'after-current',
  })
  const genId = m.snapshot().tasks[0].id
  m.cancel(genId)
  await assert.rejects(
    m.run('inpaint', async () => {}, { resource: 'generation' }),
    /仍在运行/,
  )
  saving.resolve({ saved: true })
  assert.deepEqual(await gen, { saved: true })
  assert.equal(m.snapshot().tasks[0].status, 'cancelled')
  await assert.rejects(
    m.run('optimize', async () => {
      throw new Error('fixture failure')
    }),
    /fixture failure/,
  )
  assert.equal(m.snapshot().tasks[0].status, 'failed')
  for (let i = 0; i < 25; i++) {
    await m.run('preview', async () => {})
  }
  assert.equal(m.snapshot().tasks.length, 20)
  assert.equal(snapshots[0].tasks[0].status, 'running', 'published snapshots do not mutate later')
  m.clearFinished()
  assert.equal(m.snapshot().tasks.length, 0)
  console.log(
    'PASS task identity, duplicate protection, isolated abort, late-result rejection, cooperative stop, resource locks and bounded history',
  )
}

app.whenReady().then(async () => {
  try {
    await checkManager()
    win = new BrowserWindow({
      show: false,
      title: 'NovelPrompt · 离线任务预览',
      width: 1440,
      height: 960,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#6b6c75', height: 40 },
      webPreferences: {
        preload: join(__dirname, '../../out/preload/index.js'),
        sandbox: false,
        backgroundThrottling: false,
        offscreen: !preview,
      },
    })
    const js = async (code) => {
      try {
        return await win.webContents.executeJavaScript(code, true)
      } catch (e) {
        console.error('Renderer command:', code)
        throw e
      }
    }
    const click = async (selector, text) => {
      await js(
        `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!e)throw new Error('Missing '+${JSON.stringify(text)});e.click()})()`,
      )
      await pause(40)
    }
    const ui = (code) => wait(() => js(code))
    const find = (kind) => manager.snapshot().tasks.find((t) => t.kind === kind && taskIsActive(t))
    const apiStart = (name, args = []) =>
      js(
        `void window.api[${JSON.stringify(name)}](...${JSON.stringify(args)}).then(r=>window.fixtureResult=r,e=>window.fixtureError=String(e))`,
      )
    await win.loadFile(join(__dirname, '../../out/renderer/index.html'))
    await ui(`document.querySelector('.side-bottom .seg')?.textContent.includes('V5')`)
    const avatar = await js(`document.querySelector('.brand-avatar img').src`)
    const idleSurface = await js(
      `(()=>{const s=document.querySelector('.task-surface'); return { width:s.getBoundingClientRect().width, color:getComputedStyle(s).backgroundColor }})()`,
    )
    pushUpdate({ stage: 'downloading', percent: 37 })
    await ui(`document.querySelector('.update-card').textContent.includes('37%')`)
    assert.ok(await js(`document.querySelector('.update-card .accent').disabled`))
    const oldUpdate = { ...updateInfo }
    pushUpdate({ stage: 'error', error: 'fixture offline' })
    await click('.update-card .accent', '重试下载')
    assert.equal(downloadRequests, 1)
    pushUpdate({ stage: 'ready', percent: 100, error: undefined })
    await ui(`document.querySelector('.update-card').textContent.includes('已就绪')`)
    win.webContents.send('update:state', oldUpdate)
    await pause(50)
    assert.match(await js(`document.querySelector('.update-card').textContent`), /已就绪/)
    await js(
      `(()=>{const e=document.querySelector('input[placeholder="sk-..."]');e.value='changed-unsaved';e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    await click('.update-card .accent', '重启并更新')
    assert.equal(installRequests, 0)
    assert.match(await js(`document.querySelector('.toast').textContent`), /尚未保存/)
    await js(
      `(()=>{const e=document.querySelector('input[placeholder="sk-..."]');e.value='offline-fixture';e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    await click('.update-card .accent', '重启并更新')
    await wait(() => installRequests === 1)
    assert.ok(await js(`localStorage.getItem('np-workspace-v1')!==null`))
    console.log(
      'PASS update UI: progress/retry, stale event protection, unsaved settings guard, flush before restart',
    )
    const sample = '[Prompt]\n1girl, outdoors, soft light\n[Undesired Content]\nblurry'
    await js(
      `document.title='NovelPrompt · 离线任务预览';const d=new DataTransfer();d.setData('text/plain',${JSON.stringify(sample)});document.querySelector('.compare textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))`,
    )
    await click('.nav-item', 'AI 优化')
    await click(
      '.ai .run-bar .btn.accent',
      await js("document.querySelector('.ai .run-bar .btn.accent').textContent.trim()"),
    )
    await wait(() => pending.optimize.length === 1)
    await click('.nav-item', '画面推测')
    await click(
      '.preview .run-bar .btn.accent',
      await js("document.querySelector('.preview .run-bar .btn.accent').textContent.trim()"),
    )
    await wait(() => pending.preview.length === 1)
    await apiStart('dbUpdate')
    await wait(() => pending.database.length === 1)
    await ui(
      `document.querySelector('.task-trigger').getAttribute('aria-label').includes('3 个任务')`,
    )
    const taskBounds = () =>
      js(`(()=>{
      const trigger=document.querySelector('.task-trigger').getBoundingClientRect();
      const content=document.querySelector('.content').getBoundingClientRect();
      return { x:trigger.x, width:trigger.width, height:trigger.height, contentTop:content.top };
    })()`)
    const beforeProgress = await taskBounds()
    await pause(500)
    const runningSurface = await js(
      `(()=>{const s=document.querySelector('.task-surface'); return { width:s.getBoundingClientRect().width, color:getComputedStyle(s).backgroundColor }})()`,
    )
    assert.ok(runningSurface.width > idleSurface.width)
    assert.equal(
      runningSurface.color,
      idleSurface.color,
      'starting work must not replace the surface color',
    )
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.task-loading i')).animationPlayState`),
      'running',
    )
    pending.database[0].progress({
      stage: 'tags',
      message: '正在更新标签库 · 很长的实时进度信息'.repeat(12),
    })
    await ui(`document.querySelector('.task-summary').textContent.includes('很长的实时进度信息')`)
    assert.deepEqual(await taskBounds(), beforeProgress)
    assert.ok(
      await js(
        `(()=>{const s=document.querySelector('.task-summary');return s.scrollWidth>s.clientWidth&&s.title===s.textContent})()`,
      ),
    )
    console.log(
      'PASS long task progress is truncated without moving the task trigger or page content',
    )
    assert.equal(await js(`document.querySelector('.brand-avatar img').src`), avatar)
    assert.ok(await js(`document.querySelector('.brand-avatar').classList.contains('m-avatar')`))
    assert.ok(await js(`document.querySelector('.update-card .accent').disabled`))
    assert.match(await js(`document.querySelector('.update-card .accent').textContent`), /任务结束/)
    console.log('PASS task start keeps brand avatar unchanged and blocks update installation')
    assert.ok(
      await js(
        `document.querySelector('.ai .timeline').textContent.includes('优化专属')&&!document.querySelector('.ai .timeline').textContent.includes('推测专属')`,
      ),
    )
    assert.ok(
      await js(
        `document.querySelector('.preview .timeline').textContent.includes('推测专属')&&!document.querySelector('.preview .timeline').textContent.includes('优化专属')`,
      ),
    )
    await js(`document.querySelector('.task-trigger').click()`)
    await ui(`document.querySelectorAll('.task-card.running').length===3`)
    const optimizeId = find('optimize').id
    await js(`document.querySelector('.task-card[data-kind="optimize"] .task-cancel').click()`)
    await wait(() => pending.optimize[0].signal.aborted)
    assert.equal(pending.preview[0].signal.aborted, false)
    assert.equal(pending.database[0].signal.aborted, false)
    pending.optimize[0].resolve(optimized)
    await ui(
      `document.querySelector('.task-card[data-kind="optimize"]').classList.contains('cancelled')`,
    )
    assert.equal(await js(`document.querySelectorAll('.ai .result-card').length`), 0)
    await js(`window.api.cancelTask()`)
    await wait(() => !find('db-update'))
    assert.equal(pending.preview[0].signal.aborted, false)
    console.log(
      'PASS real IPC and UI: independent AI logs, targeted cancellation and database cancel isolation',
    )

    await click('.task-card[data-kind="preview"] .task-title button', '画面推测')
    assert.ok(
      await js(`document.querySelector('.nav-item.active').textContent.includes('画面推测')`),
    )
    await click('.nav-item', 'AI 优化')
    await click(
      '.ai .run-bar .btn.accent',
      await js("document.querySelector('.ai .run-bar .btn.accent').textContent.trim()"),
    )
    await wait(() => pending.optimize.length === 2)
    await js(`window.api.tasksCancel(${JSON.stringify(optimizeId)})`)
    assert.equal(pending.optimize[1].signal.aborted, false)
    pending.optimize[1].resolve(optimized)
    await ui(`document.querySelectorAll('.ai .result-card').length>0`)
    // The preview can be cancelled from its own page, even when an optimization just finished.
    await click('.nav-item', '画面推测')
    await click('.preview .btn', '取消')
    await wait(() => pending.preview[0].signal.aborted)
    pending.preview[0].reject(new Error('fixture abort'))
    await wait(() => !find('preview'))
    const chatPage = await createPage(
      null,
      {
        width: 832,
        height: 1216,
        count: 1,
        seed: null,
        steps: 23,
        scale: 5,
        cfgRescale: 0,
        sampler: 'k_euler_ancestral',
        noiseSchedule: 'native',
        qualityTags: false,
        ucPreset: 'none',
      },
      'v5',
      { base: '1girl', negative: '', characters: [] },
    )
    await apiStart('pagesChat', [chatPage.id, chatPage.revision, 'hello', null, []])
    await wait(() => pending.chat.length === 1)
    await js(`window.api.tasksCancel(${JSON.stringify(find('page-chat').id)})`)
    await wait(() => pending.chat[0].signal.aborted && !find('page-chat'))
    console.log(
      'PASS stale cancellation IDs cannot stop retries; local cancel and workspace cancellation share the registry',
    )

    await apiStart('naiGenerate', [{}])
    await wait(() => pending.generation.length === 1)
    const genId = find('generate').id
    await js(`window.api.tasksCancel(${JSON.stringify(genId)})`)
    assert.equal(pending.generation[0].isCancelled(), true)
    assert.equal(find('generate').status, 'cancelling')
    const duplicate = await js(`window.api.naiInpaint({inpaint:{}}).then(()=>'',e=>String(e))`)
    assert.match(duplicate, /仍在运行/)
    pending.generation[0].resolve({ images: [{ name: 'fixture-saved.png' }] })
    await ui(`window.fixtureResult?.images?.[0]?.name==='fixture-saved.png'`)
    assert.match(
      await js(`window.fixtureResult.stopped`),
      /已停止/,
      'a single-image result must also stop the renderer batch queue',
    )
    console.log(
      'PASS image cancellation waits for the saved result and keeps the generation lock until completion',
    )

    await js(`window.api.tasksClear()`)
    await wait(() => manager.snapshot().tasks.length === 0)
    await pause(900)
    assert.equal(
      await js(`document.querySelector('.task-surface').getBoundingClientRect().width`),
      idleSurface.width,
    )
    assert.equal(
      await js(`getComputedStyle(document.querySelector('.task-loading i')).animationPlayState`),
      'paused',
    )
    console.log('PASS task control morphs and spins while active, then returns to its idle shape')
    await click('.nav-item', 'AI 优化')
    await click(
      '.ai .run-bar .btn.accent',
      await js("document.querySelector('.ai .run-bar .btn.accent').textContent.trim()"),
    )
    await click('.nav-item', '画面推测')
    await click(
      '.preview .run-bar .btn.accent',
      await js("document.querySelector('.preview .run-bar .btn.accent').textContent.trim()"),
    )
    await apiStart('dbUpdate')
    await wait(() => pending.database.length === 2)
    pending.optimize.at(-1).progress('演示 · 正在核对角色特征与提示词结构…')
    pending.preview.at(-1).progress('演示 · 正在分析构图、光影与人物关系…')
    pending.database.at(-1).progress({
      stage: 'tags',
      message: '演示 · 已整理 18,150 / 33,000 条标签',
      current: 18150,
      total: 33000,
    })
    await click('.nav-item', 'AI 优化')
    await js(`document.querySelector('.task-trigger').click()`)
    await ui(`document.querySelectorAll('.task-card.running').length===3`)
    await pause(300)
    writeFileSync(join(profile, 'tasks-desktop.png'), (await win.webContents.capturePage()).toPNG())
    win.setSize(1100, 760)
    await pause(300)
    assert.ok(
      await js(
        `(()=>{const p=document.querySelector('.task-panel').getBoundingClientRect();return p.top>=40&&p.bottom<=innerHeight&&p.right<=innerWidth})()`,
      ),
    )
    writeFileSync(join(profile, 'tasks-compact.png'), (await win.webContents.capturePage()).toPNG())
    win.setSize(1440, 960)
    console.log('PASS task panel fits desktop and minimum window sizes')
    console.log('Preview artifacts:', profile)
    if (preview) {
      interactive = true
      // Interactive fixture: cancellation completes locally; no real services are contacted.
      for (const kind of ['optimize', 'preview']) {
        const d = pending[kind].at(-1)
        d.signal.addEventListener('abort', () => d.reject(new Error('已取消演示任务')), {
          once: true,
        })
      }
      win.show()
      win.focus()
      win.on('closed', () => app.quit())
      console.log('Interactive offline preview is open. Close the window to exit.')
      return
    }
    app.exit(0)
  } catch (e) {
    console.error(e)
    if (win && !win.isDestroyed()) {
      writeFileSync(
        join(profile, 'failure.txt'),
        await win.webContents.executeJavaScript('document.body.innerText'),
      )
    }
    console.error('Artifacts:', profile)
    app.exit(1)
  }
})
