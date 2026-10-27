// Reproducible backend benchmark. Uses only synthetic data in a new temp profile.
// No provider calls, no user projects, no production changes.
const { app, net } = require('electron')
const fs = require('node:fs'), { join, resolve, sep } = require('node:path'), { tmpdir, cpus } = require('node:os')
const { createHash, randomUUID } = require('node:crypto'), { performance } = require('node:perf_hooks')
const assert = require('node:assert/strict'), ts = require('typescript'), { PNG } = require('pngjs')
const root = resolve(__dirname, '..'), profile = fs.mkdtempSync(join(tmpdir(), 'np-mcp-performance-'))
app.setPath('userData', profile); app.getAppPath = () => root
net.fetch = async () => { throw Error('Network is forbidden in the performance fixture') }
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText, f)
const pages = require('../src/main/page-workspaces.ts')
const { desktopTools } = require('../src/main/mcp/desktop-tools.ts')
const { createMcpSession } = require('../src/main/mcp/server.ts')
const { composeSkills } = require('../src/main/skills.ts')
const { buildTools } = require('../src/main/mcp/tools.ts')
const { frontendTools } = require('../src/main/mcp/frontend-tools.ts')
const library = require('../src/main/image-library.ts')
const desktop = { withWorkspace: async (_, fn) => fn() }
const tools = [...buildTools(), ...desktopTools(desktop, {}, () => ({})), ...frontendTools(desktop)]
const sessions = [], results = [], fixtureInfo = []
const hash = s => createHash('sha256').update(s).digest('hex')
const bytes = value => Buffer.byteLength(JSON.stringify(value))
const mb = n => Math.round(n / 1048576 * 100) / 100
const ms = n => Math.round(n * 100) / 100
let reads = null
const originalRead = fs.readFileSync
fs.readFileSync = function(path, ...args) {
  const value = originalRead.call(this, path, ...args)
  if (reads && typeof path === 'string' && resolve(path).startsWith(profile + sep)) {
    reads.files++; reads.bytes += Buffer.byteLength(value)
    if (path.includes('page-workspaces') && path.endsWith('.json')) reads.projectFiles++
  }
  return value
}
function client() {
  let seq = 0; const pending = new Map()
  const session = createMcpSession(tools, { name: 'performance-fixture', version: '1', instructions: '' }, line => {
    const msg = JSON.parse(line), reply = pending.get(msg.id)
    if (reply) { pending.delete(msg.id); reply({ msg, wireBytes: Buffer.byteLength(line) }) }
  }); sessions.push(session)
  const request = (method, params = {}) => new Promise(resolve => {
    const id = ++seq; pending.set(id, resolve)
    session.receive(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
  return { request, async call(name, args = {}) {
    const response = await request('tools/call', { name, arguments: args })
    assert.ok(!response.msg.error && !response.msg.result.isError, JSON.stringify(response.msg.error ?? response.msg.result.structuredContent?.error))
    return { data: response.msg.result.structuredContent, wireBytes: response.wireBytes }
  } }
}
async function measure(label, fn, verify = () => {}, repeats = 5) {
  const samples = []
  for (let i = 0; i < repeats; i++) {
    // Allow timers/GC between samples; memory deltas are not a peak-memory measurement.
    await new Promise(resolve => setTimeout(resolve, 5))
    const before = process.memoryUsage(), counters = { files: 0, projectFiles: 0, bytes: 0 }
    reads = counters
    const start = performance.now()
    const timerDelay = new Promise(resolve => setTimeout(() => resolve(performance.now() - start), 0))
    const output = await fn(), elapsed = performance.now() - start, after = process.memoryUsage()
    reads = null
    verify(output.data)
    samples.push({ elapsedMs: ms(elapsed), timerDelayMs: ms(await timerDelay), structuredBytes: bytes(output.data), structuredChars: JSON.stringify(output.data).length,
      wireBytes: output.wireBytes, projectReads: counters.projectFiles, readMB: mb(counters.bytes),
      heapDeltaMB: mb(after.heapUsed - before.heapUsed), heapAfterMB: mb(after.heapUsed), rssAfterMB: mb(after.rss) })
  }
  const sorted = samples.map(s => s.elapsedMs).sort((a, b) => a - b)
  const row = { label, repetitions: repeats, medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1),
    maxTimerDelayMs: Math.max(...samples.map(s => s.timerDelayMs)), structuredBytes: samples.at(-1).structuredBytes,
    structuredChars: samples.at(-1).structuredChars, wireBytes: samples.at(-1).wireBytes, projectReads: samples.at(-1).projectReads, readMB: samples.at(-1).readMB,
    maxObservedHeapMB: Math.max(...samples.map(s => s.heapAfterMB)), maxObservedRssMB: Math.max(...samples.map(s => s.rssAfterMB)), samples }
  results.push(row); console.log(JSON.stringify({ ...row, samples: undefined }))
}
const params = { width: 512, height: 512, steps: 1, scale: 5, cfgRescale: 0, sampler: 'k_euler', noiseSchedule: 'native', seed: 1, count: 1, qualityTags: false, ucPreset: 'none' }
const draft = { base: 'synthetic illustration, '.repeat(45), negative: 'synthetic blur, '.repeat(10), characters: [] }
let template, mask
function makeFixture(label, messageCount, versionCount, regionsPerVersion, snapshotEvery = 20) {
  const w = structuredClone(template); w.id = randomUUID(); w.title = label; w.agentMode = 'external'
  w.versions = Array.from({ length: versionCount }, (_, i) => {
    const v = structuredClone(template.versions[0]); v.id = randomUUID(); v.label = `Candidate ${i + 1}`
    v.createdAt += i; v.groupId = 'fixture-group'; v.groupNumber = 1; v.candidateNumber = i + 1
    v.editor.regions = Array.from({ length: regionsPerVersion }, (_, r) => ({ id: randomUUID(), label: `${r + 1}`,
      instruction: 'Synthetic region', target: null, anchor: { x: 50, y: 50 }, annotated: true, mask, accepted: null }))
    return v
  })
  w.currentVersionId = w.versions[0].id; w.latestGeneratedVersionId = w.versions.at(-1).id
  const core = 'Fixture rule overview. '.repeat(24), body = 'Synthetic frozen rule text. '.repeat(3000), text = core + body
  const snapshot = { digest: hash(text), text, sections: [
    { id: 'builtin:core', name: 'Overview', description: 'Fixture', scope: 'core', model: 'all', priority: 0, start: 0, end: core.length, digest: hash(core) },
    { id: 'fixture:prompt', name: 'Prompt', description: 'Fixture', scope: 'optimize', model: 'all', priority: 1, start: core.length, end: text.length, digest: hash(body) }
  ] }
  w.messages = Array.from({ length: messageCount }, (_, i) => ({ id: randomUUID(), role: i % 2 ? 'assistant' : 'user',
    text: 'Synthetic history explanation. '.repeat(30) + i, createdAt: w.createdAt + i,
    versionId: w.currentVersionId, regionId: null, referenceIds: [],
    ...(i % snapshotEvery === 0 ? { skillSnapshot: snapshot } : {}) }))
  const last = w.messages.at(-1); last.role = 'user'; last.skillSnapshot = snapshot
  last.externalRequest = { status: 'pending', contextKey: '' }
  pages.savePage(w)
  return { id: w.id, revision: w.revision, lastMessageId: last.id, firstMessageId: w.messages[0].id,
    versionId: w.currentVersionId, file: join(profile, 'data', 'page-workspaces', `${w.id}.json`),
    messages: messageCount, versions: versionCount, regions: versionCount * regionsPerVersion,
    fileMB: mb(bytes(w)), label }
}

app.whenReady().then(async () => {
  try {
    const startedAt = new Date().toISOString()
    const png = new PNG({ width: 512, height: 512 }); png.data.fill(255)
    const image = library.storeGeneratedImage(PNG.sync.write(png), { schema: 1, request: { ...draft, version: 'v5', params }, sourceKind: 'generate' }, 'temporary')
    template = await pages.createPage(image.name, params, 'v5', draft)
    // Deterministic noisy binary mask: deliberately harder to compress than a rectangle.
    let seed = 17
    for (let y = 0; y < 512; y += 4) for (let x = 0; x < 512; x += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const value = seed >>> 31 ? 255 : 0
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) png.data.set([value,value,value,255], ((y+dy)*512+x+dx)*4)
    }
    mask = PNG.sync.write(png).toString('base64')
    const a = client(); await a.request('initialize')
    await measure('tools/core', async () => { const r = await a.request('tools/list'); return { data: r.msg.result, wireBytes: r.wireBytes } }, d => assert.equal(d.tools.length, 6), 1)
    await a.call('configure_tools', { groups: ['workspace', 'images'] })
    await measure('tools/workspace+images', async () => { const r = await a.request('tools/list'); return { data: r.msg.result, wireBytes: r.wireBytes } }, () => {}, 1)
    await a.call('configure_tools', { groups: ['tags', 'workspace', 'frontend', 'images', 'ai', 'skills'] })
    await measure('tools/all', async () => { const r = await a.request('tools/list'); return { data: r.msg.result, wireBytes: r.wireBytes } }, d => assert.equal(d.tools.length, 69), 1)
    const catalog = (await a.request('tools/list')).msg.result.tools
    const catalogBreakdown = catalog.map(t => ({ name: t.name, totalBytes: bytes(t),
      inputSchemaBytes: bytes(t.inputSchema ?? {}), outputSchemaBytes: bytes(t.outputSchema ?? {}),
      descriptionBytes: Buffer.byteLength(t.description ?? '') })).sort((a, b) => b.totalBytes - a.totalBytes)
    // Warm module-level setup separately from measured project reads.
    composeSkills('optimize', 'v5')
    for (const spec of [['small', 13, 1, 1], ['medium', 500, 50, 2], ['large', 3000, 200, 4], ['large-no-masks', 3000, 200, 0]]) {
      const f = makeFixture(...spec); fixtureInfo.push(f); console.log('FIXTURE ' + JSON.stringify(f))
      const local = client(); await local.request('initialize')
      const call = (name, args = {}) => local.call(name, { id: f.id, ...args })
      await measure(`${f.label}/summary-first`, () => call('get_workspace'), d => assert.equal(d.history.total, f.messages), 1)
      await measure(`${f.label}/summary`, () => call('get_workspace'), d => { assert.equal(d.messages.length, 5); assert.ok(d.versions.length <= 10) })
      await measure(`${f.label}/unchanged`, () => call('get_workspace', { since_revision: f.revision }), d => assert.equal(d.notModified, true))
      await measure(`${f.label}/one-message`, () => call('get_workspace', { detail: 'full', message_ids: [f.firstMessageId] }), d => assert.equal(d.messages.length, 1))
      await measure(`${f.label}/full-page`, () => call('get_workspace', { detail: 'full', message_limit: 100 }), d => assert.ok(d.messages.length <= 100))
      await measure(`${f.label}/context-first`, () => call('get_workspace_context'), d => assert.equal(d.skills.sections.length, 1), 1)
      await measure(`${f.label}/context-cached`, () => call('get_workspace_context'), d => assert.equal(d.skills.sections.length, 0))
      await measure(`${f.label}/rules-only-cached`, () => call('get_workspace_context', { rules_only: true }), d => assert.equal(d.skills.sections.length, 0))
      // Single old-message edit: prove delta correctness while measuring its cost.
      const changed = pages.readPage(f.id); changed.messages[0].text = 'Changed old message'; pages.savePage(changed)
      await measure(`${f.label}/one-change-delta`, () => call('get_workspace', { since_revision: f.revision }), d => {
        assert.equal(d.delta, true); assert.equal(d.messages.length, 1); assert.equal(d.messages[0].id, f.firstMessageId); assert.equal(d.versions.length, 0)
      })
    }
    let total = pages.listPages().length
    for (const count of [10, 50, 200]) {
      while (total < count) { makeFixture('List fixture ' + total, 25, 3, 0); total++ }
      await measure(`projects=${count}/list-first`, () => a.call('list_workspaces'), d => assert.equal(d.items.length, count), 1)
      await measure(`projects=${count}/list`, () => a.call('list_workspaces'), d => assert.equal(d.items.length, count))
      await measure(`projects=${count}/pending`, () => a.call('list_workspace_requests'), d => assert.equal(d.items.length, count - 1))
    }
    const report = { startedAt, finishedAt: new Date().toISOString(), node: process.versions.node, electron: process.versions.electron,
      platform: process.platform, cpu: cpus()[0]?.model, profile, maskBase64Bytes: mask.length, fixtures: fixtureInfo,
      method: 'Actual TS services and MCP JSON-RPC dispatch in Electron, synthetic files, mocked desktop lock; no browser rendering or stdio transport in timings. Five repeats unless marked first. OS file cache not cleared. Timer delay approximates event-loop blocking. Heap/RSS are sampled after calls, not peaks; GC is not forced. Wire includes text + structured content.',
      catalogBreakdown, results }
    const reportPath = join(profile, 'performance-results.json'); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log('REPORT ' + reportPath)
    sessions.forEach(s => s.close()); app.exit(0)
  } catch (e) { console.error(e); sessions.forEach(s => s.close()); console.error('PROFILE ' + profile); app.exit(1) }
})
