const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Two real stdio clients -> authenticated local bridge -> real task/workspace services -> built Vue UI.
// All provider traffic is intercepted; profiles, images and screenshots are isolated.
const { app, BrowserWindow, ipcMain, net, protocol, shell } = require('electron')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
} = require('node:fs')
const { join, resolve, sep, basename } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { PNG } = require('pngjs')
const root = join(__dirname, '../..')
const buildDirectory = resolve(process.env.NP_TEST_BUILD_DIR || join(root, 'out'))
const profile = temporaryProfile('np-desktop-mcp-')
app.setPath('userData', profile)
app.getAppPath = () => root
app.disableHardwareAcceleration()
const recycle = join(profile, 'recycle')
mkdirSync(recycle)
shell.trashItem = async (path) => {
  assert.ok(
    resolve(path).startsWith(resolve(profile) + sep),
    'only isolated fixture files may be recycled',
  )
  renameSync(path, join(recycle, require('node:crypto').randomUUID() + '-' + basename(path)))
}
protocol.registerSchemesAsPrivileged([
  { scheme: 'np-img', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
require('../support/register-typescript.cjs')
const settings = require('../../src/main/modules/settings/service.ts')
const pages = require('../../src/main/modules/workspace/index.ts')
const client = require('../../src/main/modules/generation/index.ts')
const { tagStore } = require('../../src/main/modules/tags/store.ts')
settings.saveSettings({
  apiKey: 'offline-fixture',
  naiToken: 'fixture',
  mcpAllowAi: true,
  mcpAllowGenerate: true,
  naiVersion: 'v5',
})
tagStore.status = () => ({
  loaded: true,
  tagCount: 330000,
  aliasCount: 1000,
  zhCount: 10000,
  implicationCount: 1000,
})
let pendingGeneration = []
let autoGenerate = false
let holdAi = false
let aiStarted = 0
let freeTier = true
const generationInputs = []
net.fetch = async (url, init) => {
  if (url.endsWith('/user/subscription')) {
    return Response.json({
      active: true,
      tier: freeTier ? 3 : 1,
      trainingStepsLeft: { fixedTrainingStepsLeft: 1000, purchasedTrainingSteps: 0 },
      usage: { percent: 80, isNegative: false },
    })
  }
  if (url.endsWith('/chat/completions')) {
    aiStarted++
    if (holdAi) {
      await new Promise((resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(Error('fixture cancelled')), {
          once: true,
        }),
      )
    }
    const input = JSON.parse(JSON.parse(init.body).messages[1].content[0].text)
    const proposal = {
      title: '前台 AI 修改建议',
      warning: '',
      draft: { ...input.draft, base: input.draft.base + ', blue sky' },
      execution: { kind: 'generate', regionId: null },
    }
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              reply: '已按当前输入提出修改，请检查并采纳。',
              understanding: null,
              proposal,
            }),
          },
        },
      ],
    })
  }
  assert.equal(url, 'https://image.novelai.net/ai/generate-image')
  generationInputs.push(JSON.parse(init.body))
  if (!autoGenerate) {
    await new Promise((resolve) => pendingGeneration.push(resolve))
  }
  const params = JSON.parse(init.body).parameters
  const png = new PNG({ width: params.width, height: params.height })
  png.data.fill(generationInputs.length % 2 ? 255 : 100)
  for (let i = 3; i < png.data.length; i += 4) {
    png.data[i] = 255
  }
  return new Response(PNG.sync.write(png), { headers: { 'content-type': 'image/png' } })
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const wait = async (predicate) => {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) {
      return
    }
    await pause(25)
  }
  throw Error('Timed out: ' + predicate)
}
let win
let bridge
let desktop
const send = (channel, payload) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
  bridge?.changed()
}
const { registerTaskIpc } = require('../../src/main/adapters/ipc/tasks.ts')
const tasks = registerTaskIpc(send)
const cleanup = require('../../src/main/modules/workspace/image-cleanup.ts')
for (const [name, handler] of Object.entries({
  'images:cleanup-status': () => ({ pending: 0, message: '' }),
  'settings:get': () => settings.getSettings(),
  'settings:save': (_, p) => settings.saveSettings(p),
  'db:status': () => tagStore.status(),
  'window:image-preview': () => {},
  'skills:list': () => [],
  'mcp:info': () => ({
    command: process.execPath,
    args: [join(root, 'src/runtime/mcp-proxy.cjs'), root],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      NOVELPROMPT_MCP_GROUPS: 'all',
      NOVELPROMPT_USER_DATA: profile,
    },
    packaged: false,
    portable: false,
    log: [],
  }),
  'update:check': () => null,
  'update:state': () => null,
  'nai:list': () => client.listImages(),
  'nai:freeCheck': () => ({ ok: true, reasons: [], notes: [] }),
  'nai:readImage': (_, name) => new Uint8Array(readFileSync(client.imagePath(name))),
  'pages:removed': () => pages.listRemovedPages(),
  'pages:list': () => pages.listPages(),
  'pages:read': (_, id) => pages.readPage(id),
  'pages:edit': (_, id, rev, action) => pages.editPage(id, rev, action),
  'pages:create': (_, image, params, model, draft) => pages.createPage(image, params, model, draft),
  'pages:delete': (_, id, revision) => cleanup.deletePageWithImages(id, revision),
  'pages:clear-image': (_, id, revision, version) => cleanup.clearPageImage(id, revision, version),
  'prompt:analyze': () => ({
    tokens: [],
    stats: { total: 0, valid: 0, alias: 0, unknown: 0, natural: 0, text: 0 },
  }),
})) {
  ipcMain.handle(name, handler)
}
const clients = []
function connectAgent() {
  const child = spawn(process.execPath, [join(root, 'src/runtime/mcp-proxy.cjs'), root], {
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NOVELPROMPT_USER_DATA: profile },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let next = 1
  let stderr = ''
  const waiting = new Map()
  const events = []
  child.stderr.on('data', (b) => (stderr += b))
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line)
    if (msg.id === undefined) {
      events.push(msg)
    } else {
      const item = waiting.get(msg.id)
      if (item) {
        clearTimeout(item.timer)
        waiting.delete(msg.id)
        item.resolve(msg)
      }
    }
  })
  child.on('exit', (code) => {
    for (const p of waiting.values()) {
      clearTimeout(p.timer)
      p.reject(Error('Agent exited ' + code + ': ' + stderr))
    }
    waiting.clear()
  })
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next++
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(Error(method + ' timeout ' + stderr))
      }, 20000)
      waiting.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  const agent = {
    child,
    events,
    request,
    async tool(name, args = {}, meta) {
      const r = await request('tools/call', {
        name,
        arguments: args,
        ...(meta ? { _meta: meta } : {}),
      })
      if (r.error || r.result?.isError) {
        throw Error(r.error?.message || r.result.content[0].text)
      }
      return r.result
    },
    async data(name, args = {}) {
      const r = await this.tool(name, args)
      return r.structuredContent ?? JSON.parse(r.content[0].text)
    },
  }
  clients.push(agent)
  return agent
}
app.whenReady().then(async () => {
  try {
    const { DesktopBridge } = require('../../src/main/adapters/desktop/bridge.ts')
    const { startMcpBridge } = require('../../src/main/adapters/mcp/bridge.ts')
    const { desktopTools } = require('../../src/main/adapters/mcp/desktop-tools.ts')
    const { frontendTools } = require('../../src/main/adapters/mcp/frontend-tools.ts')
    const { agentExecutor } = require('../../src/main/adapters/mcp/runtime.ts')
    const { buildTools, MCP_INSTRUCTIONS } = require('../../src/main/adapters/mcp/tools.ts')
    // Foreground tools call show()/focus(): an offscreen BrowserWindow would expose
    // Electron's "No content under offscreen mode" placeholder on the real desktop.
    const testTitle = 'NovelPrompt · 自动化测试（独立数据）'
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 960,
      title: testTitle,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(buildDirectory, 'preload/index.js'),
        sandbox: false,
        backgroundThrottling: false,
      },
    })
    win.on('page-title-updated', (event) => {
      event.preventDefault()
      win.setTitle(testTitle)
    })
    assert.equal(
      win.webContents.isOffscreen(),
      false,
      'foreground tests must use a normally rendered native window',
    )
    desktop = new DesktopBridge(
      () => win,
      () => {},
    )
    desktop.onChange = () => bridge?.changed()
    const state = () => ({
      hostPid: process.pid,
      visible: win.isVisible(),
      desktop: desktop.state,
      tasks: tasks.snapshot(),
    })
    bridge = await startMcpBridge(
      root,
      profile,
      [...buildTools(), ...desktopTools(desktop, tasks, state), ...frontendTools(desktop)],
      { name: 'novel-prompt', version: '0.5.0', instructions: MCP_INSTRUCTIONS },
      { state, execute: agentExecutor(tasks, desktop, send) },
    )
    protocol.handle(
      'np-img',
      (req) =>
        new Response(
          readFileSync(client.imagePath(decodeURIComponent(new URL(req.url).pathname.slice(1)))),
        ),
    )
    await win.loadFile(join(buildDirectory, 'renderer/index.html'))
    const js = (code) => win.webContents.executeJavaScript(code, true)
    const ui = (predicate) => wait(() => js(predicate))
    const assertExecutionBarAtBottom = async () => {
      const bounds = await js(`(() => {
        const column = document.querySelector('.pw-canvas-column').getBoundingClientRect()
        const bar = document.querySelector('.pw-execution').getBoundingClientRect()
        return {columnBottom: column.bottom, barBottom: bar.bottom, barHeight: bar.height, viewportHeight: innerHeight}
      })()`)
      assert.ok(
        Math.abs(bounds.barBottom - bounds.columnBottom) <= 1 &&
          bounds.barBottom <= bounds.viewportHeight + 1 &&
          bounds.barHeight >= 60,
        `execution controls stay at the workspace bottom and inside the viewport: ${JSON.stringify(bounds)}`,
      )
    }
    const click = async (selector, text) => {
      await js(
        `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled);if(!e)throw Error('Missing '+${JSON.stringify(text)});e.click()})()`,
      )
      await pause(50)
    }
    await wait(() => desktop.state?.model === 'v5')
    const a = connectAgent()
    const b = connectAgent()
    for (const c of [a, b]) {
      await c.request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'fixture-agent', version: '1' },
      })
    }
    assert.equal((await a.data('get_app_state')).hostPid, (await b.data('get_app_state')).hostPid)
    assert.equal((await a.request('tools/list')).result.tools.length, 6)
    const grouped = await a.data('configure_tools', { groups: ['tags', 'skills'] })
    const groupedNames = grouped.groups.flatMap((g) => g.tools)
    assert.equal(new Set(groupedNames).size, 69)
    assert.equal(groupedNames.length, 69)
    assert(!groupedNames.includes('list_skill_templates'))
    assert.ok(grouped.exposedToolCount < 25)
    assert.equal((await b.request('tools/list')).result.tools.length, 6)
    for (const c of [a, b]) {
      await c.data('configure_tools', { groups: grouped.groups.map((g) => g.id) })
    }
    const schemas = (await a.request('tools/list')).result.tools
    assert.equal(schemas.length, 69)
    for (const tool of schemas) {
      assert.equal(
        tool.outputSchema.title,
        `${tool.name}.result`,
        'every production tool has a specific output contract',
      )
    }
    await assert.rejects(a.tool('ui_capture_app'), /隐藏|最小化/)
    await assert.rejects(a.tool('ui_capture_app', { max_edge: 99999 }), /512/)
    assert.equal((await a.request('initialize', null)).error.code, -32600)
    assert.equal((await b.request('ping')).result.constructor, Object)
    const beforeInvalid = (await a.data('list_workspaces')).items.length
    await assert.rejects(
      a.tool('create_workspace', {
        draft: { base: '1girl', negative: '', characters: [] },
        title: 'x'.repeat(6001),
        show: false,
      }),
      /标题/,
    )
    assert.equal((await a.data('list_workspaces')).items.length, beforeInvalid)
    await a.request('resources/subscribe', { uri: 'novelprompt://app/state' })
    let s = await a.data('get_app_state')
    await js(
      `(()=>{const e=document.querySelector('.compare textarea');e.value='1girl, glasses';e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    await wait(() => a.events.some((e) => e.method === 'notifications/resources/updated'))
    await assert.rejects(
      b.tool('apply_app_prompt', {
        expected_token: s.desktop.token,
        draft: { base: 'stale', negative: '', characters: [] },
      }),
      /已变化/,
    )
    s = await b.data('get_app_state')
    await b.tool('apply_app_prompt', {
      expected_token: s.desktop.token,
      draft: { base: '1girl, outdoors', negative: 'blurry', characters: [] },
    })
    await ui(`document.querySelector('.compare textarea').value==='1girl, outdoors'`)
    assert.ok(
      await js(
        `JSON.parse(localStorage.getItem('np-workspace-v1')).history.some(h=>h.base==='1girl, glasses')`,
      ),
    )
    await a.tool('navigate_app', { tab: 'ai' })
    await ui(`document.querySelector('.nav-item.active').textContent.includes('AI 优化')`)
    assert.equal(
      win.isVisible(),
      true,
      'foreground navigation reveals the normally rendered test window',
    )
    assert.equal((await a.data('get_app_state')).visible, true)
    await js(
      `(()=>{const el=document.createElement('div');el.id='capture-private-fixture';el.dataset.mcpPrivate='';el.textContent='PRIVATE_FIXTURE';el.style.cssText='position:fixed;left:250px;top:10px;width:100px;height:40px;z-index:2147483647;background:rgb(250,0,250);color:white';document.body.append(el)})()`,
    )
    await pause(150)
    const magenta = (buffer) => {
      const p = PNG.sync.read(buffer)
      let n = 0
      for (let i = 0; i < p.data.length; i += 4) {
        if (p.data[i] === 250 && p.data[i + 1] === 0 && p.data[i + 2] === 250) {
          n++
        }
      }
      return n
    }
    assert.ok(
      magenta((await win.webContents.capturePage()).toPNG()) > 100,
      'sensitive fixture is actually visible before capture',
    )
    const screenshot = await a.tool('ui_capture_app', { max_edge: 1024 })
    const screenshotImage = screenshot.content.find((c) => c.type === 'image')
    assert.equal(screenshotImage.mimeType, 'image/png')
    assert.equal(
      magenta(Buffer.from(screenshotImage.data, 'base64')),
      0,
      'private region never appears in returned pixels',
    )
    assert.ok(
      Math.max(
        screenshot.structuredContent.displayed.width,
        screenshot.structuredContent.displayed.height,
      ) <= 1024,
    )
    assert.equal(screenshot.structuredContent.desktop.tab, 'ai')
    assert.equal(screenshot.structuredContent.redactedFields, 1)
    assert.equal(
      await js(`getComputedStyle(document.getElementById('capture-private-fixture')).visibility`),
      'visible',
    )
    assert.equal(await js(`!!document.getElementById('np-mcp-capture-privacy')`), false)
    await js(`document.getElementById('capture-private-fixture').remove()`)
    await a.tool('navigate_app', { tab: 'settings' })
    const settingsShot = await a.tool('ui_capture_app')
    assert.equal(settingsShot.structuredContent.redactedFields, 2)
    await a.tool('navigate_app', { tab: 'ai' })
    console.log(
      'PASS real application screenshot, bounded dimensions, hidden-window refusal and credential redaction with UI restored',
    )
    console.log(
      'PASS two real stdio agents share a host; live state/subscriptions, tab navigation, visible prompt writes, stale-token rejection and undo history',
    )

    const generation = a.tool(
      'generate_image',
      { base: '1girl', width: 64, height: 64, confirm: true },
      { progressToken: 'generation-1' },
    )
    await wait(() => pendingGeneration.length === 1)
    await assert.rejects(b.tool('generate_image', { base: '1girl', confirm: true }), /仍在运行/)
    const denied = await js(`window.api.naiGenerate({}).then(()=>'',e=>String(e))`)
    assert.match(denied, /仍在运行/)
    const active = (await b.data('list_tasks')).tasks.find(
      (t) => t.kind === 'generate' && t.status === 'running',
    )
    assert.equal(active.origin, 'agent')
    await js(`document.querySelector('.task-trigger').click()`)
    await ui(`document.querySelector('.task-panel').textContent.includes('Agent · NovelAI 生图')`)
    await b.tool('cancel_task', { id: active.id })
    pendingGeneration.shift()()
    const generated = JSON.parse((await generation).content[0].text)
    assert.match(generated.stopped, /已停止/)
    assert.equal(generated.images.length, 1)
    assert.ok(
      a.events.some(
        (e) => e.method === 'notifications/progress' && e.params.progressToken === 'generation-1',
      ),
    )
    const picture = await b.tool('read_image', { name: generated.images[0].name })
    assert.ok(picture.content.some((c) => c.type === 'image'))
    await js(`document.querySelector('.task-trigger').click()`)
    console.log(
      'PASS MCP/UI generation exclusion, real progress, shared cancellation, saved results and direct MCP image content',
    )

    let w = await a.data('create_workspace', {
      title: 'Agent 联动测试',
      show: true,
      draft: { base: '1girl, green eyes', negative: 'blurry', characters: [] },
    })
    await ui(`document.querySelector('.pw-heading').textContent.includes('Agent 联动测试')`)
    w = await b.data('get_workspace', { id: w.id })
    const oldRevision = w.revision
    w = await a.data('propose_workspace_edit', {
      id: w.id,
      revision: w.revision,
      title: '仅修改眼睛颜色',
      explanation: '外部 Agent 提交的修改，等待采纳。',
      draft: { base: '1girl, blue eyes', negative: 'blurry', characters: [] },
    })
    await ui(`document.querySelector('.pw-shell').textContent.includes('仅修改眼睛颜色')`)
    const proposal = w.messages.at(-1)
    assert.equal(proposal.proposal.status, 'pending')
    assert.equal(
      proposal.proposal.contextKey,
      undefined,
      'internal context including masks is not sent to agents',
    )
    await assert.rejects(
      b.tool('apply_workspace_action', {
        id: w.id,
        revision: oldRevision,
        action: { type: 'proposal', messageId: proposal.id, decision: 'accept' },
      }),
      /更新/,
    )
    w = await b.data('get_workspace', { id: w.id })
    w = await b.data('apply_workspace_action', {
      id: w.id,
      revision: w.revision,
      action: { type: 'proposal', messageId: proposal.id, decision: 'accept' },
    })
    assert.equal(
      (
        await b.data('get_workspace', {
          id: w.id,
          detail: 'full',
          version_ids: [w.currentVersionId],
        })
      ).versions[0].editor.draft.base,
      '1girl, blue eyes',
    )
    await click('.pw-view-tabs button', '生图配置')
    await click('.pw-execution button', '编辑配置')
    await assert.rejects(
      a.tool('propose_workspace_edit', {
        id: w.id,
        revision: w.revision,
        title: '冲突修改',
        draft: { base: 'wrong', negative: '', characters: [] },
      }),
      /正在编辑/,
    )
    await ui(`!!document.querySelector('.pw-config-back')`)
    await click('.pw-execution button', '返回查看')
    await js(
      `(()=>{const e=document.querySelector('.pw-compose textarea');e.value='用户还没发送的新想法';e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    w = await b.data('get_workspace', { id: w.id })
    assert.equal(w.composer, '用户还没发送的新想法')
    autoGenerate = true
    const produced = await b.data('generate_workspace', {
      id: w.id,
      revision: w.revision,
      confirm: true,
    })
    assert.equal(produced.workspace.versions.length, 2)
    await ui(`!!document.querySelector('.pw-viewport img')`)
    await b.tool('navigate_app', { tab: 'workspace', workspace_id: w.id })
    await pause(250)
    writeFileSync(
      join(profile, 'desktop-agent-workspace.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    win.setSize(1100, 760)
    await pause(250)
    writeFileSync(
      join(profile, 'desktop-agent-compact.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    console.log(
      'PASS workspace create/open, live proposal/review/adoption, revision conflicts, active-editor guard, composer preservation and generation history',
    )
    win.setSize(1440, 960)
    const stages = []
    desktop.onChange = () => {
      bridge?.changed()
      if (desktop.state?.frontend) {
        stages.push(structuredClone(desktop.state))
      }
    }
    let front = await a.data('ui_open_workspace', { id: w.id })
    assert.equal(front.workspace.id, w.id)
    const beforeCancelledCreate = pages.listPages().length
    const cancelledCreate = a
      .data('ui_create_workspace', { title: '取消新建测试', source: 'blank', step_delay_ms: 1000 })
      .then(
        () => null,
        (e) => e,
      )
    await ui(`!!document.querySelector('dialog[open] .project-agent-stop')`)
    await js(`document.querySelector('.project-agent-stop').click()`)
    assert.match(String(await cancelledCreate), /停止|取消/)
    assert.equal(pages.listPages().length, beforeCancelledCreate)
    await js(`document.querySelector('.session-create [title="取消新建"]').click()`)
    front = await a.data('ui_create_workspace', { title: '可视化前台验收', source: 'current' })
    const frontId = front.workspace.id
    const firstVersion = front.workspace.versionId
    const act = async (name, args = {}) => {
      const latest = (await a.data('get_app_state')).desktop
      return a.data(name, { id: frontId, expected_token: latest.token, ...args })
    }
    assert.equal(pages.readPage(frontId).title, '可视化前台验收')
    // The manual form and MCP share the same isolated next-generation draft.
    const configBefore = structuredClone(pages.readPage(frontId).versions[0])
    const configBounds = await js(
      `(()=>{const r=document.querySelector('.pw-execution').getBoundingClientRect();return [r.y,r.height]})()`,
    )
    front = await act('ui_edit_workspace_config', { config_action: 'begin' })
    assert.equal(front.workspace.pane, 'config-edit')
    assert.equal(front.workspace.config.open, true)
    assert.equal(await js(`document.querySelector('.workspace-prompt textarea').readOnly`), false)
    assert.equal(
      await js(`document.querySelector('.workspace-prompt [aria-label="步数"]').disabled`),
      false,
    )
    const configToken = front.token
    front = await act('ui_edit_workspace_config', {
      config_action: 'update',
      patch: {
        draft: { base: 'manual configuration', negative: 'test negative' },
        params: { steps: 27, scale: 4.5, seed: 1234 },
      },
    })
    assert.equal(front.workspace.config.draft.base, 'manual configuration')
    assert.equal(
      await js(`document.querySelector('.workspace-prompt textarea').value`),
      'manual configuration',
    )
    assert.equal(
      pages.readPage(frontId).versions[0].editor.draft.base,
      configBefore.editor.draft.base,
      'update is not an implicit save',
    )
    await assert.rejects(
      a.tool('ui_edit_workspace_config', {
        id: frontId,
        expected_token: configToken,
        config_action: 'cancel',
      }),
      /变化/,
    )
    await assert.rejects(
      b.tool('ui_edit_workspace_config', {
        id: frontId,
        expected_token: (await a.data('get_app_state')).desktop.token,
        config_action: 'cancel',
      }),
      /用户或其他 Agent/,
    )
    front = await act('ui_edit_workspace_config', {
      config_action: 'update',
      patch: { params: { count: 4, qualityTags: true, ucPreset: 'light' } },
    })
    assert.equal(front.workspace.config.params.count, 4)
    assert.equal(front.workspace.config.params.qualityTags, true)
    assert.equal(front.workspace.config.params.ucPreset, 'light')
    assert.equal(front.workspace.config.disabledFields.count, undefined)
    await assert.rejects(
      act('ui_edit_workspace_config', { config_action: 'update', patch: { params: { steps: 0 } } }),
      /参数无效/,
    )
    front = await act('ui_edit_workspace_config', { config_action: 'save' })
    assert.equal(front.workspace.config.open, false)
    assert.equal(pages.readPage(frontId).versions[0].editor.params.steps, 27)
    assert.deepEqual(
      pages.readPage(frontId).versions[0].initial,
      configBefore.initial,
      'saved image recipe remains frozen',
    )
    await act('ui_view_workspace', { pane: 'prompt' })
    assert.equal(
      await js(`document.querySelector('.workspace-prompt textarea').value`),
      configBefore.initial.draft.base,
    )
    assert.equal(await js(`document.querySelector('.workspace-prompt textarea').readOnly`), true)
    await act('ui_edit_workspace_config', { config_action: 'begin' })
    await act('ui_edit_workspace_config', {
      config_action: 'update',
      patch: { draft: { base: 'cancel this' } },
    })
    await act('ui_edit_workspace_config', { config_action: 'cancel' })
    assert.equal(pages.readPage(frontId).versions[0].editor.draft.base, 'manual configuration')
    await act('ui_edit_workspace_config', { config_action: 'begin' })
    await js(
      `document.querySelector('.workspace-prompt textarea').dispatchEvent(new Event('input',{bubbles:true}))`,
    )
    await assert.rejects(
      act('ui_edit_workspace_config', {
        config_action: 'update',
        patch: { draft: { base: 'overwrite user' } },
      }),
      /用户或其他 Agent/,
    )
    await assert.rejects(
      act('ui_edit_workspace_config', { config_action: 'resume' }),
      /用户或其他 Agent/,
    )
    assert.equal((await a.data('get_app_state')).connection.workspace.editor.ownership, 'user')
    await click('.pw-execution button', '返回查看')
    const orphan = connectAgent()
    await orphan.request('initialize', { clientInfo: { name: 'orphan-draft-fixture' } })
    const orphanAct = async (args) =>
      orphan.data('ui_edit_workspace_config', {
        id: frontId,
        expected_token: (await orphan.data('get_app_state')).desktop.token,
        ...args,
      })
    await orphanAct({ config_action: 'begin' })
    await orphanAct({
      config_action: 'update',
      patch: { draft: { base: 'retained disconnected draft' } },
    })
    await assert.rejects(
      act('ui_edit_workspace_config', { config_action: 'resume' }),
      /用户或其他 Agent/,
    )
    const orphanSession = (await orphan.data('get_app_state')).connection.sessionId
    orphan.child.stdin.end()
    await wait(
      () =>
        !require('../../src/main/modules/workspace/agent-sessions.ts').agentIsConnected(
          orphanSession,
        ),
    )
    const recovery = await a.data('get_app_state')
    assert.equal(recovery.connection.workspace.editor.canResume, true)
    assert.equal(recovery.desktop.workspace.config.draft.base, 'retained disconnected draft')
    assert.equal(
      pages.readPage(frontId).versions[0].editor.draft.base,
      'manual configuration',
      'disconnect does not save a draft',
    )
    await act('ui_edit_workspace_config', { config_action: 'resume' })
    const resumed = await a.data('get_app_state')
    assert.equal(resumed.connection.workspace.editor.ownership, 'self')
    assert.equal(resumed.desktop.workspace.config.draft.base, 'retained disconnected draft')
    await act('ui_edit_workspace_config', { config_action: 'cancel' })
    console.log(
      'PASS orphaned config recovery preserves draft; connected-agent and human edits remain protected; no auto-save',
    )
    await act('ui_edit_workspace_config', { config_action: 'begin' })
    await act('ui_edit_workspace_config', {
      config_action: 'update',
      patch: {
        draft: configBefore.editor.draft,
        params: {
          count: configBefore.editor.params.count,
          qualityTags: configBefore.editor.params.qualityTags,
          ucPreset: configBefore.editor.params.ucPreset,
          steps: configBefore.editor.params.steps,
          scale: configBefore.editor.params.scale,
          seed: configBefore.editor.params.seed,
        },
      },
    })
    await act('ui_edit_workspace_config', { config_action: 'save' })
    assert.deepEqual(
      await js(
        `(()=>{const r=document.querySelector('.pw-execution').getBoundingClientRect();return [r.y,r.height]})()`,
      ),
      configBounds,
      'editing does not displace footer',
    )
    await act('ui_view_workspace', { pane: 'canvas' })
    console.log(
      'PASS config MCP begin/update/save/cancel, manual editable controls, immutable recipe, ownership and stale-token protection, fixed footer',
    )
    assert.ok(
      stages.some(
        (s) =>
          s.frontend.stage === '已填写新建项目表单' && s.blockers.includes('正在新建工作台项目'),
      ),
    )
    const stale = front.token
    await js(
      `(()=>{const e=document.querySelector('.pw-compose textarea');e.value='保留我的输入';e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    )
    await assert.rejects(
      a.tool('ui_set_workspace_input', { id: frontId, expected_token: stale, text: '错误覆盖' }),
      /已变化/,
    )
    await ui(`document.querySelector('.pw-compose textarea').value==='保留我的输入'`)
    front = await act('ui_set_workspace_input', { text: '把天空改成蓝色' })
    assert.equal(front.workspace.composer, '把天空改成蓝色')
    assert.equal(aiStarted, 0)
    settings.saveSettings({ mcpAllowAi: false })
    await assert.rejects(act('ui_send_workspace_message'), /允许|权限/)
    settings.saveSettings({ mcpAllowAi: true })
    holdAi = true
    const chatting = act('ui_send_workspace_message').then(
      () => null,
      (e) => e,
    )
    await wait(() => aiStarted === 1)
    const during = (await b.data('get_app_state')).desktop
    assert.equal(during.frontend.status, 'running')
    assert.ok(
      await js(
        `document.querySelector('.topbar .agent-operating')?.textContent.includes('外部 Agent 正在操作')`,
      ),
    )
    const busyContentTop = await js(
      `document.querySelector('.content').getBoundingClientRect().top`,
    )
    const busyShot = await b.tool('ui_capture_app')
    assert.equal(
      busyShot.structuredContent.desktop.frontend.status,
      'running',
      'capture is not blocked behind AI command queue',
    )
    assert.equal(busyShot.structuredContent.desktop.workspace.id, frontId)
    await ui(`document.querySelector('.pw-shell').textContent.includes('把天空改成蓝色')`)
    await assert.rejects(
      b.tool('ui_view_workspace', { id: frontId, expected_token: during.token, pane: 'prompt' }),
      /前台操作/,
    )
    await assert.rejects(
      b.tool('propose_workspace_edit', {
        id: frontId,
        revision: pages.readPage(frontId).revision,
        title: '并发覆盖',
        draft: { base: 'wrong', negative: '', characters: [] },
      }),
      /前台操作/,
    )
    await js('window.api.cancelFrontend()')
    await wait(() => !desktop.state?.frontend || desktop.state.frontend.status !== 'running')
    assert.equal(
      await js(`document.querySelector('.content').getBoundingClientRect().top`),
      busyContentTop,
      'Agent state never adds a layout row',
    )
    assert.match(String(await chatting), /取消|停止|cancel/)
    assert.ok(
      tasks
        .snapshot()
        .tasks.some(
          (t) => t.kind === 'page-chat' && t.origin === 'agent' && t.status === 'cancelled',
        ),
    )
    holdAi = false
    await act('ui_set_workspace_input', { text: '把天空改成蓝色' })
    front = await act('ui_send_workspace_message')
    assert.notEqual(front.workspace.pane, 'suggestions')
    assert.equal(front.workspace.focusedProposalId, front.workspace.latestProposal.id)
    assert.equal(front.workspace.latestProposal.status, 'pending')
    const messageId = front.workspace.latestProposal.id
    for (const decision of ['accept', 'undo']) {
      front = await act('ui_review_workspace', { message_id: messageId, decision })
      assert.equal(
        front.workspace.latestProposal.status,
        { accept: 'accepted', undo: 'withdrawn', reject: 'rejected' }[decision],
      )
      if (decision === 'accept') {
        await act('ui_edit_workspace_config', { config_action: 'save' })
      }
    }
    await act('ui_set_workspace_input', { text: '重新给出蓝色天空方案' })
    front = await act('ui_send_workspace_message')
    front = await act('ui_review_workspace', {
      message_id: front.workspace.latestProposal.id,
      decision: 'accept',
    })
    await act('ui_edit_workspace_config', { config_action: 'save' })
    await act('ui_view_workspace', { pane: 'prompt' })
    await ui(`document.querySelector('.pw-shell').textContent.includes('blue sky')`)
    settings.saveSettings({ mcpAllowGenerate: false })
    await assert.rejects(
      act('ui_generate_workspace', { kind: 'generate', confirm: true }),
      /允许|权限/,
    )
    settings.saveSettings({ mcpAllowGenerate: true })
    const countBeforeDenied = generationInputs.length
    freeTier = false
    settings.saveSettings({ naiFreeOnly: false })
    await assert.rejects(act('ui_generate_workspace', { kind: 'generate', confirm: true }), /免费/)
    assert.equal(
      generationInputs.length,
      countBeforeDenied,
      'foreground forces free check even with manual paid setting',
    )
    freeTier = true
    settings.saveSettings({ naiFreeOnly: true })
    const generationIntent = {
      id: frontId,
      expected_token: (await a.data('get_app_state')).desktop.token,
      kind: 'generate',
      confirm: true,
      operation_id: 'desktop-generate-once-0001',
    }
    front = await a.data('ui_generate_workspace', generationIntent)
    const generatedCount = generationInputs.length
    const repeatedGeneration = await b.data('ui_generate_workspace', generationIntent)
    assert.equal(repeatedGeneration.operation.replayed, true)
    assert.equal(
      generationInputs.length,
      generatedCount,
      'cached frontend generation must not call provider again despite stale token and different connection',
    )
    assert.notEqual(front.workspace.versionId, firstVersion)
    assert.equal(front.workspace.historyOpen, true)
    const generatedVersion = front.workspace.versionId
    const beforeRegion = pages.readPage(frontId).versions.find((v) => v.id === generatedVersion)
    const originalPng = PNG.sync.read(readFileSync(client.imagePath(beforeRegion.image.name)))
    const regionPromise = act('ui_add_workspace_region', {
      rectangles: [{ x: 20, y: 30, width: 40, height: 50 }],
      instruction: '仅修改这里的颜色',
      // Keep the reviewed step visible until the real screenshot finishes encoding.
      step_delay_ms: 2000,
    })
    await wait(() => desktop.state?.frontend?.stage === '已填写区域批注')
    await ui(
      `!!document.querySelector('.ip-dialog')&&document.querySelector('.ip-dialog').textContent.includes('区域')`,
    )
    const editorShot = await b.tool('ui_capture_app')
    assert.equal(editorShot.structuredContent.desktop.workspace.editing, true)
    assert.ok(editorShot.content.some((c) => c.type === 'image'))
    writeFileSync(
      join(profile, 'frontend-region.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    front = await regionPromise
    assert.equal(front.workspace.regions.length, 1)
    assert.equal(front.workspace.regions[0].instruction, '仅修改这里的颜色')
    // A visible window runs the real leave transition before removing the dialog.
    await ui('!document.querySelector(".ip-dialog")')
    const regionId = front.workspace.regionId
    const savedRegion = pages.readPage(frontId).versions.find((v) => v.id === generatedVersion)
      .editor.regions[0]
    const savedMask = PNG.sync.read(Buffer.from(savedRegion.mask, 'base64'))
    assert.equal([...savedMask.data].filter((x, i) => i % 4 === 0 && x > 0).length, 40 * 50)
    front = await act('ui_add_workspace_region', {
      rectangles: [{ x: 80, y: 90, width: 20, height: 20 }],
      instruction: '第二个区域',
    })
    assert.equal(front.workspace.regions.length, 2)
    // Existing-region UI edits must be visible, cancellable, and isolated from autosave.
    const regionSnapshot = () =>
      structuredClone(
        pages.readPage(frontId).versions.find((v) => v.id === generatedVersion).editor.regions,
      )
    const twoRegions = regionSnapshot()
    const secondRegionId = twoRegions[1].id
    const frontRegionArgs = { version_id: generatedVersion, region_id: secondRegionId }
    const stoppedOpening = act('ui_update_workspace_region', {
      ...frontRegionArgs,
      instruction: '未开始的修改',
      step_delay_ms: 1200,
    }).then(
      () => null,
      (e) => e,
    )
    await wait(() => desktop.state?.frontend?.stage === '已打开原图选区编辑器')
    await js('window.api.cancelFrontend()')
    assert.match(String(await stoppedOpening), /停止/)
    assert.deepEqual(regionSnapshot(), twoRegions)
    await ui('!document.querySelector(".ip-dialog")')
    front = await act('ui_update_workspace_region', {
      ...frontRegionArgs,
      instruction: '更新第二个区域',
      target: null,
    })
    assert.equal(front.workspace.regionId, secondRegionId)
    assert.equal(regionSnapshot()[1].instruction, '更新第二个区域')
    assert.equal(regionSnapshot()[1].mask, twoRegions[1].mask, 'metadata-only edits preserve mask')
    assert.deepEqual(regionSnapshot()[0], twoRegions[0], 'other regions remain unchanged')
    front = await act('ui_update_workspace_region', {
      ...frontRegionArgs,
      rectangles: [{ x: 100, y: 110, width: 10, height: 15 }],
    })
    const replaced = regionSnapshot()[1]
    const replacedMask = PNG.sync.read(Buffer.from(replaced.mask, 'base64'))
    assert.equal(replaced.id, secondRegionId)
    assert.equal(replaced.instruction, '更新第二个区域')
    assert.equal([...replacedMask.data].filter((x, i) => i % 4 === 0 && x > 0).length, 150)
    assert.ok(replacedMask.data[(110 * replacedMask.width + 100) * 4])
    assert.equal(replacedMask.data[(90 * replacedMask.width + 80) * 4], 0)
    const unchanged = regionSnapshot()
    await assert.rejects(
      act('ui_update_workspace_region', {
        ...frontRegionArgs,
        version_id: firstVersion,
        instruction: '不应写入',
      }),
      /已采用/,
    )
    await assert.rejects(
      act('ui_update_workspace_region', {
        ...frontRegionArgs,
        region_id: 'missing',
        instruction: '不应写入',
      }),
      /不存在/,
    )
    await assert.rejects(
      act('ui_update_workspace_region', {
        ...frontRegionArgs,
        rectangles: [{ x: 99999, y: 0, width: 1, height: 1 }],
      }),
      /边界/,
    )
    await assert.rejects(
      act('ui_update_workspace_region', { ...frontRegionArgs, target: 99 }),
      /角色/,
    )
    await assert.rejects(
      act('ui_delete_workspace_region', { ...frontRegionArgs, confirm: false }),
      /授权/,
    )
    const cancelledRegion = act('ui_update_workspace_region', {
      ...frontRegionArgs,
      instruction: '取消的批注',
      step_delay_ms: 1500,
    }).then(
      () => null,
      (e) => e,
    )
    await wait(() => desktop.state?.frontend?.stage === '区域批注已更新，尚未保存')
    await pause(1000) // Exceeds the normal 800 ms autosave delay.
    assert.deepEqual(regionSnapshot(), unchanged, 'visible preview must not autosave before commit')
    await js('window.api.cancelFrontend()')
    assert.match(String(await cancelledRegion), /停止/)
    assert.deepEqual(regionSnapshot(), unchanged)
    await ui('!document.querySelector(".ip-dialog")')
    const cancelledDeletion = act('ui_delete_workspace_region', {
      ...frontRegionArgs,
      confirm: true,
      step_delay_ms: 1200,
    }).then(
      () => null,
      (e) => e,
    )
    await wait(() => desktop.state?.frontend?.stage?.startsWith('即将删除区域'))
    await js('window.api.cancelFrontend()')
    assert.match(String(await cancelledDeletion), /停止/)
    assert.deepEqual(regionSnapshot(), unchanged)
    front = await act('ui_delete_workspace_region', { ...frontRegionArgs, confirm: true })
    assert.equal(front.workspace.regionId, null)
    assert.deepEqual(regionSnapshot(), [twoRegions[0]])
    await ui('!document.querySelector(".ip-dialog")')
    console.log(
      'PASS visible existing-region update/delete, stable IDs, mask preservation/replacement, invalid targets and cancellation beyond autosave delay',
    )
    front = await act('ui_generate_workspace', {
      kind: 'inpaint',
      region_id: regionId,
      confirm: true,
    })
    assert.equal(generationInputs.at(-1).action, 'infill')
    assert.equal(front.workspace.versionId, generatedVersion)
    assert.notEqual(front.workspace.viewedVersionId, generatedVersion)
    const resultPage = pages.readPage(frontId)
    const resultVersion = resultPage.versions.find(
      (v) => v.id === resultPage.latestGeneratedVersionId,
    )
    const outputPng = PNG.sync.read(readFileSync(client.imagePath(resultVersion.image.name)))
    let changed = 0
    for (let i = 0; i < originalPng.data.length; i += 4) {
      if (!savedMask.data[i]) {
        assert.ok(originalPng.data.subarray(i, i + 4).equals(outputPng.data.subarray(i, i + 4)))
      } else if (!originalPng.data.subarray(i, i + 4).equals(outputPng.data.subarray(i, i + 4))) {
        changed++
      }
    }
    assert.ok(changed > 0)
    front = await act('ui_view_workspace', { pane: 'history', version_id: firstVersion })
    assert.equal(front.workspace.viewedVersionId, firstVersion)
    assert.notEqual(front.workspace.versionId, firstVersion)
    front = await act('ui_review_workspace', { decision: 'switch', version_id: generatedVersion })
    assert.equal(front.workspace.versionId, generatedVersion)
    await act('ui_view_workspace', { pane: 'changes' })
    writeFileSync(
      join(profile, 'frontend-complete.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    await act('ui_set_workspace_input', { text: '再给一个建议，先不采用' })
    front = await act('ui_send_workspace_message')
    front = await act('ui_review_workspace', {
      decision: 'reject',
      message_id: front.workspace.latestProposal.id,
    })
    assert.equal(front.workspace.latestProposal.status, 'rejected')
    autoGenerate = false
    const countBeforeCancel = pages.readPage(frontId).versions.length
    const stoppedGeneration = act('ui_generate_workspace', {
      kind: 'generate',
      confirm: true,
    }).then(
      () => null,
      (e) => e,
    )
    await wait(() => pendingGeneration.length === 1)
    await js('window.api.cancelFrontend()')
    assert.equal(
      (await b.data('get_app_state')).desktop.frontend.status,
      'running',
      'current image must finish saving before UI unlocks',
    )
    pendingGeneration.shift()()
    assert.match(String(await stoppedGeneration), /停止/)
    assert.equal(
      pages.readPage(frontId).versions.length,
      countBeforeCancel + 1,
      'cancelled foreground generation preserves completed image',
    )
    assert.ok(stages.some((s) => s.frontend.stage === '已在原图上绘制遮罩'))
    console.log(
      'PASS foreground MCP workflows through real Vue handlers: visible form/input/chat/review/editor/masks/generation/history, permissions, stale state, cancellation, concurrency and unchanged pixels outside mask',
    )
    // External takeover uses the real MCP connection identity and renderer flow;
    // disabling the model key makes any accidental internal AI call fail the test.
    const aiBeforeExternal = aiStarted
    await act('ui_review_workspace', { decision: 'switch', version_id: generatedVersion })
    settings.saveSettings({ apiKey: '', mcpAllowAi: false })
    front = await act('ui_set_workspace_agent', { mode: 'external' })
    assert.equal(front.workspace.agentMode, 'external')
    assert.equal(front.workspace.agentConnected, true)
    for (const name of ['ui_update_workspace_region', 'ui_delete_workspace_region']) {
      const args = {
        id: frontId,
        expected_token: (await a.data('get_app_state')).desktop.token,
        version_id: generatedVersion,
        region_id: regionId,
        ...(name === 'ui_update_workspace_region'
          ? { instruction: '拒绝其他连接' }
          : { confirm: true }),
      }
      await assert.rejects(b.data(name, args), /未接管/)
    }
    // Version scope and comparison are independent of adoption, on every pane.
    const scopeRevision = pages.readPage(frontId).revision
    for (const pane of ['canvas', 'prompt', 'changes', 'images', 'suggestions']) {
      front = await act('ui_view_workspace', { pane, version_id: resultVersion.id })
      assert.equal(front.workspace.viewedVersionId, resultVersion.id)
      assert.equal(front.workspace.adoptedVersionId, generatedVersion)
      assert.equal(front.workspace.discussionVersionId, resultVersion.id)
      await assertExecutionBarAtBottom()
      assert.equal(
        await js(`document.querySelectorAll('.wi-timeline,[aria-label="建议所属版本"]').length`),
        0,
      )
      if (pane === 'prompt') {
        assert.equal(
          await js(`document.querySelector('.workspace-prompt textarea').readOnly`),
          true,
        )
      }
    }
    front = await act('ui_view_workspace', { pane: 'changes', compare_version_id: firstVersion })
    assert.equal(front.workspace.comparisonVersionId, firstVersion)
    assert.equal(front.workspace.viewedVersionId, resultVersion.id)
    assert.equal(front.workspace.adoptedVersionId, generatedVersion)
    assert.equal(front.workspace.comparisonMode, 'specified')
    const compared = await a.data('compare_workspace_versions', {
      id: frontId,
      version_id: resultVersion.id,
      compare_version_id: firstVersion,
    })
    assert.equal(compared.viewed.versionId, resultVersion.id)
    assert.equal(compared.comparison.versionId, firstVersion)
    assert.equal(compared.comparison.recipe.source, 'initial')
    assert.equal(
      pages.readPage(frontId).revision,
      scopeRevision,
      'view and comparison do not mutate workspaces',
    )
    await assert.rejects(
      act('ui_view_workspace', { pane: 'changes', compare_version_id: resultVersion.id }),
      /另一个有效/,
    )
    await act('ui_view_workspace', { pane: 'changes', compare_version_id: firstVersion })
    for (const [width, height] of [
      [1440, 900],
      [1100, 700],
    ]) {
      win.setSize(width, height)
      await pause(150)
      await assertExecutionBarAtBottom()
      await js(`(() => {
        const filler = document.createElement('div')
        filler.id = 'comparison-scroll-fixture'
        filler.style.height = '1400px'
        document.querySelector('.pw-change-board').append(filler)
      })()`)
      await js(`document.querySelector('.pw-change-board').scrollTop = 1400`)
      assert.ok(
        await js(`document.querySelector('.pw-change-board').scrollTop > 0`),
        'long comparisons scroll independently of execution controls',
      )
      await assertExecutionBarAtBottom()
      await js(`document.getElementById('comparison-scroll-fixture').remove()`)
      await js(`document.querySelector('.pw-change-board').scrollTop = 0`)
      assert.ok(
        await js(
          `(()=>{const r=document.querySelector('.wi-record').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`,
        ),
      )
      writeFileSync(
        join(profile, `version-comparison-${width}.png`),
        (await win.webContents.capturePage()).toPNG(),
      )
      await js(`document.querySelector('.pw-compare[role="combobox"]').click()`)
      await pause(180)
      assert.ok(
        await js(
          `(()=>{const m=document.querySelector('.theme-select-menu'),s=m.querySelector('.theme-select-options'),r=m.getBoundingClientRect(),q=s.getBoundingClientRect();return getComputedStyle(m).overflow==='hidden'&&q.top>r.top&&q.bottom<r.bottom&&r.left>=8&&r.right<=innerWidth-8})()`,
        ),
        'dropdown scroll area stays inside the rounded shell and viewport',
      )
      assert.ok(
        await js(
          `[...document.querySelectorAll('.theme-select-option>span:first-child')].every(e=>getComputedStyle(e).whiteSpace==='nowrap'&&e.scrollWidth<=e.clientWidth+1)`,
        ),
        'ordinary comparison labels fit on one line without truncation',
      )
      writeFileSync(
        join(profile, `comparison-dropdown-${width}.png`),
        (await win.webContents.capturePage()).toPNG(),
      )
      await js(
        `document.querySelector('.pw-compare[role="combobox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
      )
    }
    win.setSize(1440, 960)
    await act('ui_view_workspace', { pane: 'canvas', version_id: generatedVersion })
    // Backend parity: ownership, stale revisions, bounds and draft preservation.
    const rev = pages.readPage(frontId).revision
    const regionArgs = {
      id: frontId,
      revision: rev,
      version_id: generatedVersion,
      instruction: '后台测试批注',
      rectangles: [{ x: 5, y: 6, width: 10, height: 12 }],
    }
    await assert.rejects(b.data('add_workspace_region', regionArgs), /未接管/)
    await assert.rejects(
      a.data('add_workspace_region', { ...regionArgs, version_id: firstVersion }),
      /已采用/,
    )
    await assert.rejects(
      a.data('add_workspace_region', {
        ...regionArgs,
        rectangles: [{ x: 99999, y: 0, width: 1, height: 1 }],
      }),
      /原图内/,
    )
    const annotated = await a.data('add_workspace_region', regionArgs)
    assert.ok(annotated.addedRegionId)
    const backendRegion = pages
      .readPage(frontId)
      .versions.find((v) => v.id === generatedVersion)
      .editor.regions.at(-1)
    assert.equal(backendRegion.id, annotated.addedRegionId)
    const backendMask = PNG.sync.read(Buffer.from(backendRegion.mask, 'base64'))
    assert.equal(backendMask.data[(6 * backendMask.width + 5) * 4], 255)
    assert.equal(backendMask.data[0], 0)
    assert.equal(
      pages.readPage(frontId).versions.find((v) => v.id === generatedVersion).editor.regions.length,
      2,
    )
    await assert.rejects(a.data('add_workspace_region', regionArgs), /已变化/)
    await act('ui_set_workspace_input', { text: '保留未发送草稿' })
    await assert.rejects(
      a.data('submit_workspace_request', {
        id: frontId,
        revision: pages.readPage(frontId).revision,
        text: '不应覆盖',
      }),
      /未发送草稿/,
    )
    assert.equal(pages.readPage(frontId).composer, '保留未发送草稿')
    await act('ui_set_workspace_input', { text: '' })
    const requestArgs = {
      id: frontId,
      revision: pages.readPage(frontId).revision,
      text: '后台讨论历史候选',
      discussion_version_id: resultVersion.id,
      region_ids: [regionId, annotated.addedRegionId],
    }
    await assert.rejects(b.data('submit_workspace_request', requestArgs), /未接管/)
    const queued = await a.data('submit_workspace_request', requestArgs)
    const requestIndex = await a.data('list_workspace_requests')
    assert.ok(
      requestIndex.items.some(
        (r) => r.id === frontId && r.discussionVersionId === resultVersion.id && !r.stale,
      ),
    )
    await assert.rejects(
      a.data('submit_workspace_request', { ...requestArgs, revision: queued.revision }),
      /已有待处理/,
    )
    const backendContext = await a.data('get_workspace_context', { id: frontId })
    assert.ok(backendContext.skills.sections[0]?.text)
    assert.deepEqual(backendContext.request.regionIds, requestArgs.region_ids)
    assert.equal(backendContext.selectedRegions.length, 2)
    assert.equal(backendContext.discussion.versionId, resultVersion.id)
    await a.data('reply_workspace_request', {
      id: frontId,
      revision: backendContext.revision,
      response: { requestId: backendContext.request.id, reply: '后台纯讨论已完成。' },
    })
    assert.ok(!(await a.data('list_workspace_requests')).items.some((r) => r.id === frontId))
    assert.equal(aiStarted, aiBeforeExternal)
    console.log(
      'PASS version scope, historical read-only prompts, independent comparison, backend region/request/inbox and zero AI calls',
    )
    await assert.rejects(
      b.data('set_workspace_agent', {
        id: frontId,
        revision: pages.readPage(frontId).revision,
        mode: 'external',
      }),
      /另一个在线/,
    )
    await assert.rejects(
      b.data('set_workspace_agent', {
        id: frontId,
        revision: pages.readPage(frontId).revision,
        mode: 'internal',
      }),
      /另一个在线/,
    )
    await act('ui_set_workspace_input', {
      text: '外部 Agent 帮我检查当前区域，先讨论',
      region_id: regionId,
    })
    front = await act('ui_send_workspace_message')
    assert.ok(front.workspace.pendingRequestId)
    const tokenBeforeRead = (await a.data('get_app_state')).desktop.token
    await a.data('get_workspace', { id: frontId })
    assert.equal(
      (await a.data('get_app_state')).desktop.token,
      tokenBeforeRead,
      'read-only synchronization does not invalidate frontend tokens',
    )
    let context = await a.data('get_workspace_context', { id: frontId, skills_mode: 'full' })
    assert.ok(context.preview.preview_path)
    assert.ok(context.skills.sections[0]?.text)
    assert.equal(context.capabilities.strength.max, 1)
    const frozenSkills = context.skills.digest
    await assert.rejects(
      require('../../src/main/modules/workspace/collaboration.ts').discussPage(
        frontId,
        context.revision,
        '绕过接管',
        null,
        [],
      ),
      /外部 Agent/,
    )
    const pureReply = {
      requestId: context.request.id,
      reply: '外部 Agent 已读取选区。这是纯讨论，未生成图片。',
    }
    await assert.rejects(
      b.data('reply_workspace_request', {
        id: frontId,
        revision: context.revision,
        response: pureReply,
      }),
      /未接管/,
    )
    front = await act('ui_reply_workspace_request', { response: pureReply })
    assert.equal(front.workspace.pendingRequestId, null)
    assert.equal(pages.readPage(frontId).messages.at(-1).author.name, 'fixture-agent')
    await assert.rejects(act('ui_reply_workspace_request', { response: pureReply }), /已完成/)
    await act('ui_set_workspace_input', { text: '讨论正在查看的候选，不要采用' })
    await act('ui_view_workspace', { pane: 'canvas', version_id: resultVersion.id })
    front = await act('ui_send_workspace_message')
    assert.equal(front.workspace.versionId, generatedVersion)
    assert.equal(front.workspace.discussionVersionId, resultVersion.id)
    context = await a.data('get_workspace_context', { id: frontId })
    assert.equal(context.discussion.versionId, resultVersion.id)
    assert.equal(context.discussion.image.name, resultVersion.image.name)
    assert.equal(context.editTarget.versionId, generatedVersion)
    assert.equal(context.request.stale, false)
    const frozenDiscussion = structuredClone(context.discussion)
    await act('ui_view_workspace', { pane: 'prompt' })
    context = await a.data('get_workspace_context', { id: frontId })
    assert.deepEqual(
      context.discussion,
      frozenDiscussion,
      'changing the visible pane never retargets an already submitted request',
    )
    assert.equal(context.request.stale, false)
    front = await act('ui_reply_workspace_request', {
      response: { requestId: context.request.id, reply: '已查看候选，当前采用稿保持不变。' },
    })
    assert.deepEqual(pages.readPage(frontId).messages.at(-1).discussion, frozenDiscussion)
    assert.equal(front.workspace.versionId, generatedVersion)
    await act('ui_set_workspace_input', { text: '讨论图像失效检查' })
    await act('ui_view_workspace', { pane: 'canvas', version_id: resultVersion.id })
    await act('ui_send_workspace_message')
    const changedImagePage = pages.readPage(frontId)
    changedImagePage.versions.find((v) => v.id === resultVersion.id).image = null
    pages.savePage(changedImagePage)
    context = await a.data('get_workspace_context', { id: frontId })
    assert.equal(
      context.request.stale,
      true,
      'changed discussion image invalidates the request even when the edit target is unchanged',
    )
    await assert.rejects(
      a.data('reply_workspace_request', {
        id: frontId,
        revision: context.revision,
        response: { requestId: context.request.id, reply: '不应写回' },
      }),
      /需求发出后/,
    )
    await act('ui_cancel_workspace_request')
    const restoredImagePage = pages.readPage(frontId)
    restoredImagePage.versions.find((v) => v.id === resultVersion.id).image = resultVersion.image
    pages.savePage(restoredImagePage)
    await a.data('get_workspace', { id: frontId })
    console.log(
      'PASS frozen discussion images and recipes, independent edit target, pane changes, external replies and stale-image rejection',
    )
    front = await act('ui_add_workspace_region', {
      rectangles: [{ x: 80, y: 90, width: 20, height: 20 }],
      instruction: '修正第二处，同时保持其他地方',
    })
    const jointRegionId = front.workspace.regionId
    const jointIds = [regionId, jointRegionId]
    front = await act('ui_set_workspace_input', {
      text: '外部方案：一起调整两处选区，保留画面其余部分',
      region_ids: jointIds,
    })
    assert.deepEqual(front.workspace.regionIds, jointIds)
    assert.equal(
      await js(`document.querySelectorAll('.pw-region-checklist input:checked').length`),
      2,
    )
    await js(`document.querySelector('.pw-region-checklist button').click()`)
    await ui(`!!document.querySelector('.pw-overlay')`)
    await pause(400)
    await win.webContents.capturePage()
    writeFileSync(
      join(profile, 'multi-region-discussion.png'),
      (await win.webContents.capturePage()).toPNG(),
    )

    await act('ui_send_workspace_message')
    context = await a.data('get_workspace_context', { id: frontId })
    assert.equal(context.skills.digest, frozenSkills)
    assert.deepEqual(context.request.regionIds, jointIds)
    assert.deepEqual(
      context.selectedRegions.map((region) => region.id),
      jointIds,
    )
    assert.ok(context.selectedRegions.every((region) => region.preview))
    const externalDraft = { ...context.draft, base: context.draft.base + ', soft light' }
    const extResponse = {
      requestId: context.request.id,
      reply: '已提出选区修改建议，尚未执行。',
      proposal: {
        title: '外部区域方案',
        warning: '仅选区内允许变化。',
        draft: externalDraft,
        execution: { kind: 'inpaint', regionId, regionIds: jointIds },
      },
    }
    await assert.rejects(
      a.data('reply_workspace_request', {
        id: frontId,
        revision: context.revision,
        response: {
          ...extResponse,
          proposal: { ...extResponse.proposal, execution: { kind: 'inpaint', regionId } },
        },
      }),
      /全部区域/,
    )
    front = await act('ui_reply_workspace_request', { response: extResponse })
    const externalProposalId = front.workspace.latestProposal.id
    assert.notEqual(front.workspace.pane, 'suggestions')
    assert.equal(front.workspace.focusedProposalId, front.workspace.latestProposal.id)
    const stored = pages.readPage(frontId).messages.find((m) => m.id === externalProposalId)
    assert.equal(stored.proposal.regionId, regionId)
    assert.deepEqual(stored.proposal.regionIds, jointIds)
    assert.equal(stored.proposal.status, 'pending')
    front = await act('ui_review_workspace', { message_id: externalProposalId, decision: 'accept' })
    await act('ui_edit_workspace_config', { config_action: 'save' })
    assert.equal(pages.readPage(frontId).execution.kind, 'inpaint')
    assert.deepEqual(pages.readPage(frontId).execution.regionIds, jointIds)
    await click('.pw-execution button', '查看范围')
    await pause(400)
    await win.webContents.capturePage()
    writeFileSync(
      join(profile, 'multi-region-execution.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    autoGenerate = true
    front = await act('ui_generate_workspace', {
      kind: 'inpaint',
      region_ids: jointIds,
      confirm: true,
    })
    autoGenerate = false
    const unionResult = pages
      .readPage(frontId)
      .versions.find((version) => version.id === pages.readPage(frontId).latestGeneratedVersionId)
    assert.deepEqual(unionResult.generated.execution.regionIds, jointIds)
    assert.deepEqual(
      unionResult.generated.inpaint.regions.map((region) => region.id),
      jointIds,
    )
    front = await act('ui_review_workspace', { message_id: externalProposalId, decision: 'undo' })
    extResponse.proposal.execution = { kind: 'inpaint', regionId }
    console.log(
      'PASS visible multi-region checklist, MCP previews, omitted-scope rejection, joint proposal, union generation and undo',
    )
    await act('ui_set_workspace_input', { text: '再次讨论，不生成', region_id: regionId })
    await act('ui_send_workspace_message')
    context = await a.data('get_workspace_context', { id: frontId })
    await a.data('reply_workspace_request', {
      id: frontId,
      revision: context.revision,
      response: { ...extResponse, requestId: context.request.id },
    })
    const retained = pages
      .readPage(frontId)
      .messages.find((m) => m.id === externalProposalId).proposal
    assert.ok(retained.superseded)
    assert.deepEqual(retained.after, externalDraft)
    await act('ui_review_workspace', { message_id: externalProposalId, decision: 'undo' }).catch(
      () => {},
    )
    await ui(`document.querySelector('.pw-thread').textContent.includes('外部区域方案')`)
    await act('ui_set_workspace_input', { text: '准备取消的需求' })
    await act('ui_send_workspace_message')
    context = await a.data('get_workspace_context', { id: frontId })
    await act('ui_cancel_workspace_request')
    await assert.rejects(
      act('ui_reply_workspace_request', {
        response: { requestId: context.request.id, reply: '不应写入' },
      }),
      /已取消/,
    )
    await act('ui_set_workspace_input', { text: '上下文冲突测试' })
    await act('ui_send_workspace_message')
    context = await a.data('get_workspace_context', { id: frontId })
    const changedPage = pages.readPage(frontId)
    pages.editPage(frontId, changedPage.revision, {
      type: 'notes',
      title: changedPage.title,
      goal: '用户已改变目标',
      preserve: changedPage.preserve,
      composer: '',
    })
    await assert.rejects(
      a.data('reply_workspace_request', {
        id: frontId,
        revision: pages.readPage(frontId).revision,
        response: { requestId: context.request.id, reply: '旧上下文' },
      }),
      /需求发出后/,
    )
    await a.data('get_workspace', { id: frontId })
    await ui(`document.querySelector('.pw-agent-mode').textContent.includes('等待 Agent 处理')`)
    a.child.stdin.end()
    await ui(`document.querySelector('.pw-agent-mode').textContent.includes('连接已断开')`)
    const fresh = (await b.data('get_app_state')).desktop
    await b.data('ui_set_workspace_agent', {
      id: frontId,
      expected_token: fresh.token,
      mode: 'external',
    })
    await b.data('cancel_workspace_request', {
      id: frontId,
      revision: pages.readPage(frontId).revision,
    })
    assert.equal(pages.readPage(frontId).agentMode, 'external')
    assert.equal(
      aiStarted,
      aiBeforeExternal,
      'external discussion, proposals, cancellation and reconnect never invoke internal AI',
    )
    writeFileSync(
      join(profile, 'external-agent.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    console.log(
      'PASS external takeover without AI key: live connection ownership, pure replies, region proposals, frozen Skills, full proposal history, cancellation, duplicates, stale context and reconnect; zero internal AI calls',
    )

    // Lifecycle and contract regressions, through the same real MCP transport.
    const schemaTools = (await b.request('tools/list')).result.tools
    assert.ok(schemaTools.every((t) => t.outputSchema?.type === 'object'))
    const skillEntry = await b.data('get_skill', { id: 'builtin:prompt' })
    assert.equal(skillEntry.id, 'builtin:prompt')
    assert.equal(typeof skillEntry.name, 'string')
    assert.ok(skillEntry.content.includes('source#'))
    assert.ok(skillEntry.content.includes('NAI 官方 UC 预设'))
    const skillReference = await b.data('get_skill', {
      id: 'builtin:prompt',
      resource: 'references/examples.md',
    })
    assert.equal(skillReference.id, 'builtin:prompt')
    assert.equal(skillReference.path, 'references/examples.md')
    assert.ok(skillReference.content.includes('source#'))
    assert.ok((await b.tool('get_skill', { id: 'core' })).content[0].text.includes('Skill'))
    await assert.rejects(
      b.data('get_skill', { id: 'builtin:prompt', resource: 'references/missing.md' }),
      /未找到/,
    )
    const malformed = await b.request('tools/call', {
      name: 'tag_wiki',
      arguments: { tag: 'smile' },
    })
    assert.equal(malformed.result.isError, true)
    assert.equal(malformed.result.structuredContent.error.code, 'INVALID_ARGUMENTS')
    assert.equal(
      (await b.data('cancel_task', { id: 'missing-fixture-task' })).cancellation,
      'not_found',
    )
    const skill = await b.data('create_skill', {
      name: 'Lifecycle fixture',
      content: 'Fixture only',
      enabled: false,
    })
    assert.ok(skill.id)
    assert.equal(skill.outcome, 'created')
    assert.equal(
      (await b.data('update_skill', { id: skill.id, content: 'Updated fixture' })).outcome,
      'updated',
    )
    await b.data('delete_skill', { id: skill.id })
    const beforeCreate = (await b.data('get_app_state')).desktop
    let managed = await b.data('create_workspace', {
      title: '管理测试',
      draft: { base: 'cat', negative: '', characters: [] },
    })
    assert.equal(
      (await b.data('get_app_state')).desktop.workspace.id,
      beforeCreate.workspace.id,
      'default creation stays in background',
    )
    const initialRecipe = (
      await b.data('get_workspace', {
        id: managed.id,
        detail: 'full',
        version_ids: [managed.currentVersionId],
      })
    ).versions[0].initial
    await assert.rejects(
      b.data('update_workspace', {
        id: managed.id,
        revision: managed.revision - 1,
        title: 'stale',
      }),
      /变化/,
    )
    managed = await b.data('update_workspace', {
      id: managed.id,
      revision: managed.revision,
      title: '后台重命名',
    })
    managed = await b.data('update_workspace', {
      id: managed.id,
      revision: managed.revision,
      version_id: managed.currentVersionId,
      patch: { params: { steps: 22, scale: 4.5 }, draft: { base: 'cat, outdoors' } },
    })
    const editedConfig = (
      await b.data('get_workspace', {
        id: managed.id,
        detail: 'full',
        version_ids: [managed.currentVersionId],
      })
    ).versions[0]
    assert.equal(editedConfig.editor.params.steps, 22)
    assert.deepEqual(
      editedConfig.initial,
      initialRecipe,
      'editing never rewrites the original snapshot',
    )
    const invalidRev = managed.revision
    await assert.rejects(
      b.data('update_workspace', {
        id: managed.id,
        revision: managed.revision,
        version_id: managed.currentVersionId,
        patch: { params: { steps: 0 } },
      }),
      /参数/,
    )
    assert.equal(pages.readPage(managed.id).revision, invalidRev)
    managed = await b.data('set_workspace_agent', {
      id: managed.id,
      revision: managed.revision,
      mode: 'external',
    })
    managed = await b.data('submit_workspace_request', {
      id: managed.id,
      revision: managed.revision,
      text: '缓存测试',
    })
    const fullContext = await b.data('get_workspace_context', {
      id: managed.id,
      skills_mode: 'full',
    })
    await b.data('ui_open_workspace', { id: managed.id, step_delay_ms: 0 })
    const reported = await b.data('report_workspace_progress', {
      id: managed.id,
      revision: managed.revision,
      request_id: fullContext.request.id,
      phase: 'processing',
      message: '正在核对图片与提示词',
    })
    assert.ok(reported.activity.expiresAt > Date.now())
    await ui(`document.querySelector('.pw-agent-mode').textContent.includes('Agent 正在处理')`)
    assert.equal(
      (await b.data('get_workspace_context', { id: managed.id })).processing.state,
      'processing',
    )
    const sessionHelpers = require('../../src/main/modules/workspace/agent-sessions.ts')
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 120001
      assert.equal(
        sessionHelpers.agentActivity(
          managed.externalAgent.sessionId,
          managed.id,
          fullContext.request.id,
        ),
        null,
      )
      assert.equal(
        sessionHelpers
          .agentConnections()
          .find((a) => a.sessionId === managed.externalAgent.sessionId).activity.length,
        0,
      )
    } finally {
      Date.now = realNow
    }
    await b.data('report_workspace_progress', {
      id: managed.id,
      revision: managed.revision,
      request_id: fullContext.request.id,
      phase: 'waiting',
    })
    await ui(`document.querySelector('.pw-agent-mode').textContent.includes('等待 Agent 处理')`)
    const cachedContext = await b.data('get_workspace_context', {
      id: managed.id,
      skills_digests: Object.fromEntries(fullContext.skills.sections.map((s) => [s.id, s.digest])),
    })
    assert.equal(cachedContext.skills.bodiesNotModified, true)
    assert.equal(cachedContext.skills.sections[0]?.text, undefined)
    assert.ok(
      (await b.data('get_workspace_context', { id: managed.id, skills_digests: {} })).skills
        .sections[0]?.text,
    )
    managed = await b.data('cancel_workspace_request', {
      id: managed.id,
      revision: managed.revision,
    })
    await assert.rejects(
      b.data('report_workspace_progress', {
        id: managed.id,
        revision: managed.revision,
        request_id: fullContext.request.id,
        phase: 'processing',
      }),
      /已完成|已取消/,
    )
    const firstHistory = await b.data('get_workspace', { id: managed.id, message_limit: 2 })
    assert.equal(firstHistory.messages.length, 2)
    assert.ok(firstHistory.history.hasMore)
    const oldHistory = await b.data('get_workspace', {
      id: managed.id,
      message_limit: 2,
      before_message_id: firstHistory.history.nextBeforeMessageId,
      history_revision: firstHistory.history.revision,
    })
    assert.ok(oldHistory.messages.every((m) => !firstHistory.messages.some((n) => n.id === m.id)))
    assert.equal(
      (await b.data('get_workspace', { id: managed.id, since_revision: managed.revision }))
        .notModified,
      true,
    )
    managed = await b.data('set_workspace_agent', {
      id: managed.id,
      revision: managed.revision,
      mode: 'internal',
    })
    let manageUi = await b.data('ui_open_workspace', { id: managed.id, step_delay_ms: 0 })
    const manageAct = async (name, args = {}) => {
      manageUi = await b.data(name, {
        id: managed.id,
        expected_token: manageUi.token,
        step_delay_ms: 0,
        ...args,
      })
      return manageUi
    }
    await manageAct('ui_rename_workspace', { title: '前台重命名' })
    assert.equal(manageUi.workspace.title, '前台重命名')
    assert.equal(manageUi.workspace.editing, false)
    await manageAct('ui_delete_workspace', { confirm: true })
    assert.equal(manageUi.workspace, null)
    assert.ok(!pages.listPages().some((w) => w.id === managed.id))

    const library = require('../../src/main/modules/images/library.ts')
    const params = {
      width: 64,
      height: 64,
      steps: 1,
      scale: 5,
      cfgRescale: 0,
      sampler: 'k_euler',
      noiseSchedule: 'native',
      seed: 1,
      count: 1,
      qualityTags: false,
      ucPreset: 'none',
    }
    const fixtureDraft = { base: 'cat', negative: '', characters: [] }
    const fixturePng = new PNG({ width: 64, height: 64 })
    fixturePng.data.fill(255)
    const fixtureRecipe = {
      schema: 1,
      request: { ...fixtureDraft, version: 'v5', params },
      sourceKind: 'generate',
    }
    const source = library.storeGeneratedImage(
      PNG.sync.write(fixturePng),
      fixtureRecipe,
      'temporary',
    )
    managed = await b.data('create_workspace', {
      title: '图片管理',
      draft: fixtureDraft,
      image_name: source.name,
    })
    const owned = managed.versions[0].image.name
    const added = await b.data('add_workspace_region', {
      id: managed.id,
      revision: managed.revision,
      version_id: managed.currentVersionId,
      instruction: '原区域',
      rectangles: [{ x: 0, y: 0, width: 12, height: 12 }],
    })
    managed = await b.data('update_workspace_region', {
      id: managed.id,
      revision: added.revision,
      version_id: managed.currentVersionId,
      region_id: added.addedRegionId,
      action: 'update',
      instruction: '更新批注',
      rectangles: [{ x: 10, y: 10, width: 16, height: 16 }],
    })
    assert.equal(
      (
        await b.data('get_workspace', {
          id: managed.id,
          detail: 'full',
          version_ids: [managed.currentVersionId],
        })
      ).versions[0].editor.regions[0].instruction,
      '更新批注',
    )
    await assert.rejects(
      b.data('update_workspace', {
        id: managed.id,
        revision: managed.revision,
        version_id: managed.currentVersionId,
        patch: { params: { width: 128 } },
      }),
      /尺寸/,
    )
    managed = await b.data('update_workspace_region', {
      id: managed.id,
      revision: managed.revision,
      version_id: managed.currentVersionId,
      region_id: added.addedRegionId,
      action: 'delete',
      confirm: true,
    })
    assert.equal(managed.versions[0].regionCount, 0)
    await assert.rejects(b.data('delete_image', { name: owned, confirm: true }), /引用/)
    let shared = await b.data('create_workspace', { title: '共享保护', draft: fixtureDraft })
    const sharedDoc = pages.readPage(shared.id)
    sharedDoc.versions[0].image = { ...managed.versions[0].image }
    pages.savePage(sharedDoc)
    managed = await b.data('delete_workspace_image', {
      id: managed.id,
      revision: managed.revision,
      version_id: managed.currentVersionId,
      confirm: true,
    })
    assert.equal(managed.versions[0].image, null)
    assert.ok(client.imagePath(owned), 'shared file survives')
    await b.data('delete_workspace', { id: managed.id, revision: managed.revision, confirm: true })
    assert.ok(client.imagePath(owned))
    managed = await b.data('get_workspace', { id: shared.id })
    manageUi = await b.data('ui_open_workspace', { id: managed.id, step_delay_ms: 0 })
    await manageAct('ui_delete_workspace_image', {
      version_id: managed.currentVersionId,
      confirm: true,
    })
    assert.equal(manageUi.workspace.image, null)
    assert.equal(client.imagePath(owned), null)
    assert.ok(pages.readPage(managed.id).messages.length)
    const openBeforeDelete = (await b.data('get_app_state')).desktop.workspace.id
    await b.data('delete_workspace', {
      id: managed.id,
      revision: pages.readPage(managed.id).revision,
      confirm: true,
    })
    assert.equal(openBeforeDelete, managed.id)
    assert.equal(
      (await b.data('get_app_state')).desktop.workspace,
      null,
      'deleting open project closes its stale view',
    )
    const page1 = await b.data('list_images', { limit: 1, storage: 'temporary' })
    assert.equal(page1.items.length, 1)
    if (page1.hasMore) {
      const page2 = await b.data('list_images', {
        limit: 1,
        storage: 'temporary',
        before_name: page1.nextBeforeName,
      })
      assert.notEqual(page2.items[0].name, page1.items[0].name)
    }
    const originalPath = client.imagePath(source.name)
    assert.equal(
      (await b.data('delete_image', { name: source.name, confirm: true })).outcome,
      'deleted',
    )
    assert.equal(existsSync(originalPath + '.json'), false)
    assert.equal(
      (await b.data('delete_image', { name: source.name, confirm: true })).outcome,
      'not_found',
    )
    console.log(
      'PASS structured contracts/errors, default background creation, config guards, cached Skills, history/gallery pagination, frontend rename/delete, shared-image protection and gallery recipe cleanup',
    )

    await b.data('navigate_app', { tab: 'settings' })
    await ui(`document.querySelector('#mcp-scope[role="combobox"]') !== null`)
    await js(`document.querySelector('#mcp-scope').scrollIntoView({block: 'center'})`)
    await pause(200)
    await js(`document.querySelector('#mcp-scope').click()`)
    await ui(`document.querySelectorAll('.theme-select-option').length === 5`)
    await pause(200)
    writeFileSync(
      join(profile, 'settings-scope-dropdown.png'),
      (await win.webContents.capturePage()).toPNG(),
    )
    await click('.theme-select-option', '标签与提示词')
    await ui(
      `[...document.querySelectorAll('.code-box pre')].filter(e=>e.textContent.includes('NOVELPROMPT_MCP_GROUPS')&&e.textContent.includes('tags,skills')).length===3`,
    )
    assert.ok(
      await js(
        `[...document.querySelectorAll('.code-box pre')].every(e=>!e.textContent.includes('NOVELPROMPT_MCP_GROUPS')||e.textContent.includes(${JSON.stringify(profile.replaceAll('\\', '\\\\'))})||e.textContent.includes(${JSON.stringify(profile)}))`,
      ),
      'selected scopes preserve the configured data directory',
    )
    await js(`(() => {
      const scope = document.querySelector('#mcp-scope')
      scope.focus()
      for (const key of ['ArrowDown', 'End', 'Enter']) {
        scope.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}))
      }
    })()`)
    await ui(
      `[...document.querySelectorAll('.code-box pre')].filter(e=>e.textContent.includes('NOVELPROMPT_MCP_GROUPS')&&e.textContent.includes('core')).length===3`,
    )
    assert.equal(await js(`document.activeElement.id`), 'mcp-scope')
    await js(`document.querySelector('details.manual summary').click()`)
    await pause(250)
    assert.ok(await js(`document.querySelector('details.manual').open`))
    assert.ok(
      await js(
        `document.querySelector('details.manual .code-box').getBoundingClientRect().height > 0`,
      ),
      'expanded configuration remains visible after disclosure animation',
    )
    await js(`document.querySelector('details.manual summary').click()`)
    await pause(250)
    assert.equal(await js(`document.querySelector('details.manual').open`), false)
    console.log(
      'PASS settings scope mouse/keyboard selection updates automatic, TOML and JSON configurations; native disclosures open and close',
    )

    console.log('Artifacts:', profile)
    for (const c of clients) {
      c.child.stdin.end()
    }
    await pause(100)
    bridge.close()
    app.exit(0)
  } catch (e) {
    console.error(e)
    if (win && win.webContents.getURL()) {
      writeFileSync(
        join(profile, 'failure.txt'),
        await win.webContents.executeJavaScript('document.body.innerText'),
      )
      writeFileSync(join(profile, 'failure.png'), (await win.webContents.capturePage()).toPNG())
    }
    for (const c of clients) {
      c.child.kill()
    }
    bridge?.close()
    console.error('Artifacts:', profile)
    app.exit(1)
  }
})
