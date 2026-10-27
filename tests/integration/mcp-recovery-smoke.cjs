const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Protocol/operation regressions: isolated disk journal, no user data or providers.
const { app } = require('electron')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const ts = require('typescript')
const profile = temporaryProfile('np-mcp-recovery-')
app.setPath('userData', profile)
require('../support/register-typescript.cjs')
const { createMcpSession } = require('../../src/main/adapters/mcp/server.ts')
const { OperationStore, tracksOperation } = require('../../src/main/adapters/mcp/operations.ts')
const { toolGroup } = require('../../src/main/adapters/mcp/tool-groups.ts')
let effects = 0
let release
let cancelled
let executeCalls = 0
const tools = [
  {
    name: 'create_workspace',
    description: 'fixture',
    outputSchema: {
      type: 'object',
      required: ['id', 'title'],
      properties: { id: { type: 'string' }, title: { type: 'string' } },
    },
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    run: async (a) => {
      effects++
      assert.equal(a.operation_id, undefined)
      if (a.title === 'slow') {
        await new Promise((r) => (release = r))
      }
      if (a.title === 'fail') {
        throw Error('partial fixture')
      }
      return JSON.stringify(
        a.title === 'malformed' ? { saved: true } : { id: 'created-' + effects, title: a.title },
      )
    },
  },
  {
    name: 'delete_image',
    description: 'fixture',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false },
    run: async (_, signal) => {
      effects++
      await new Promise((_, reject) => {
        cancelled = () => reject(Error('cancelled'))
        signal.addEventListener('abort', cancelled, { once: true })
      })
      return '{}'
    },
  },
  {
    name: 'search_tags',
    description: 'fixture',
    outputSchema: { type: 'object', required: ['items'], properties: { items: { type: 'array' } } },
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => '[]',
  },
]
const sessions = []
function client() {
  let id = 0
  const waiters = new Map()
  const events = []
  const session = createMcpSession(
    tools,
    { name: 'fixture', version: '1', instructions: '' },
    (line) => {
      const message = JSON.parse(line)
      if (message.id === undefined) {
        events.push(message)
      } else {
        waiters.get(message.id)?.(message)
        waiters.delete(message.id)
      }
    },
    {
      execute: async (tool, args, signal, progress) => {
        executeCalls++
        return tool.run(args, signal, progress)
      },
    },
  )
  sessions.push(session)
  const request = (method, params = {}) =>
    new Promise((resolve) => {
      const seq = ++id
      waiters.set(seq, resolve)
      session.receive(JSON.stringify({ jsonrpc: '2.0', id: seq, method, params }))
    })
  return {
    session,
    events,
    request,
    tool: async (name, args = {}) =>
      (await request('tools/call', { name, arguments: args })).result,
  }
}
app.whenReady().then(async () => {
  try {
    const a = client()
    const b = client()
    for (const c of [a, b]) {
      assert.equal((await c.request('initialize')).result.capabilities.tools.listChanged, true)
    }
    const catalog = (await a.tool('configure_tools')).structuredContent
    assert.equal(catalog.exposedToolCount, 2)
    assert.deepEqual(catalog.activeGroups, ['core'])
    assert.equal(executeCalls, 0, 'discovery must not create application tasks')
    await a.tool('configure_tools', { groups: ['tags'] })
    assert.deepEqual(
      (await a.request('tools/list')).result.tools.map((t) => t.name),
      ['search_tags', 'configure_tools', 'get_operation'],
    )
    assert.equal(
      (await b.request('tools/list')).result.tools.length,
      2,
      'connection filters are isolated',
    )
    assert.equal(a.events.filter((e) => e.method === 'notifications/tools/list_changed').length, 1)
    await a.tool('configure_tools', { groups: ['tags'] })
    assert.equal(a.events.length, 1, 'unchanged selection emits no notification')
    assert.equal((await a.tool('configure_tools', { groups: ['typo'] })).isError, true)
    await a.tool('configure_tools', { groups: [] })
    assert.deepEqual(
      (await a.request('tools/list')).result.tools.map((t) => t.name),
      ['configure_tools', 'get_operation'],
    )
    for (const c of [a, b]) {
      await c.tool('configure_tools', { groups: ['workspace', 'images'] })
    }
    assert.equal(toolGroup('ui_delete_workspace_image'), 'frontend')
    assert.equal(
      tracksOperation({ name: 'optimize_prompt', annotations: { readOnlyHint: true } }),
      true,
      'costly read-only AI is tracked',
    )
    const key = 'recovery-concurrent-0001'
    const args = { title: 'slow', operation_id: key }
    const first = a.tool('create_workspace', args)
    assert.equal(effects, 1)
    const journal = JSON.parse(readFileSync(join(profile, 'data/mcp-operations.json'), 'utf8'))
    assert.equal(journal.find((r) => r.id === key).status, 'running')
    assert.ok(
      !JSON.stringify(journal).includes('slow'),
      'arguments are represented only by fingerprint',
    )
    const duplicate = await b.tool('create_workspace', { operation_id: key, title: 'slow' })
    assert.equal(duplicate.structuredContent.operation.status, 'running')
    assert.equal(effects, 1)
    assert.equal(
      (await b.tool('create_workspace', { operation_id: key, title: 'different' }))
        .structuredContent.error.code,
      'OPERATION_ID_CONFLICT',
    )
    assert.equal(
      (await b.tool('delete_image', { operation_id: key })).structuredContent.error.code,
      'OPERATION_ID_CONFLICT',
    )
    a.session.close()
    release()
    await new Promise((r) => setImmediate(r))
    const found = (await b.tool('get_operation', { operation_id: key })).structuredContent
    assert.equal(found.operation.status, 'succeeded')
    assert.equal(found.result.structuredContent.id, 'created-1')
    const replay = await b.tool('create_workspace', args)
    assert.equal(replay.structuredContent.id, 'created-1')
    assert.equal(replay.structuredContent.operation.replayed, true)
    assert.equal(effects, 1)
    const failureArgs = { operation_id: 'recovery-failed-0001', title: 'fail' }
    assert.equal((await b.tool('create_workspace', failureArgs)).isError, true)
    assert.equal((await b.tool('create_workspace', failureArgs)).isError, true)
    assert.equal(effects, 2)
    const c = client()
    await c.request('initialize')
    assert.equal(
      (await c.request('tools/list')).result.tools.length,
      2,
      'new connection starts with core again',
    )
    await c.tool('configure_tools', { groups: ['images'] })
    void c.tool('delete_image', { operation_id: 'recovery-cancelled-0001' })
    assert.equal(typeof cancelled, 'function')
    c.session.close()
    await new Promise((r) => setImmediate(r))
    assert.equal(
      (await b.tool('get_operation', { operation_id: 'recovery-cancelled-0001' })).structuredContent
        .operation.status,
      'interrupted',
    )
    assert.equal(
      (await b.tool('create_workspace', { title: 'invalid', operation_id: 'short' })).isError,
      true,
    )
    assert.equal(effects, 3)
    const malformedArgs = { title: 'malformed', operation_id: 'recovery-contract-0001' }
    const malformed = await b.tool('create_workspace', malformedArgs)
    assert.equal(malformed.isError, true)
    assert.equal(malformed.structuredContent.error.code, 'OUTPUT_CONTRACT_VIOLATION')
    assert.equal(malformed.structuredContent.error.retryable, false)
    assert.deepEqual(malformed.structuredContent.observedResult, { saved: true })
    const replayMalformed = await b.tool('create_workspace', malformedArgs)
    assert.equal(replayMalformed.structuredContent.operation.replayed, true)
    assert.equal(replayMalformed.structuredContent.error.code, 'OUTPUT_CONTRACT_VIOLATION')
    assert.equal(effects, 4, 'invalid output must never repeat the mutation')
    console.log('PASS output contract failure retains observed results and does not repeat effects')
    console.log(
      'PASS per-session discovery, notifications, argument validation, concurrent deduplication, mismatched intent rejection, disconnect recovery, failed and cancelled operations never replay',
    )
    const file = join(profile, 'crash-journal.json')
    const store = new OperationStore(file)
    const pending = store.begin('create_workspace', { title: 'crash' }, 'recovery-crash-0001')
    const restarted = new OperationStore(file)
    assert.equal(restarted.query(pending.id).operation.status, 'interrupted')
    const large = store.begin('create_workspace', {}, 'recovery-large-0001')
    store.finish(large, { content: [{ type: 'text', text: 'x'.repeat(70_000) }] })
    assert.equal(new OperationStore(file).query(large.id).operation.resultOmitted, true)
    const recovered = new OperationStore(join(profile, 'data/mcp-operations.json'))
    assert.equal(recovered.query(key).result.structuredContent.id, 'created-1')
    assert.equal(recovered.query('recovery-missing-0001').operation, null)
    const corrupt = join(profile, 'corrupt.json')
    writeFileSync(corrupt, 'broken')
    assert.throws(() => new OperationStore(corrupt).begin('create_workspace', {}), /阻止/)
    assert.throws(() =>
      new OperationStore(join(profile, 'missing', 'journal.json')).begin('create_workspace', {}),
    )
    console.log(
      'PASS durable results, crash uncertainty, oversized result summaries, corrupt/unwritable journal fails before mutation; profile ' +
        profile,
    )
    // first deliberately has no reply after the simulated connection closes.
    void first
    sessions.forEach((s) => s.close())
    app.exit(0)
  } catch (e) {
    console.error(e)
    sessions.forEach((s) => s.close())
    app.exit(1)
  }
})
