// Read-only integration check through the real stdio proxy. No provider calls.
// Explicit --live uses the development profile; reports contain sizes/IDs, not prompt bodies.
// node tests/integration/mcp-read-smoke.mjs --live <report.json>
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
const [mode, output] = process.argv.slice(2)
if (mode !== '--live' || !output) {
  throw Error('Usage: --live <report.json> (read-only development profile)')
}
const root = fileURLToPath(new URL('../..', import.meta.url))
const child = spawn(
  createRequire(import.meta.url)('electron'),
  [join(root, 'src/runtime/mcp-proxy.cjs'), root],
  {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
)
const pending = new Map()
const notifications = []
const measurements = []
const checks = []
let seq = 0
let errors = ''
child.stderr.on('data', (b) => {
  errors = (errors + b).slice(-8000)
})
function failAll(error) {
  for (const p of pending.values()) {
    clearTimeout(p.timer)
    p.reject(error)
  }
  pending.clear()
}
child.on('error', failAll)
child.on('exit', (code) => failAll(Error(`Proxy exited (${code}): ${errors}`)))
createInterface({ input: child.stdout }).on('line', (line) => {
  try {
    const m = JSON.parse(line)
    const p = pending.get(m.id)
    if (p) {
      clearTimeout(p.timer)
      pending.delete(m.id)
      p.resolve(m)
    } else if (m.method) {
      notifications.push(m.method)
    }
  } catch (e) {
    failAll(e)
  }
})
const request = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(Error(`Timeout: ${method}`))
    }, 40000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
async function call(name, args = {}, label = name) {
  const start = performance.now()
  const response = await request('tools/call', { name, arguments: args })
  assert.ok(
    !response.error && !response.result?.isError,
    JSON.stringify(response.error ?? response.result?.content),
  )
  const data = response.result.structuredContent
  measurements.push({
    label,
    elapsedMs: +(performance.now() - start).toFixed(2),
    structuredChars: JSON.stringify(data).length,
    structuredBytes: Buffer.byteLength(JSON.stringify(data)),
    wireBytes: Buffer.byteLength(JSON.stringify(response)),
  })
  return data
}
try {
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'read-only-integration', version: '1' },
  })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  assert.equal((await request('tools/list')).result.tools.length, 6)
  await call('agent_guide', { topic: 'overview' })
  const state = await call('get_app_state')
  assert.equal(state.runtime.mode, 'development')
  assert.equal(
    state.runtime.appPath.toLowerCase().replace(/[\\/]+$/, ''),
    root.toLowerCase().replace(/[\\/]+$/, ''),
  )
  const configured = await call('configure_tools', { groups: ['workspace', 'images', 'skills'] })
  const catalog = (await request('tools/list')).result.tools
  assert.equal(catalog.length, configured.exposedToolCount)
  assert.ok(catalog.some((t) => t.name === 'get_workspace'))
  assert.ok(notifications.includes('notifications/tools/list_changed'))
  checks.push('core discovery, list_changed notification, refreshed tool schemas')
  await call('agent_guide', { topic: 'workflows' })
  const workspaces = await call('list_workspaces')
  const observations = []
  for (const [index, item] of workspaces.items.slice(0, 10).entries()) {
    const label = `workspace-${index + 1}`
    const summary = await call('get_workspace', { id: item.id }, `${label}/summary`)
    assert.ok(summary.messages.length <= 5)
    assert.equal(
      (
        await call(
          'get_workspace',
          { id: item.id, since_revision: summary.revision },
          `${label}/unchanged`,
        )
      ).notModified,
      true,
    )
    const ids = new Set()
    let cursor
    let count = 0
    do {
      const page = await call(
        'get_workspace',
        {
          id: item.id,
          detail: 'full',
          message_limit: 5,
          ...(cursor ? { before_message_id: cursor, history_revision: summary.revision } : {}),
        },
        `${label}/history-page-${++count}`,
      )
      assert.equal(page.revision, summary.revision)
      for (const message of page.messages) {
        assert.ok(!ids.has(message.id))
        ids.add(message.id)
      }
      cursor = page.history.nextBeforeMessageId
      assert.equal(page.history.hasMore, Boolean(cursor))
      assert.ok(count <= 100, 'Safety cap: this live check reads at most 500 messages per project')
    } while (cursor)
    assert.equal(ids.size, summary.history.total)
    const first = await call(
      'get_workspace_context',
      { id: item.id, rules_only: true, skills_task: 'all' },
      `${label}/rules-first`,
    )
    const cached = await call(
      'get_workspace_context',
      { id: item.id, rules_only: true, skills_task: 'all' },
      `${label}/rules-cached`,
    )
    if (first.skills) {
      assert.equal(cached.skills.sections.length, 0)
      assert.equal(cached.skills.bodiesNotModified, true)
      assert.equal(cached.skills.selectionComplete, true)
      const forced = await call(
        'get_workspace_context',
        { id: item.id, rules_only: true, skills_task: 'all', skills_mode: 'full' },
        `${label}/rules-force-full`,
      )
      assert.equal(forced.skills.sections.length, forced.skills.selectedIds.length)
    }
    observations.push({
      project: label,
      messages: ids.size,
      historyPages: count,
      ruleCacheCheck: first.skills ? 'passed' : 'skipped: no pending request with frozen rules',
      frozenRuleChars: first.skills?.textLength ?? 0,
      firstRuleBodies: first.skills?.sections.length ?? 0,
      cachedRuleBodies: cached.skills?.sections.length ?? 0,
    })
  }
  checks.push('unchanged revision, full history pagination without omissions/duplicates')
  if (observations.some((o) => o.ruleCacheCheck === 'passed')) {
    checks.push('frozen rule cache and forced reload')
  }
  const report = {
    at: new Date().toISOString(),
    readOnly: true,
    paidProviderCalls: 0,
    runtime: state.runtime,
    workspaceCount: workspaces.items.length,
    testedWorkspaceCount: observations.length,
    checks,
    observations,
    measurements,
  }
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ checks, observations, report: output }, null, 2))
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  child.stdin.end()
  setTimeout(() => child.kill(), 3000).unref()
}
