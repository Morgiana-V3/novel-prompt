// Real stdio relay against a disposable local bridge; no application/provider data.
const { createServer } = require('node:net'), { spawn } = require('node:child_process')
const { createInterface } = require('node:readline'), { createHash } = require('node:crypto')
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path'), { homedir, tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '..'), profile = mkdtempSync(join(tmpdir(), 'np-relay-'))
const key = createHash('sha256').update([root.toLowerCase(), homedir(), profile].join('|')).digest('hex').slice(0, 24)
const folder = join(tmpdir(), `novelprompt-${key}`)
let child, sessions = 0, effects = 0, initialized = 0, subscribed = 0, cancelled = null, releaseRestore
const handshakes = [], sockets = new Set(), messages = [], waiting = new Map()
const server = createServer(socket => {
  sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket))
  let authed = false
  createInterface({ input: socket }).on('line', line => {
    const m = JSON.parse(line)
    if (!authed) { assert.equal(m.token, 'fixture'); handshakes.push(m); authed = true; sessions++; socket.write('{"bridgeReady":true}\n'); return }
    messages.push(m)
    const reply = result => socket.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n')
    if (m.method === 'initialize') {
      initialized++
      const finish = () => reply({ protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } })
      if (initialized > 1) releaseRestore = finish; else finish()
      return
    }
    if (m.method === 'resources/subscribe') { subscribed++; reply({}); return }
    if (m.method === 'notifications/cancelled') { cancelled = m.params.requestId; return }
    if (m.method === 'tools/call') {
      if (m.params.name === 'configure_tools') { reply({ structuredContent: { activeGroups: ['core', ...m.params.arguments.groups] } }); return }
      if (m.params.name === 'write_then_disconnect') { effects++; socket.destroy(); return }
      if (m.params.name === 'slow_read') return
      if (m.params.name === 'get_app_state') { reply({ structuredContent: { sessionId: sessions, effects } }); return }
      if (m.params.name === 'get_operation') { reply({ structuredContent: { operation: { id: m.params.arguments.operation_id, status: 'succeeded' }, effects } }); return }
    }
    if (m.id !== undefined) reply({})
  })
})
const pause = ms => new Promise(r => setTimeout(r, ms))
const wait = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(20) }; throw Error('Timed out') }
let seq = 0
const request = (method, params = {}, id = ++seq) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { waiting.delete(id); reject(Error('No response: ' + method)) }, 10000)
  waiting.set(id, m => { clearTimeout(timer); resolve(m) })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
;(async () => {
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, 'bridge.json'), JSON.stringify({ address: { host: '127.0.0.1', port: server.address().port }, token: 'fixture' }))
    child = spawn(process.execPath, [join(root, 'scripts/mcp-proxy.cjs'), root], { windowsHide: true, env: { ...process.env, NOVELPROMPT_USER_DATA: profile, NOVELPROMPT_MCP_GROUPS: 'workspace,images' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''; child.stderr.on('data', b => stderr += b)
    const events = []
    createInterface({ input: child.stdout }).on('line', line => { const m = JSON.parse(line); if (m.id === undefined) events.push(m); else { waiting.get(m.id)?.(m); waiting.delete(m.id) } })
    await request('initialize', { clientInfo: { name: 'relay-fixture' }, protocolVersion: '2025-11-25' })
    assert.equal(handshakes[0].toolGroups, 'workspace,images')
    await request('tools/call', { name: 'configure_tools', arguments: { groups: ['tags'] } })
    await request('resources/subscribe', { uri: 'novelprompt://app/state' })
    // Both string and numeric IDs are preserved. Cancellation maps to the wire ID.
    const slow = request('tools/call', { name: 'slow_read', arguments: {} }, 'visible-id')
    await wait(() => messages.some(m => m.params?.name === 'slow_read'))
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'visible-id' } }) + '\n')
    await wait(() => cancelled !== null)
    assert.equal(cancelled, messages.find(m => m.params?.name === 'slow_read').id)
    const op = 'relay-write-once-0001'
    const uncertain = await request('tools/call', { name: 'write_then_disconnect', arguments: { operation_id: op } })
    assert.equal(uncertain.error.data.kind, 'OUTCOME_UNKNOWN'); assert.equal(uncertain.error.data.operationId, op)
    assert.equal((await slow).error.data.kind, 'OUTCOME_UNKNOWN')
    await wait(() => !!releaseRestore)
    const notSent = await request('tools/call', { name: 'write_then_disconnect', arguments: { operation_id: 'never-send-this-0001' } })
    assert.equal(notSent.error.data.kind, 'NOT_SENT')
    assert.equal(messages.filter(m => m.params?.name === 'write_then_disconnect').length, 1)
    releaseRestore()
    await wait(() => events.some(m => m.method === 'notifications/resources/updated'))
    assert.equal(child.exitCode, null); assert.equal(initialized, 2); assert.equal(subscribed, 2)
    assert.deepEqual(handshakes[1].toolGroups, ['core', 'tags'])
    const state = await request('tools/call', { name: 'get_app_state', arguments: {} })
    assert.equal(state.result.structuredContent.sessionId, 2)
    assert.equal((await request('tools/call', { name: 'get_operation', arguments: { operation_id: op } })).result.structuredContent.operation.status, 'succeeded')
    assert.equal(effects, 1, 'interrupted writes never replay')
    assert.equal(messages.filter(m => m.params?.name === 'configure_tools').length, 1, 'groups restored by handshake, not app replay')
    assert.match(stderr, /连接已恢复/)
    console.log('PASS initial groups, persistent stdio recovery, reinitialization, subscriptions, group restoration, ID/cancellation mapping and no write replay')
  } finally { child?.stdin.end(); await pause(100); child?.kill(); for (const socket of sockets) socket.destroy(); server.close() }
})().catch(e => { console.error(e); process.exitCode = 1 })
