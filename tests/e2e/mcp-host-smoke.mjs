import { temporaryProfile } from '../support/fixtures.cjs'
// Cold-start the actual built application in an isolated profile; never call paid providers.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../..', import.meta.url))
const electron = createRequire(import.meta.url)('electron')
const profile = temporaryProfile('np-mcp-host-')
const clients = []
const hosts = new Set()
const packagedExe = process.env.NP_PACKAGED_EXECUTABLE
  ? resolve(process.env.NP_PACKAGED_EXECUTABLE)
  : null
function agent(groups = 'core') {
  const child = spawn(
    packagedExe ?? electron,
    packagedExe
      ? [join(dirname(packagedExe), 'resources/mcp-proxy.cjs')]
      : [join(root, 'src/runtime/mcp-proxy.cjs'), root],
    {
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NOVELPROMPT_USER_DATA: profile,
        NOVELPROMPT_MCP_GROUPS: groups,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  const waiting = new Map()
  let sequence = 0
  let errors = ''
  child.stderr.on('data', (b) => (errors += b))
  createInterface({ input: child.stdout }).on('line', (line) => {
    const m = JSON.parse(line)
    const w = waiting.get(m.id)
    if (w) {
      clearTimeout(w.timer)
      waiting.delete(m.id)
      w.resolve(m)
    }
  })
  child.on('exit', (code) => {
    for (const p of waiting.values()) {
      clearTimeout(p.timer)
      p.reject(Error('Proxy exited ' + code + ': ' + errors))
    }
    waiting.clear()
  })
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(Error('Timeout ' + method + ': ' + errors))
      }, 40000)
      waiting.set(id, { resolve, reject, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  const c = {
    child,
    request,
    async data(name, args = {}) {
      const m = await request('tools/call', { name, arguments: args })
      if (m.error || m.result?.isError) {
        throw Error(m.error?.message || m.result.content[0].text)
      }
      return m.result.structuredContent ?? JSON.parse(m.result.content[0].text)
    },
  }
  clients.push(c)
  return c
}
const init = (c) =>
  c.request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'host-smoke', version: '1' },
  })
try {
  const a = agent()
  const b = agent()
  const initialized = await Promise.all([init(a), init(b)])
  assert.ok(initialized[0].result.instructions.includes('agent_guide(topic=overview)'))
  assert.equal(initialized[0].result.capabilities.resources.subscribe, true)
  const core = [
    'agent_guide',
    'get_app_state',
    'list_tasks',
    'cancel_task',
    'configure_tools',
    'get_operation',
  ]
  for (const c of [a, b]) {
    assert.deepEqual(
      (await c.request('tools/list')).result.tools.map((t) => t.name).sort(),
      [...core].sort(),
    )
  }
  const fixed = agent('all')
  await init(fixed)
  assert.equal(
    (await fixed.request('tools/list')).result.tools.length,
    69,
    'first tools/list exposes all configured tools without refresh',
  )
  fixed.child.stdin.end()
  const narrow = agent('tags,skills')
  await init(narrow)
  const narrowTools = (await narrow.request('tools/list')).result.tools.map((t) => t.name)
  assert.ok(narrowTools.includes('search_tags'))
  assert.ok(!narrowTools.includes('generate_image'))
  narrow.child.stdin.end()
  const invalid = agent('workspace,typo')
  await assert.rejects(init(invalid), /NOVELPROMPT_MCP_GROUPS/)
  const catalog = await a.data('configure_tools')
  await a.data('configure_tools', { groups: catalog.groups.map((g) => g.id) })
  assert.equal((await b.request('tools/list')).result.tools.length, 6)
  await b.data('configure_tools', { groups: ['workspace'] })
  const [x, y] = await Promise.all([a.data('get_app_state'), b.data('get_app_state')])
  hosts.add(x.hostPid)
  assert.equal(x.hostPid, y.hostPid)
  assert.equal(x.visible, false)
  assert.equal(x.desktop, null)
  if (packagedExe) {
    assert.equal(x.version, createRequire(import.meta.url)('../../package.json').version)
  }
  const guide = await a.data('prompt_guide', { detail: 'summary' })
  assert.ok(guide.fingerprint)
  assert.ok(JSON.stringify(guide).length < 5000)
  const overview = await a.data('agent_guide')
  assert.equal(overview.topic, 'overview')
  assert.ok(overview.content.includes('前台'))
  const full = await a.data('agent_guide', { topic: 'all' })
  for (const topic of overview.topics.filter((t) => t !== 'all')) {
    const part = await a.data('agent_guide', { topic })
    assert.equal(part.fingerprint, full.fingerprint)
    assert.ok(full.content.includes(part.content))
  }
  assert.ok(full.content.includes('show:true'))
  assert.ok(full.content.includes('不自动唤醒'))
  const resources = await a.request('resources/list')
  assert.ok(resources.result.resources.some((r) => r.uri === overview.uri))
  const resource = await a.request('resources/read', { uri: overview.uri })
  assert.equal(resource.result.contents[0].text, full.content)
  assert.ok(
    (await a.request('resources/read', { uri: 'novelprompt://app/state' })).result.contents[0].text,
  )
  assert.equal(
    (await a.request('resources/read', { uri: 'novelprompt://guide/missing' })).error.code,
    -32602,
  )
  await assert.rejects(a.data('agent_guide', { topic: 'missing' }), /topic.*overview/)
  assert.equal((await a.data('get_app_state')).visible, false)
  assert.equal((await a.request('tools/list')).result.tools.length, 69)
  console.log(
    'PASS agent onboarding in initialize; guide topics/resource share content and fingerprint; invalid topic/resource rejected; reading keeps host headless',
  )
  const creation = {
    title: '冷启动持久化测试',
    draft: { base: '1girl', negative: '', characters: [] },
    show: false,
    operation_id: 'host-recovery-create-0001',
  }
  const w = await a.data('create_workspace', creation)
  a.child.stdin.end()
  await b.request('ping')
  assert.equal((await b.data('get_workspace', { id: w.id })).id, w.id)
  await b.data('set_workspace_agent', {
    id: w.id,
    revision: (await b.data('get_workspace', { id: w.id })).revision,
    mode: 'external',
  })
  const owned = await b.data('get_app_state', { workspace_id: w.id })
  assert.equal(owned.connection.workspace.agentOwnership, 'self')
  console.log(
    'PASS concurrent proxy cold-start uses one actual host; headless operation, compact guide, persistent workspace, disconnect isolation',
  )
  process.kill(x.hostPid)
  await new Promise((r) => setTimeout(r, 1000))
  const c = agent()
  await init(c)
  assert.equal(
    (await c.request('tools/list')).result.tools.length,
    6,
    'reconnect starts with core discovery',
  )
  await c.data('configure_tools', { groups: ['workspace'] })
  const restarted = await c.data('get_app_state')
  hosts.add(restarted.hostPid)
  assert.notEqual(restarted.hostPid, x.hostPid)
  let recovered
  for (let i = 0; i < 100; i++) {
    try {
      recovered = await b.data('get_app_state', { workspace_id: w.id })
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  assert.ok(recovered, 'same stdio client reconnects after the real host exits')
  assert.equal(b.child.exitCode, null)
  assert.notEqual(recovered.connection.sessionId, owned.connection.sessionId)
  assert.equal(recovered.connection.workspace.agentOwnership, 'disconnected')
  assert.equal(recovered.connection.workspace.needsTakeover, true)
  assert.equal((await b.data('configure_tools')).activeGroups.includes('workspace'), true)
  console.log(
    'PASS initial fixed tool groups; same stdio connection survives real host restart and reports explicit takeover requirements',
  )
  assert.equal((await c.data('get_workspace', { id: w.id })).id, w.id)
  const operation = await c.data('get_operation', { operation_id: creation.operation_id })
  assert.equal(operation.operation.status, 'succeeded')
  assert.equal(operation.result.structuredContent.id, w.id)
  const replay = await c.data('create_workspace', creation)
  assert.equal(replay.id, w.id)
  assert.equal(replay.operation.replayed, true)
  assert.equal(
    (await c.data('list_workspaces')).items.length,
    1,
    'replay after host restart must not create another workspace',
  )
  const grouped = await c.data('configure_tools', { groups: ['workspace'] })
  assert.ok(grouped.exposedToolCount < 69)
  const filtered = (await c.request('tools/list')).result.tools
  assert.ok(filtered.some((t) => t.name === 'get_operation'))
  assert.ok(!filtered.some((t) => t.name === 'generate_image'))
  await c.data('configure_tools', { groups: grouped.groups.map((g) => g.id) })
  assert.equal((await c.request('tools/list')).result.tools.length, 69)
  console.log(
    'PASS operation result survives actual host termination; same operation does not create twice; tool groups filter and restore through the real proxy',
  )
  console.log(
    'PASS stale endpoint recovery, new host after crash, persisted workspace retained; no requests replayed',
  )
  assert.ok(
    (await c.request('tools/list')).result.tools.some((t) => t.name === 'ui_create_workspace'),
  )
  const opened = await c.data('ui_open_workspace', { id: w.id })
  assert.equal(opened.tab, 'workspace')
  assert.equal(opened.workspace.id, w.id)
  assert.equal((await c.data('get_app_state')).visible, true)
  console.log(
    'PASS foreground tool opens a real window from headless host and waits for renderer readiness',
  )
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  for (const c of clients) {
    c.child.stdin.end()
  }
  await new Promise((r) => setTimeout(r, 200))
  for (const pid of hosts) {
    try {
      process.kill(pid)
    } catch {}
  }
  for (const c of clients) {
    c.child.kill()
  }
}
