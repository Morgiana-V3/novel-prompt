const { temporaryProfile, artifactDirectory } = require('../support/fixtures.cjs')
// Real workspace persistence + MCP dispatch; synthetic prompts/images, no providers.
const { app } = require('electron')
const { mkdtempSync, readFileSync, readdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { createHash, randomUUID } = require('node:crypto')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { PNG } = require('pngjs')
const profile = temporaryProfile('np-mcp-context-')
app.setPath('userData', profile)
app.getAppPath = () => join(__dirname, '../..')
require('../support/register-typescript.cjs')
const pages = require('../../src/main/modules/workspace/index.ts')
const { desktopTools } = require('../../src/main/adapters/mcp/desktop-tools.ts')
const { createMcpSession } = require('../../src/main/adapters/mcp/server.ts')
const { workspaceResult } = require('../../src/main/adapters/mcp/workspace-result.ts')
const { readWorkspaceResult } = require('../../src/main/adapters/mcp/workspace-read.ts')
const { contextSkills } = require('../../src/main/adapters/mcp/skills-cache.ts')
const { runAsAgent } = require('../../src/main/modules/workspace/agent-sessions.ts')
const desktop = { withWorkspace: async (_, fn) => fn() }
const tools = desktopTools(desktop, {}, () => ({}))
const sessions = []
function client() {
  let seq = 0
  const pending = new Map()
  const session = createMcpSession(
    tools,
    { name: 'context-fixture', version: '1', instructions: '' },
    (line) => {
      const m = JSON.parse(line)
      pending.get(m.id)?.(m)
      pending.delete(m.id)
    },
  )
  sessions.push(session)
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      session.receive(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  return {
    session,
    request,
    async data(name, args = {}) {
      const m = await request('tools/call', { name, arguments: args })
      if (m.error || m.result.isError) {
        throw Error(m.error?.message ?? m.result.content[0].text)
      }
      return m.result.structuredContent
    },
  }
}
const size = (x) => JSON.stringify(x).length
const hash = (text) => createHash('sha256').update(text).digest('hex')
app.whenReady().then(async () => {
  try {
    const a = client()
    const b = client()
    for (const c of [a, b]) {
      await c.request('initialize', {})
      await c.data('configure_tools', { groups: ['workspace'] })
    }
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
    const draft = {
      base: 'detailed illustration, '.repeat(45),
      negative: 'blurry, '.repeat(10),
      characters: [],
    }
    const png = new PNG({ width: 64, height: 64 })
    png.data.fill(255)
    const library = require('../../src/main/modules/images/library.ts')
    const image = library.storeGeneratedImage(
      PNG.sync.write(png),
      { schema: 1, request: { ...draft, version: 'v5', params }, sourceKind: 'generate' },
      'temporary',
    )
    let w = await pages.createPage(image.name, params, 'v5', draft)
    for (let i = 0; i < 13; i++) {
      pages.pageEvent(w, 'History explanation '.repeat(30) + i)
    }
    w.messages = w.messages.slice(-13)
    const original = w.messages[0]
    original.proposal = {
      title: 'old proposal',
      regionId: null,
      warning: '',
      status: 'pending',
      contextKey: '',
      before: draft,
      after: { ...draft, base: draft.base + ' sky' },
      changes: [],
      previousAccepted: null,
    }
    const rules = 'Frozen rule example. '.repeat(4000)
    const skillSnapshot = { text: rules, digest: hash(rules) }
    w.messages.at(-1).skillSnapshot = skillSnapshot
    w.messages.at(-1).externalRequest = { status: 'pending', contextKey: '' }
    w.messages.at(-1).role = 'user'
    const { workspaceRectangleMask } = require('../../src/main/adapters/mcp/inpaint-tools.ts')
    w.versions[0].editor.regions.push({
      id: 'context-preview',
      label: 'AB',
      instruction: 'change selected area',
      target: null,
      anchor: null,
      annotated: true,
      accepted: null,
      mask: workspaceRectangleMask(w.versions[0].image.name, [
        { x: 8, y: 8, width: 16, height: 16 },
      ]),
    })
    w.messages.at(-1).regionId = 'context-preview'
    pages.savePage(w)
    const contextFirst = await a.data('get_workspace_context', { id: w.id })
    const contextNext = await a.data('get_workspace_context', { id: w.id })
    assert.equal(contextFirst.skills.sections[0]?.text, rules)
    assert.equal(contextNext.skills.sections[0]?.text, undefined)
    assert.ok(contextFirst.preview?.preview_path)
    assert.deepEqual(
      contextNext.preview,
      contextFirst.preview,
      'repeated context reads reuse the same valid preview files',
    )
    assert.equal(contextNext.skills.bodiesNotModified, true)
    const meta = await b.data('get_workspace_context', { id: w.id, skills_mode: 'metadata' })
    assert.equal(meta.skills.sections[0]?.text, undefined)
    assert.equal(meta.skills.bodiesNotModified, false)
    assert.equal(
      (await b.data('get_workspace_context', { id: w.id })).skills.sections[0]?.text,
      rules,
      'metadata does not acknowledge reading the body',
    )
    assert.equal(
      (await a.data('get_workspace_context', { id: w.id, skills_mode: 'full' })).skills.sections[0]
        ?.text,
      rules,
    )
    assert.equal(
      (await a.data('get_workspace_context', { id: w.id, skills_digests: { snapshot: 'stale' } }))
        .skills.sections[0]?.text,
      rules,
    )
    const c = client()
    await c.request('initialize', {})
    await c.data('configure_tools', { groups: ['workspace'] })
    assert.equal(
      (await c.data('get_workspace_context', { id: w.id })).skills.sections[0]?.text,
      rules,
      'reconnected agent must receive full rules',
    )
    const initial = await a.data('get_workspace', { id: w.id })
    assert.equal(initial.messages.length, 5)
    assert.equal(initial.history.total, 13)
    assert.equal(initial.versions[0].editor, undefined)
    assert.equal(initial.messages[0].textTruncated, true)
    assert.ok(initial.messages.every((m) => m.skillSnapshot?.text === undefined))
    assert.equal(
      (await a.data('get_workspace', { id: w.id, since_revision: initial.revision })).notModified,
      true,
    )
    const newDetail = await a.data('get_workspace', {
      id: w.id,
      detail: 'full',
      since_revision: initial.revision,
    })
    assert.equal(
      newDetail.resetRequired,
      true,
      'summary baseline cannot stand in for full contents',
    )
    let page = initial
    const seen = page.messages.map((m) => m.id)
    while (page.history.hasMore) {
      page = await a.data('get_workspace', {
        id: w.id,
        before_message_id: page.history.nextBeforeMessageId,
        history_revision: initial.revision,
      })
      seen.push(...page.messages.map((m) => m.id))
    }
    assert.equal(new Set(seen).size, 13)
    assert.equal(seen.length, 13)
    const details = await a.data('get_workspace', {
      id: w.id,
      detail: 'full',
      message_ids: [original.id],
    })
    assert.equal(details.messages[0].proposal.before.base, draft.base)
    assert.equal(details.versions.length, 0)
    const version = await a.data('get_workspace', {
      id: w.id,
      detail: 'full',
      version_ids: [w.currentVersionId],
    })
    assert.equal(version.versions[0].editor.draft.base, draft.base)
    assert.equal(version.messages.length, 0)
    const full = await a.data('get_workspace', { id: w.id, detail: 'full', message_limit: 100 })
    assert.equal(full.messages.length, 13)
    w = pages.readPage(w.id)
    w.messages[0].proposal.status = 'accepted'
    const removed = w.messages.splice(1, 1)[0].id
    for (let i = 0; i < 7; i++) {
      pages.pageEvent(w, 'new event ' + i)
    }
    pages.savePage(w)
    let delta = await a.data('get_workspace', { id: w.id, since_revision: initial.revision })
    assert.equal(delta.delta, true)
    assert.equal(delta.versions.length, 0)
    assert.deepEqual(delta.removedMessageIds, [removed])
    assert.equal(delta.history.matching, 8)
    const changed = [...delta.messages]
    while (delta.history.hasMore) {
      delta = await a.data('get_workspace', {
        id: w.id,
        since_revision: initial.revision,
        before_message_id: delta.history.nextBeforeMessageId,
        history_revision: w.revision,
      })
      changed.push(...delta.messages)
    }
    assert.equal(changed.length, 8)
    assert.equal(changed.find((m) => m.id === original.id).proposal.status, 'accepted')
    assert.equal(
      (await b.data('get_workspace', { id: w.id, since_revision: initial.revision })).resetRequired,
      true,
      'baseline cannot leak between clients',
    )
    await assert.rejects(
      a.data('get_workspace', {
        id: w.id,
        before_message_id: initial.history.nextBeforeMessageId,
        history_revision: initial.revision,
      }),
      /已更新/,
    )
    await assert.rejects(
      a.data('get_workspace', { id: w.id, before_message_id: original.id }),
      /history_revision/,
    )
    await assert.rejects(a.data('get_workspace', { id: w.id, message_ids: ['missing'] }), /不存在/)
    w.messages.find((m) => m.skillSnapshot).skillSnapshot = {
      text: rules + ' changed',
      digest: hash(rules + ' changed'),
    }
    pages.savePage(w)
    assert.equal(
      (await a.data('get_workspace_context', { id: w.id })).skills.sections[0]?.text,
      rules + ' changed',
    )
    assert.equal(
      (await a.data('get_workspace_context', { id: w.id })).skills.bodiesNotModified,
      true,
    )
    const receipt = await a.data('update_workspace', {
      id: w.id,
      revision: w.revision,
      title: 'compact write receipt',
    })
    assert.equal(receipt.detail, 'summary')
    assert.ok(receipt.messages.length <= 5)
    assert.equal(receipt.versions[0].editor, undefined)
    const unchanged = await a.data('get_workspace', { id: w.id, since_revision: receipt.revision })
    assert.equal(unchanged.notModified, true)
    runAsAgent({ sessionId: randomUUID(), name: 'fingerprint-fixture' }, () => {
      const isolated = structuredClone(pages.readPage(w.id))
      const first = readWorkspaceResult(isolated, {})
      isolated.versions[0].editor.regions.push({
        id: 'mask-fixture',
        label: 'AA',
        instruction: '',
        target: null,
        anchor: null,
        annotated: true,
        accepted: null,
        mask: 'first-mask',
      })
      readWorkspaceResult(isolated, {})
      isolated.versions[0].editor.regions[0].mask = 'different-mask'
      const maskDelta = readWorkspaceResult(isolated, { since_revision: isolated.revision })
      assert.equal(maskDelta.delta, true)
      assert.equal(maskDelta.versions.length, 1, 'omitted mask changes remain detectable')
      const baseRevision = isolated.revision
      for (let i = 1; i <= 33; i++) {
        isolated.revision = baseRevision + i
        readWorkspaceResult(isolated, {})
      }
      assert.equal(
        readWorkspaceResult(isolated, { since_revision: first.revision }).resetRequired,
        true,
        'bounded cache falls back explicitly',
      )
    })
    console.log(
      'PASS automatic/explicit/forced rule cache, isolation, reconnect, changed rules, summary/full detail, history pagination, changed old messages, deleted messages and revision guards',
    )
    console.log(
      JSON.stringify({
        measurement: 'synthetic: 1 image, 13 messages; JSON characters',
        contextFirst: size(contextFirst),
        contextCached: size(contextNext),
        historyFull: size(full),
        historyDefault: size(initial),
        singleMessageDetail: size(details),
        unchanged: size(unchanged),
        writeReceipt: size(receipt),
      }),
    )
    // Build real frozen manifests through the production skill composition path.
    const skills = require('../../src/main/modules/skills/service.ts')
    skills.setConfig(skills.getConfig().map((s) => ({ id: s.id, enabled: false })))
    const general = skills.createSkill({
      name: 'core',
      scope: 'all',
      content: 'Always preserve the user intent.',
    })
    const prompt = skills.createSkill({
      name: 'Prompt fixture',
      scope: 'optimize',
      content: 'Prompt rules. '.repeat(3000),
    })
    const preview = skills.createSkill({
      name: 'Preview fixture',
      scope: 'preview',
      content: 'Preview rules. '.repeat(2500),
    })
    const inpaint = skills.createSkill({
      name: 'Inpaint fixture',
      scope: 'inpaint',
      content: 'Inpaint rules. '.repeat(1000),
    })
    let rulePage = await a.data('create_workspace', { title: 'Frozen manifest fixture', draft })
    rulePage = await a.data('set_workspace_agent', {
      id: rulePage.id,
      revision: rulePage.revision,
      mode: 'external',
    })
    const renew = async () => {
      const current = pages.readPage(rulePage.id)
      if (pages.pendingExternalRequest(current)) {
        await a.data('cancel_workspace_request', { id: current.id, revision: current.revision })
      }
      const latest = pages.readPage(rulePage.id)
      rulePage = await a.data('submit_workspace_request', {
        id: latest.id,
        revision: latest.revision,
        text: '规则增量测试',
      })
    }
    await renew()
    const firstRules = (
      await a.data('get_workspace_context', { id: rulePage.id, rules_only: true })
    ).skills
    assert.equal(firstRules.segmented, true)
    assert.deepEqual(
      firstRules.sections.map((s) => s.id),
      ['builtin:core'],
      'user skill named core cannot collide with the mandatory core',
    )
    assert.ok(
      firstRules.missingRequiredIds.includes(general.id),
      'overview cannot skip universal user rules',
    )
    assert.ok(size(firstRules) < 10000)
    const promptRules = (
      await a.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_task: 'prompt',
      })
    ).skills
    assert.deepEqual(
      new Set(promptRules.sections.map((s) => s.id)),
      new Set([general.id, prompt.id]),
    )
    assert.equal(promptRules.selectionComplete, true)
    assert.ok(!promptRules.selectedIds.includes(preview.id))
    const paintRules = (
      await a.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_task: 'inpaint',
      })
    ).skills
    assert.deepEqual(
      paintRules.sections.map((s) => s.id),
      [inpaint.id],
      'inpaint also requires previously cached prompt and universal rules',
    )
    const allRules = (
      await a.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_task: 'all',
        skills_mode: 'full',
      })
    ).skills
    assert.equal(allRules.sections.length, 5)
    const frozenBefore = pages.pendingExternalRequest(pages.readPage(rulePage.id)).skillSnapshot
    for (const s of frozenBefore.sections) {
      assert.equal(hash(frozenBefore.text.slice(s.start, s.end)), s.digest)
    }
    const revisedPrompt = 'Changed prompt rules. '.repeat(500)
    skills.updateSkill(prompt.id, { content: revisedPrompt })
    assert.equal(
      (
        await a.data('get_workspace_context', {
          id: rulePage.id,
          rules_only: true,
          skills_task: 'all',
        })
      ).skills.bodiesNotModified,
      true,
      'settings edits do not change a pending frozen request',
    )
    await renew()
    const changedRules = (
      await a.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_task: 'all',
      })
    ).skills
    assert.deepEqual(
      changedRules.sections.map((s) => s.id),
      [prompt.id],
    )
    assert.equal(hash(changedRules.sections[0].text), hash(skills.getSkill(prompt.id).content))
    assert.equal(changedRules.manifestChanged, true)
    skills.setConfig(
      skills
        .getConfig()
        .slice()
        .reverse()
        .map((s) => ({ id: s.id, enabled: s.id !== preview.id && s.enabled })),
    )
    await renew()
    const reordered = (
      await a.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_task: 'all',
      })
    ).skills
    assert.equal(reordered.sections.length, 0, 'reordering does not invalidate unchanged bodies')
    assert.equal(reordered.manifestChanged, true)
    assert.ok(reordered.removedIds.includes(preview.id))
    assert.notDeepEqual(
      reordered.manifest.filter((s) => s.scope !== 'core').map((s) => s.id),
      allRules.manifest.filter((s) => s.scope !== 'core' && s.id !== preview.id).map((s) => s.id),
    )
    const fresh = client()
    await fresh.request('initialize', {})
    await fresh.data('configure_tools', { groups: ['workspace'] })
    const onlyCatalog = (
      await fresh.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_task: 'all',
        skills_mode: 'metadata',
      })
    ).skills
    assert.equal(onlyCatalog.sections.length, 0)
    assert.equal(onlyCatalog.selectionComplete, false)
    const afterCatalog = (
      await fresh.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_task: 'all',
      })
    ).skills
    assert.equal(afterCatalog.sections.length, reordered.manifest.length)
    const supplied = Object.fromEntries(afterCatalog.sections.map((s) => [s.id, s.digest]))
    assert.equal(
      (
        await fresh.data('get_workspace_context', {
          id: rulePage.id,
          rules_only: true,
          skills_task: 'all',
          skills_digests: supplied,
        })
      ).skills.sections.length,
      0,
    )
    delete supplied[prompt.id]
    const lost = (
      await fresh.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_task: 'all',
        skills_digests: supplied,
      })
    ).skills
    assert.deepEqual(
      lost.sections.map((s) => s.id),
      [prompt.id],
    )
    const forced = (
      await fresh.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_ids: [prompt.id],
        skills_mode: 'full',
      })
    ).skills
    assert.deepEqual(
      new Set(forced.sections.map((s) => s.id)),
      new Set(['builtin:core', prompt.id]),
    )
    await assert.rejects(
      a.data('get_workspace_context', {
        id: rulePage.id,
        rules_only: true,
        skills_ids: ['missing'],
      }),
      /冻结目录/,
    )
    await assert.rejects(
      a.data('get_workspace_context', { id: rulePage.id, skills_digests: { x: 123 } }),
      /string/,
    )
    const originalFrozen = structuredClone(
      pages.pendingExternalRequest(pages.readPage(rulePage.id)).skillSnapshot,
    )
    const corrupt = pages.readPage(rulePage.id)
    pages.pendingExternalRequest(corrupt).skillSnapshot.sections[0].end++
    pages.savePage(corrupt)
    await assert.rejects(
      a.data('get_workspace_context', { id: rulePage.id, rules_only: true }),
      /索引无效/,
    )
    const repaired = pages.readPage(rulePage.id)
    pages.pendingExternalRequest(repaired).skillSnapshot = originalFrozen
    pages.savePage(repaired)
    console.log(
      'PASS task-scoped frozen rules, universal requirements, per-body deltas, deletion/reorder manifests, cache recovery, index integrity and duplicate core names',
    )
    console.log(
      JSON.stringify({
        measurement: 'new frozen 5-part rule pack, JSON characters',
        fullRules: size(allRules),
        firstCoreAndCatalog: size(firstRules),
        oneChangedRule: size(changedRules),
        reorderWithoutBodies: size(reordered),
      }),
    )

    // Large projects: both context and history must bound their candidate lists.
    let many = pages.readPage(rulePage.id)
    const seed = structuredClone(many.versions[0])
    const adopted = many.currentVersionId
    for (let i = 1; i < 37; i++) {
      many.versions.push({
        ...structuredClone(seed),
        id: randomUUID(),
        label: 'Candidate ' + i,
        groupId: 'shared-group',
        groupNumber: 2,
        candidateNumber: i,
      })
    }
    pages.savePage(many)
    const overview = await a.data('get_workspace_context', { id: many.id })
    assert.equal(overview.candidates.length, 10)
    assert.equal(overview.candidatesPage.total, 37)
    assert.equal(overview.adoptedVersionId, adopted)
    assert.equal(
      overview.draft.base,
      draft.base,
      'adopted state remains available outside the page',
    )
    assert.ok(
      overview.groups.every((g) =>
        g.candidateIds.every((id) => overview.candidates.some((v) => v.id === id)),
      ),
    )
    assert.ok(overview.groups.some((g) => g.partial))
    let candidates = overview
    const ids = candidates.candidates.map((v) => v.id)
    while (candidates.candidatesPage.hasMore) {
      candidates = await a.data('get_workspace_context', {
        id: many.id,
        before_version_id: candidates.candidatesPage.nextBeforeVersionId,
        history_revision: many.revision,
      })
      ids.push(...candidates.candidates.map((v) => v.id))
    }
    assert.equal(ids.length, 37)
    assert.equal(new Set(ids).size, 37)
    let versions = await a.data('get_workspace', { id: many.id })
    let readIds = versions.versions.map((v) => v.id)
    const baseRevision = versions.revision
    assert.equal(versions.versions.length, 10)
    while (versions.versionsPage.hasMore) {
      versions = await a.data('get_workspace', {
        id: many.id,
        before_version_id: versions.versionsPage.nextBeforeVersionId,
        history_revision: many.revision,
      })
      readIds.push(...versions.versions.map((v) => v.id))
      assert.equal(versions.messages.length, 0)
    }
    assert.equal(readIds.length, 37)
    assert.equal(new Set(readIds).size, 37)
    const targeted = await a.data('get_workspace', {
      id: many.id,
      detail: 'full',
      version_ids: many.versions.slice(0, 20).map((v) => v.id),
    })
    assert.equal(targeted.versions.length, 20)
    for (let i = 0; i < 23; i++) {
      many.versions[i].editor.draft.base += ' changed'
    }
    const deleted = many.versions.pop().id
    pages.savePage(many)
    let incremental = await a.data('get_workspace', {
      id: many.id,
      since_revision: baseRevision,
      version_limit: 7,
    })
    let changedIds = incremental.versions.map((v) => v.id)
    assert.deepEqual(incremental.removedVersionIds, [deleted])
    while (incremental.versionsPage.hasMore) {
      incremental = await a.data('get_workspace', {
        id: many.id,
        since_revision: baseRevision,
        version_limit: 7,
        before_version_id: incremental.versionsPage.nextBeforeVersionId,
        history_revision: many.revision,
      })
      changedIds.push(...incremental.versions.map((v) => v.id))
    }
    assert.equal(changedIds.length, 23)
    assert.equal(new Set(changedIds).size, 23)
    await assert.rejects(
      a.data('get_workspace_context', {
        id: many.id,
        before_version_id: overview.candidatesPage.nextBeforeVersionId,
        history_revision: baseRevision,
      }),
      /已更新/,
    )
    await assert.rejects(
      a.data('get_workspace', { id: many.id, before_version_id: many.versions[0].id }),
      /history_revision/,
    )
    await assert.rejects(
      a.data('get_workspace', {
        id: many.id,
        before_version_id: 'missing',
        history_revision: many.revision,
      }),
      /游标不存在/,
    )
    await assert.rejects(a.data('get_workspace', { id: many.id, version_limit: 101 }), /范围/)
    console.log(
      'PASS 37-candidate context/history paging, bounded group IDs, adopted state, exact detail reads, 23 changed candidate deltas, deletion and stale-cursor protection',
    )
    if (process.argv.includes('--measure-dev')) {
      // Read raw files only: never run migrations, persist, or switch the live app's profile.
      const dir = join(
        require('../../src/runtime/runtime-profile.cjs').resolveRuntimeProfile({ packaged: false }),
        'data',
        'page-workspaces',
      )
      if (existsSync(dir)) {
        for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
          const actual = JSON.parse(readFileSync(join(dir, file), 'utf8'))
          if (!actual.messages || !actual.versions) {
            continue
          }
          const agent = { sessionId: randomUUID(), name: 'read-only-size-measurement' }
          runAsAgent(agent, () => {
            const summary = readWorkspaceResult(actual, {})
            const frozen = actual.messages.findLast((m) => m.skillSnapshot)?.skillSnapshot
            const first = contextSkills(frozen, {})
            const next = contextSkills(frozen, {})
            console.log(
              JSON.stringify({
                measurement: 'existing project, raw read only',
                images: actual.versions.filter((v) => v.image).length,
                messages: actual.messages.length,
                historyBefore: size(workspaceResult(actual)),
                historyDefault: size(summary),
                rulesFirst: size(first),
                rulesCached: size(next),
              }),
            )
          })
        }
      }
    }
    sessions.forEach((s) => s.close())
    app.exit(0)
  } catch (e) {
    console.error(e)
    sessions.forEach((s) => s.close())
    app.exit(1)
  }
})
