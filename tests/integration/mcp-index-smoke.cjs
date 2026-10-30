const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Cache invalidation regression checks against real files and MCP dispatch.
const { app } = require('electron')
const fs = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { PNG } = require('pngjs')
const profile = temporaryProfile('np-mcp-index-')
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '../..')
require('../support/register-typescript.cjs')
const pages = require('../../src/main/modules/workspace/index.ts')
const library = require('../../src/main/modules/images/library.ts')
const { imagePath } = require('../../src/main/modules/generation/index.ts')
const { desktopTools } = require('../../src/main/adapters/mcp/desktop-tools.ts')
const { createMcpSession } = require('../../src/main/adapters/mcp/server.ts')
const { pageCurrent, pageContextKey } = require('../../src/shared/workspace/model.ts')
let locked = false
let projectReads = 0
const originalRead = fs.readFileSync
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('page-workspaces') && path.endsWith('.json')) {
    projectReads++
  }
  return originalRead.call(this, path, ...args)
}
const tools = desktopTools(
  {
    withWorkspace: async (_, fn) => {
      if (locked) {
        throw Error('unsaved editor')
      }
      return fn()
    },
  },
  {},
  () => ({}),
)
const sessions = []
function client() {
  let id = 0
  const pending = new Map()
  const session = createMcpSession(
    tools,
    { name: 'index-check', version: '1', instructions: '' },
    (line) => {
      const r = JSON.parse(line)
      const fn = pending.get(r.id)
      if (fn) {
        pending.delete(r.id)
        fn(r)
      }
    },
  )
  sessions.push(session)
  const request = (method, params = {}) =>
    new Promise((resolve) => {
      const next = ++id
      pending.set(next, resolve)
      session.receive(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }))
    })
  return {
    request,
    async call(name, args = {}) {
      const r = await request('tools/call', { name, arguments: args })
      if (r.error || r.result.isError) {
        throw Error(JSON.stringify(r.error ?? r.result.content))
      }
      return r.result.structuredContent
    },
  }
}
app.whenReady().then(async () => {
  try {
    const a = client()
    const b = client()
    await a.request('initialize')
    await b.request('initialize')
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
    const draft = { base: 'fixture', negative: '', characters: [] }
    const png = new PNG({ width: 64, height: 64 })
    png.data.fill(255)
    const image = library.storeGeneratedImage(
      PNG.sync.write(png),
      {
        schema: 1,
        createdAt: Date.now(),
        request: { ...draft, version: 'v5', params },
        sourceKind: 'generate',
      },
      'temporary',
    )
    let w = await pages.createPage(image.name, params, 'v5', draft)
    w.title = 'Index A'
    w.agentMode = 'external'
    pages.pageEvent(w, 'pending')
    const message = w.messages.at(-1)
    message.role = 'user'
    message.externalRequest = {
      status: 'pending',
      contextKey: pageContextKey(pageCurrent(w), null, w),
    }
    message.versionId = w.currentVersionId
    message.discussion = pages.discussionSnapshot(w)
    pages.savePage(w)
    const id = w.id
    const file = join(profile, 'data', 'page-workspaces', id + '.json')
    const expectedPending = () => {
      const current = pages.readPage(id)
      const v = pageCurrent(current)
      const request = pages.pendingExternalRequest(current)
      return request
        ? {
            id,
            title: current.title,
            revision: current.revision,
            requestId: request.id,
            discussionVersionId: request.discussion?.versionId ?? request.versionId,
            editVersionId: request.versionId,
            stale:
              request.versionId !== v.id ||
              request.externalRequest.contextKey !==
                pageContextKey(v, request.regionId ?? null, current) ||
              pages.discussionIsStale(current, request.discussion),
          }
        : null
    }
    const pendingBefore = expectedPending()
    assert.deepEqual(pages.listPendingPageRequests()[0], pendingBefore)
    const initial = await a.call('get_workspace', { id })
    projectReads = 0
    assert.equal(
      (await a.call('get_workspace', { id, since_revision: initial.revision })).notModified,
      true,
    )
    assert.equal((await a.call('list_workspaces')).items[0].title, 'Index A')
    assert.equal((await a.call('list_workspace_requests')).items.length, 1)
    assert.equal(pages.readPageAccess(id).revision, initial.revision)
    const access = pages.readPageAccess(id)
    access.execution.kind = 'inpaint'
    assert.equal(
      pages.readPageAccess(id).execution.kind,
      'generate',
      'recovery metadata is detached from callers',
    )
    assert.equal(projectReads, 0, 'warm summary/inbox/unchanged must not parse project JSON')
    locked = true
    await assert.rejects(
      a.call('get_workspace', { id, since_revision: initial.revision }),
      /unsaved editor/,
    )
    locked = false
    await assert.rejects(
      a.call('get_workspace', {
        id,
        since_revision: initial.revision,
        history_revision: initial.revision + 1,
      }),
      /历史已更新/,
    )
    await assert.rejects(
      a.call('get_workspace', { id, since_revision: initial.revision, message_ids: [message.id] }),
      /不能/,
    )
    assert.equal(
      (await b.call('get_workspace', { id, since_revision: initial.revision })).resetRequired,
      true,
    )
    console.log(
      'PASS zero-read warm queries; unsaved editor/revision/argument guards and connection isolation',
    )

    // Same revision, same size, restored mtime: ctime/inode still invalidates external edits.
    const beforeStat = fs.statSync(file)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    raw.title = 'Index B'
    fs.writeFileSync(file, JSON.stringify(raw))
    fs.utimesSync(file, beforeStat.atime, beforeStat.mtime)
    const changed = await a.call('get_workspace', { id, since_revision: initial.revision })
    assert.equal(changed.title, 'Index B')
    assert.notEqual(changed.notModified, true)
    assert.equal(pages.listPages()[0].title, 'Index B')
    const summaries = pages.listPages()
    summaries[0].title = 'mutated caller'
    summaries[0].image.missing = true
    assert.equal(pages.listPages()[0].title, 'Index B')
    assert.equal(pages.listPages()[0].image.missing, false)
    const detached = pages.readPage(id)
    detached.title = 'unsaved mutation'
    assert.equal(pages.listPages()[0].title, 'Index B')

    await a.call('get_workspace', { id })
    const path = imagePath(pageCurrent(pages.readPage(id)).image.name)
    const backup = path + '.test-away'
    fs.renameSync(path, backup)
    const missing = await a.call('get_workspace', { id, since_revision: initial.revision })
    assert.equal(missing.versions[0].image.missing, true)
    assert.equal(pages.listPages()[0].image.missing, true)
    assert.deepEqual(pages.listPendingPageRequests()[0], expectedPending())
    assert.equal(pages.listPendingPageRequests()[0].stale, true)
    fs.renameSync(backup, path)
    const restored = await a.call('get_workspace', { id, since_revision: initial.revision })
    assert.equal(restored.versions[0].image.missing, false)
    assert.equal(pages.listPendingPageRequests()[0].stale, false)
    console.log(
      'PASS external same-revision edits, detached index values, image deletion/restoration and request staleness',
    )

    // Missing persisted content hash must be recomputed after a same-name file replacement.
    w = pages.readPage(id)
    delete pageCurrent(w).image.contentHash
    pages.savePage(w)
    const unhashed = await a.call('get_workspace', { id })
    png.data.fill(0)
    fs.writeFileSync(path, PNG.sync.write(png))
    const replaced = await a.call('get_workspace', { id, since_revision: unhashed.revision })
    assert.equal(replaced.versions.length, 1)
    assert.notEqual(replaced.versions[0].image.contentHash, unhashed.versions[0].image.contentHash)

    w = pages.readPage(id)
    pages.pendingExternalRequest(w).externalRequest.status = 'cancelled'
    pages.savePage(w)
    assert.equal(pages.listPendingPageRequests().length, 0)
    const ready = await a.call('get_workspace', { id })
    pages.deletePage(id, ready.revision)
    assert.equal(pages.listPages().length, 0)
    await assert.rejects(a.call('get_workspace', { id, since_revision: ready.revision }), /ENOENT/)
    pages.restorePage(pages.listRemovedPages()[0].token)
    assert.equal(pages.listPages().length, 1)
    const intact = fs.readFileSync(file)
    fs.writeFileSync(file, '{bad JSON')
    await assert.rejects(a.call('get_workspace', { id, since_revision: ready.revision }))
    fs.writeFileSync(file, intact)
    assert.equal((await a.call('get_workspace', { id })).id, id)
    console.log(
      'PASS image replacement, cancellation, deletion/restoration, corrupt-file rejection and repair',
    )
    sessions.forEach((s) => s.close())
    app.exit(0)
  } catch (e) {
    console.error(e)
    console.error('PROFILE ' + profile)
    sessions.forEach((s) => s.close())
    app.exit(1)
  }
})
