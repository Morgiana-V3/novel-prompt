// Read-only measurements on existing, inactive projects in the current development instance.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  assertCurrentDevState,
  auditDirectory,
  connectCurrentDev,
  redact,
} from './current-dev-client.mjs'
import { assertMcpCatalog } from '../../scripts/contract-catalog.mjs'

const artifacts = auditDirectory()
const results = []
let client
let failure
let hostState
let projectCount
let selected
const startedAt = new Date().toISOString()
console.log(`Artifacts: ${artifacts}`)
async function call(name, args = {}) {
  const response = await client.request('tools/call', { name, arguments: args }, 60_000)
  if (response.error || response.result?.isError) {
    throw new Error(redact(response.error?.message || response.result.content[0].text))
  }
  return response.result.structuredContent
}
async function measure(label, name, args = {}, repetitions = 5) {
  const samples = []
  for (let index = 0; index < repetitions; index++) {
    const start = performance.now()
    const data = await call(name, args)
    samples.push({
      elapsedMs: performance.now() - start,
      responseBytes: Buffer.byteLength(JSON.stringify(data)),
    })
  }
  const times = samples.map((sample) => sample.elapsedMs).sort((left, right) => left - right)
  const result = {
    label,
    tool: name,
    repetitions,
    medianMs: times[Math.floor(times.length / 2)],
    maxMs: times.at(-1),
    samples,
  }
  results.push(result)
  console.log(JSON.stringify(result))
}
try {
  client = await connectCurrentDev()
  const initialized = await client.request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'current-dev-performance', version: '1' },
  })
  assert.ok(!initialized.error)
  client.notify('notifications/initialized')
  const catalog = (await client.request('tools/list')).result.tools
  assertMcpCatalog(catalog)
  hostState = await call('get_app_state')
  assertCurrentDevState(client, hostState)
  const tasks = await call('list_tasks')
  assert.ok(
    !tasks.tasks.some((task) => ['running', 'cancelling'].includes(task.status)),
    '当前有运行中的任务，无法独占采样',
  )
  assert.ok(
    !hostState.desktop?.blockers?.length && !hostState.desktop?.workspace?.editing,
    '当前界面正在编辑或有弹窗，停止采样',
  )
  const workspaces = await call('list_workspaces')
  projectCount = workspaces.items.length
  // Do not request a desktop lease on the user's open project (which could flush draft notes).
  selected = workspaces.items
    .filter((workspace) => workspace.id !== hostState.desktop?.workspace?.id)
    .sort((left, right) => right.messages + right.versions - left.messages - left.versions)[0]
  await measure('existing-projects/list', 'list_workspaces')
  await measure('existing-projects/pending', 'list_workspace_requests')
  if (selected) {
    const id = selected.id
    const baseline = await call('get_workspace', { id })
    await measure('existing-project/summary', 'get_workspace', { id })
    await measure('existing-project/unchanged', 'get_workspace', {
      id,
      since_revision: baseline.revision,
    })
    if (baseline.messages.length) {
      await measure('existing-project/one-message', 'get_workspace', {
        id,
        detail: 'full',
        message_ids: [baseline.messages[0].id],
      })
    }
    if (baseline.versions.length) {
      await measure('existing-project/one-version', 'get_workspace', {
        id,
        detail: 'full',
        version_ids: [baseline.versions[0].id],
      })
    }
    await measure('existing-project/rules-only', 'get_workspace_context', { id, rules_only: true })
    await measure('existing-project/full-page', 'get_workspace', {
      id,
      detail: 'full',
      message_limit: 100,
    })
  }
  console.log(`PASS current development read-only performance (${projectCount} existing projects)`)
} catch (error) {
  failure = redact(error.stack || String(error))
  console.error(failure)
  process.exitCode = 1
} finally {
  client?.close()
  writeFileSync(
    join(artifacts, 'performance-results.json'),
    JSON.stringify(
      {
        status: failure ? 'failed' : 'passed',
        startedAt,
        finishedAt: new Date().toISOString(),
        failure,
        hostPid: client?.hostPid,
        profile: client?.profile,
        dataRoot: client?.dataRoot,
        buildModifiedAt: client?.buildModifiedAt,
        loadedRuntime: client?.loadedRuntime,
        projectCount,
        selected: selected
          ? { id: selected.id, versions: selected.versions, messages: selected.messages }
          : null,
        results,
        method:
          'Existing current-development host and real project files. Direct authenticated MCP bridge. Five read-only calls per measurement; no synthetic fixtures, no profile copy, no paid calls. Timings include bridge/JSON transport. OS/V8 caches are not cleared; first-read/cold-start and production packaged memory are not measured. The open workspace is excluded. Existing data is not written or deleted.',
      },
      null,
      2,
    ),
  )
}
